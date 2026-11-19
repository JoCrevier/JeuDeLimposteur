import {
  getSalonRef,
  initAnonymousSession,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "./firebase.js";

import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  PALETTE,
  ALLOWED_HEX_SET,
  sanitizePlayersList,
  areAllPlayersReady,
  createInitialGameState,
  resolveVotes
} from "./game.js";

const state = {
  sessionCode: null,
  playerId: null,
  selectedColor: null,
  players: [],
  game: null,
  unsubscribeSalon: null,
  authReady: false
};

const screens = {
  code: document.getElementById("screenCode"),
  profile: document.getElementById("screenProfile"),
  lobby: document.getElementById("screenLobby"),
  game: document.getElementById("screenGame")
};

// Écran 1 : Code
const codeInput = document.getElementById("codeInput");
const codeForm = document.getElementById("codeForm");
const codeError = document.getElementById("codeError");
const randomCodeBtn = document.getElementById("randomCodeBtn");
const submitCodeBtn = codeForm.querySelector('button[type="submit"]');

// Écran 2 : Profil
const nameInput = document.getElementById("nameInput");
const profileForm = document.getElementById("profileForm");
const profileError = document.getElementById("profileError");
const colorsGrid = document.getElementById("colorsGrid");
const backToCodeBtn = document.getElementById("backToCodeBtn");
const submitProfileBtn = profileForm.querySelector('button[type="submit"]');

// Écran 3 : Salon
const activeCodeDisplay = document.getElementById("activeCodeDisplay");
const minPlayersNotice = document.getElementById("minPlayersNotice");
const playersGrid = document.getElementById("playersGrid");
const playerCountText = document.getElementById("playerCountText");
const statusDot = document.getElementById("statusDot");
const leaveBtn = document.getElementById("leaveBtn");
const toggleReadyBtn = document.getElementById("toggleReadyBtn");

// Écran 4 : Jeu
const roundDisplay = document.getElementById("roundDisplay");
const phaseTitle = document.getElementById("phaseTitle");
const roleBanner = document.getElementById("roleBanner");
const gameError = document.getElementById("gameError");

const phaseWriteView = document.getElementById("phaseWriteView");
const writeInstruction = document.getElementById("writeInstruction");
const wordForm = document.getElementById("wordForm");
const wordInput = document.getElementById("wordInput");
const submitWordBtn = document.getElementById("submitWordBtn");
const writeProgressText = document.getElementById("writeProgressText");

const phaseDiscussView = document.getElementById("phaseDiscussView");
const wordsList = document.getElementById("wordsList");
const goToVoteBtn = document.getElementById("goToVoteBtn");

const phaseVoteView = document.getElementById("phaseVoteView");
const voteGrid = document.getElementById("voteGrid");
const voteProgressText = document.getElementById("voteProgressText");

const phaseResultView = document.getElementById("phaseResultView");
const resultBanner = document.getElementById("resultBanner");
const gameLeaveBtn = document.getElementById("gameLeaveBtn");
const nextRoundBtn = document.getElementById("nextRoundBtn");

submitCodeBtn.disabled = true;

function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name].classList.add("active");
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.add("visible");
}

function hideError(el) {
  el.textContent = "";
  el.classList.remove("visible");
}

function stopSalonListener() {
  if (state.unsubscribeSalon) {
    state.unsubscribeSalon();
    state.unsubscribeSalon = null;
  }
}

function renderCounter(players) {
  const count = players.length;
  playerCountText.textContent = `${count} / ${MAX_PLAYERS} ${count > 1 ? "joueurs" : "joueur"}`;
  const enough = count >= MIN_PLAYERS;
  statusDot.classList.toggle("ready", enough);

  if (minPlayersNotice) {
    if (count < MIN_PLAYERS) {
      const missing = MIN_PLAYERS - count;
      minPlayersNotice.textContent = `En attente de ${missing} ${missing > 1 ? "joueurs" : "joueur"} minimum`;
      minPlayersNotice.style.color = "var(--warning)";
    } else {
      const readyCount = players.filter((p) => p.ready).length;
      minPlayersNotice.textContent = `${readyCount} / ${count} joueurs prêts`;
      minPlayersNotice.style.color = readyCount === count ? "var(--success)" : "var(--accent)";
    }
  }
}

function renderColorPicker() {
  const takenColors = new Set(state.players.map((p) => p.color));
  colorsGrid.innerHTML = "";

  PALETTE.forEach((c) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "color-btn";
    btn.style.backgroundColor = c.hex;
    btn.title = c.name;
    const isTaken = takenColors.has(c.hex);

    if (isTaken) {
      btn.classList.add("taken");
      btn.disabled = true;
    } else if (state.selectedColor === c.hex) {
      btn.classList.add("selected");
    }

    btn.addEventListener("click", () => {
      if (isTaken) return;
      state.selectedColor = c.hex;
      hideError(profileError);
      renderColorPicker();
    });

    colorsGrid.appendChild(btn);
  });
}

function renderLobby() {
  activeCodeDisplay.textContent = state.sessionCode;
  renderCounter(state.players);

  const me = state.players.find((p) => p.id === state.playerId);
  if (me) {
    toggleReadyBtn.textContent = me.ready ? "Annuler « Prêt »" : "Je suis prêt";
    toggleReadyBtn.className = me.ready ? "btn-secondary" : "btn-success";
  }

  playersGrid.innerHTML = "";
  state.players.forEach((p) => {
    const card = document.createElement("div");
    card.className = "player-card" + (p.ready ? " is-ready" : "");

    const left = document.createElement("div");
    left.className = "player-left";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundColor = p.color;
    avatar.textContent = p.name.charAt(0).toUpperCase();

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = p.name;

    const tagEl = document.createElement("div");
    tagEl.className = "player-tag";
    tagEl.textContent = p.id === state.playerId ? "Toi" : "Connecté";

    info.append(nameEl, tagEl);
    left.append(avatar, info);

    const readyPill = document.createElement("span");
    readyPill.className = "ready-pill" + (p.ready ? " ready" : "");
    readyPill.textContent = p.ready ? "Prêt ✓" : "En attente";

    card.append(left, readyPill);
    playersGrid.appendChild(card);
  });
}

function renderGame() {
  const game = state.game;
  if (!game) return;

  renderCounter(state.players);
  roundDisplay.textContent = `Manche ${game.round || 1}`;

  const me = state.players.find((p) => p.id === state.playerId);
  const amImpostor = game.impostorId === state.playerId;
  const amEliminated = Boolean(me?.eliminated);

  if (amImpostor) {
    roleBanner.className = "role-card impostor";
    roleBanner.textContent = `Rôle : IMPOSTEUR • Mot secret : ${game.secretWord}`;
  } else {
    roleBanner.className = "role-card detective";
    roleBanner.textContent = "Rôle : Enquêteur • Trouve le mot secret sans te faire piéger";
  }

  phaseWriteView.classList.add("hidden");
  phaseDiscussView.classList.add("hidden");
  phaseVoteView.classList.add("hidden");
  phaseResultView.classList.add("hidden");

  const activePlayers = state.players.filter((p) => !p.eliminated);

  // PHASE 1 : ÉCRITURE D'UN MOT
  if (game.phase === "write") {
    phaseTitle.textContent = "Phase 1 / 3 : Écriture d'un mot";
    phaseWriteView.classList.remove("hidden");

    const alreadySent = Boolean(game.words && game.words[state.playerId]);
    const submittedCount = activePlayers.filter((p) => Boolean(game.words?.[p.id])).length;

    if (amEliminated) {
      writeInstruction.textContent = "Tu as été éliminé. Observe les joueurs restants écrire leur mot.";
      wordForm.classList.add("hidden");
    } else if (alreadySent) {
      writeInstruction.textContent = `Ton mot (« ${game.words[state.playerId]} ») est enregistré. En attente des autres joueurs...`;
      wordForm.classList.add("hidden");
    } else {
      wordForm.classList.remove("hidden");
      wordInput.disabled = false;
      submitWordBtn.disabled = false;
      writeInstruction.textContent = amImpostor
        ? `Tu connais le mot (« ${game.secretWord} »). Écris un mot proche sans te trahir !`
        : "Écris un mot que tu penses proche du mot secret :";
    }

    writeProgressText.textContent = `${submittedCount} / ${activePlayers.length} joueurs ont écrit leur mot.`;
  }

  // PHASE 2 : DÉLIBÉRATION
  if (game.phase === "discuss") {
    phaseTitle.textContent = "Phase 2 / 3 : Délibération";
    phaseDiscussView.classList.remove("hidden");

    wordsList.innerHTML = "";
    activePlayers.forEach((p) => {
      const card = document.createElement("div");
      card.className = "word-item";

      const header = document.createElement("div");
      header.className = "word-item-header";

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.backgroundColor = p.color;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = p.name + (p.id === state.playerId ? " (Toi)" : "");

      header.append(dot, nameSpan);

      const wordVal = document.createElement("div");
      wordVal.className = "word-value";
      wordVal.textContent = game.words?.[p.id] || "—";

      card.append(header, wordVal);
      wordsList.appendChild(card);
    });

    goToVoteBtn.disabled = amEliminated;
  }

  // PHASE 3 : VOTE
  if (game.phase === "vote") {
    phaseTitle.textContent = "Phase 3 / 3 : Vote d'exclusion";
    phaseVoteView.classList.remove("hidden");

    const myVote = game.votes?.[state.playerId] || null;
    const votedCount = activePlayers.filter((p) => Boolean(game.votes?.[p.id])).length;

    voteGrid.innerHTML = "";
    activePlayers.forEach((target) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "vote-btn" + (myVote === target.id ? " voted" : "");
      btn.disabled = amEliminated || target.id === state.playerId;

      const left = document.createElement("div");
      left.className = "player-left";

      const avatar = document.createElement("div");
      avatar.className = "avatar";
      avatar.style.backgroundColor = target.color;
      avatar.textContent = target.name.charAt(0).toUpperCase();

      const label = document.createElement("span");
      label.textContent = `${target.name} (${game.words?.[target.id] || "—"})`;

      left.append(avatar, label);

      const badge = document.createElement("span");
      badge.className = "player-tag";
      badge.textContent = myVote === target.id ? "Ton vote ✓" : "Voter";

      btn.append(left, badge);
      btn.addEventListener("click", () => castVote(target.id));
      voteGrid.appendChild(btn);
    });

    voteProgressText.textContent = `${votedCount} / ${activePlayers.length} joueurs ont voté.`;
  }

  // RÉSULTAT DE MANCHE OU FIN DE PARTIE
  if (game.phase === "result" || game.phase === "finished") {
    phaseTitle.textContent = game.phase === "finished" ? "Fin de la partie" : "Résultat du vote";
    phaseResultView.classList.remove("hidden");
    resultBanner.textContent = game.lastResult?.message || "Manche terminée.";

    nextRoundBtn.textContent =
      game.phase === "finished" ? "Retour au salon" : "Manche suivante";
  }
}

function startSalonListener(code) {
  stopSalonListener();
  state.unsubscribeSalon = onSnapshot(
    getSalonRef(code),
    (snap) => {
      if (!snap.exists()) {
        state.players = [];
        state.game = null;
        renderCounter([]);
        return;
      }

      const data = snap.data();
      state.players = sanitizePlayersList(data.players);
      state.game = data.game || null;

      const meInRoom = state.players.some((p) => p.id === state.playerId);

      if (meInRoom && state.game && state.game.status === "playing") {
        showScreen("game");
        renderGame();
        return;
      }

      if (screens.game.classList.contains("active") && !state.game) {
        showScreen("lobby");
      }

      if (screens.lobby.classList.contains("active")) {
        renderLobby();
      } else if (screens.profile.classList.contains("active")) {
        renderCounter(state.players);
        if (state.selectedColor && state.players.some((p) => p.color === state.selectedColor)) {
          state.selectedColor = null;
        }
        renderColorPicker();
      }
    },
    (err) => {
      console.error("Erreur temps réel Firestore :", err);
    }
  );
}

// Authentification anonyme au démarrage
initAnonymousSession(
  (uid) => {
    state.playerId = uid;
    state.authReady = true;
    submitCodeBtn.disabled = false;
  },
  () => {
    showError(codeError, "Impossible d'initialiser la session sécurisée.");
  }
);

// ÉCRAN 1 : Code de session
codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 5);
  hideError(codeError);
});

randomCodeBtn.addEventListener("click", () => {
  codeInput.value = String(Math.floor(10000 + Math.random() * 90000));
  hideError(codeError);
});

codeForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.authReady || !state.playerId) {
    showError(codeError, "Connexion en cours, réessaie dans un instant.");
    return;
  }

  const code = codeInput.value.trim();
  if (!/^\d{5}$/.test(code)) {
    showError(codeError, "Le code doit contenir exactement 5 chiffres.");
    return;
  }

  submitCodeBtn.disabled = true;
  hideError(codeError);

  try {
    const salonRef = getSalonRef(code);
    const snap = await getDoc(salonRef);
    const data = snap.exists() ? snap.data() : null;
    const currentPlayers = data ? sanitizePlayersList(data.players) : [];
    const alreadyIn = currentPlayers.some((p) => p.id === state.playerId);

    if (!alreadyIn && data?.game?.status === "playing") {
      showError(codeError, "Une partie est déjà en cours dans ce salon.");
      return;
    }

    if (!alreadyIn && currentPlayers.length >= MAX_PLAYERS) {
      showError(codeError, `Cette session est complète (${MAX_PLAYERS}/${MAX_PLAYERS} joueurs maximum).`);
      return;
    }

    state.sessionCode = code;
    state.selectedColor = null;
    state.players = currentPlayers;
    state.game = data?.game || null;
    renderCounter(currentPlayers);
    startSalonListener(code);

    if (alreadyIn && state.game?.status === "playing") {
      renderGame();
      showScreen("game");
    } else if (alreadyIn) {
      renderLobby();
      showScreen("lobby");
    } else {
      renderColorPicker();
      showScreen("profile");
      nameInput.focus();
    }
  } catch (err) {
    console.error("Erreur accès salon :", err);
    showError(codeError, "Erreur de connexion à la base de données.");
  } finally {
    submitCodeBtn.disabled = false;
  }
});

// ÉCRAN 2 : Profil
profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cleanName = nameInput.value.trim().slice(0, 20);
  const chosenColor = state.selectedColor;

  if (!cleanName) {
    showError(profileError, "Merci d'inscrire ton nom.");
    return;
  }
  if (!chosenColor || !ALLOWED_HEX_SET.has(chosenColor)) {
    showError(profileError, "Merci de choisir une couleur valide.");
    return;
  }

  submitProfileBtn.disabled = true;
  hideError(profileError);

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      const data = snap.exists() ? snap.data() : null;
      const existingPlayers = data ? sanitizePlayersList(data.players) : [];
      const filtered = existingPlayers.filter((p) => p.id !== state.playerId);

      if (data?.game?.status === "playing") {
        throw new Error("IN_PROGRESS");
      }
      if (filtered.length >= MAX_PLAYERS) {
        throw new Error("FULL");
      }
      if (filtered.some((p) => p.color === chosenColor)) {
        throw new Error("COLOR_TAKEN");
      }

      filtered.push({
        id: state.playerId,
        name: cleanName,
        color: chosenColor,
        ready: false,
        eliminated: false
      });

      if (!snap.exists()) {
        transaction.set(salonRef, {
          code: state.sessionCode,
          players: filtered,
          game: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        transaction.update(salonRef, {
          players: filtered,
          updatedAt: serverTimestamp()
        });
      }
    });

    renderLobby();
    showScreen("lobby");
  } catch (err) {
    if (err.message === "IN_PROGRESS") {
      showError(profileError, "La partie vient de démarrer.");
    } else if (err.message === "FULL") {
      showError(profileError, `Limite de ${MAX_PLAYERS} joueurs atteinte.`);
    } else if (err.message === "COLOR_TAKEN") {
      state.selectedColor = null;
      renderColorPicker();
      showError(profileError, "Cette couleur vient d'être prise, choisis-en une autre.");
    } else {
      console.error("Erreur ajout joueur :", err);
      showError(profileError, "Impossible de rejoindre la session.");
    }
  } finally {
    submitProfileBtn.disabled = false;
  }
});

backToCodeBtn.addEventListener("click", () => {
  stopSalonListener();
  state.sessionCode = null;
  state.selectedColor = null;
  state.players = [];
  state.game = null;
  renderCounter([]);
  showScreen("code");
});

// ÉCRAN 3 : Bouton « Prêt » (lance automatiquement la partie quand tous sont prêts)
toggleReadyBtn.addEventListener("click", async () => {
  if (!state.sessionCode || !state.playerId) return;
  toggleReadyBtn.disabled = true;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (data.game?.status === "playing") return;

      const updatedPlayers = sanitizePlayersList(data.players).map((p) =>
        p.id === state.playerId ? { ...p, ready: !p.ready, eliminated: false } : p
      );

      const startNow = areAllPlayersReady(updatedPlayers);
      const nextGame = startNow ? createInitialGameState(updatedPlayers) : null;

      transaction.update(salonRef, {
        players: updatedPlayers,
        game: nextGame,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur statut prêt :", err);
  } finally {
    toggleReadyBtn.disabled = false;
  }
});

// Quitter le salon ou la partie
async function leaveSession() {
  const code = state.sessionCode;
  const uid = state.playerId;

  stopSalonListener();
  state.sessionCode = null;
  state.selectedColor = null;
  state.players = [];
  state.game = null;
  nameInput.value = "";
  renderCounter([]);
  showScreen("code");

  if (!code || !uid) return;

  try {
    const salonRef = getSalonRef(code);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const updated = sanitizePlayersList(snap.data().players).filter((p) => p.id !== uid);
      transaction.update(salonRef, {
        players: updated,
        game: updated.length < MIN_PLAYERS ? null : snap.data().game || null,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur départ session :", err);
  }
}

leaveBtn.addEventListener("click", leaveSession);
gameLeaveBtn.addEventListener("click", leaveSession);

// ÉCRAN 4 — PHASE 1 : Soumettre son mot
wordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = wordInput.value.trim().slice(0, 30);
  if (!word || !state.sessionCode || !state.playerId) return;

  submitWordBtn.disabled = true;
  hideError(gameError);

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game || game.phase !== "write") return;

      const players = sanitizePlayersList(data.players);
      const me = players.find((p) => p.id === state.playerId);
      if (!me || me.eliminated) return;

      const updatedWords = { ...(game.words || {}), [state.playerId]: word };
      const activePlayers = players.filter((p) => !p.eliminated);
      const allSubmitted = activePlayers.every((p) => Boolean(updatedWords[p.id]));

      transaction.update(salonRef, {
        game: {
          ...game,
          words: updatedWords,
          phase: allSubmitted ? "discuss" : "write"
        },
        updatedAt: serverTimestamp()
      });
    });

    wordInput.value = "";
  } catch (err) {
    console.error("Erreur envoi mot :", err);
    showError(gameError, "Impossible d'enregistrer ton mot.");
  } finally {
    submitWordBtn.disabled = false;
  }
});

// ÉCRAN 4 — PHASE 2 -> PHASE 3 : Passer au vote
goToVoteBtn.addEventListener("click", async () => {
  if (!state.sessionCode || !state.playerId) return;
  goToVoteBtn.disabled = true;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      if (!data.game || data.game.phase !== "discuss") return;

      transaction.update(salonRef, {
        game: {
          ...data.game,
          phase: "vote",
          votes: {}
        },
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur passage au vote :", err);
  } finally {
    goToVoteBtn.disabled = false;
  }
});

// ÉCRAN 4 — PHASE 3 : Voter pour éliminer un joueur
async function castVote(targetId) {
  if (!state.sessionCode || !state.playerId || targetId === state.playerId) return;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game || game.phase !== "vote") return;

      const players = sanitizePlayersList(data.players);
      const me = players.find((p) => p.id === state.playerId);
      if (!me || me.eliminated) return;

      const updatedVotes = { ...(game.votes || {}), [state.playerId]: targetId };
      const activePlayers = players.filter((p) => !p.eliminated);
      const allVoted = activePlayers.every((p) => Boolean(updatedVotes[p.id]));

      if (!allVoted) {
        transaction.update(salonRef, {
          game: {
            ...game,
            votes: updatedVotes
          },
          updatedAt: serverTimestamp()
        });
        return;
      }

      const outcome = resolveVotes(players, { ...game, votes: updatedVotes });
      transaction.update(salonRef, {
        players: outcome.updatedPlayers,
        game: {
          ...game,
          votes: updatedVotes,
          phase: outcome.nextPhase,
          lastResult: outcome.resultData
        },
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur vote :", err);
    showError(gameError, "Erreur lors de l'enregistrement du vote.");
  }
}

// ÉCRAN 4 — RÉSULTAT : Manche suivante ou retour au salon
nextRoundBtn.addEventListener("click", async () => {
  if (!state.sessionCode) return;
  nextRoundBtn.disabled = true;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game) return;

      if (game.phase === "finished") {
        const resetPlayers = sanitizePlayersList(data.players).map((p) => ({
          ...p,
          ready: false,
          eliminated: false
        }));
        transaction.update(salonRef, {
          players: resetPlayers,
          game: null,
          updatedAt: serverTimestamp()
        });
      } else if (game.phase === "result") {
        transaction.update(salonRef, {
          game: {
            ...game,
            round: (game.round || 1) + 1,
            phase: "write",
            words: {},
            votes: {},
            lastResult: null
          },
          updatedAt: serverTimestamp()
        });
      }
    });
  } catch (err) {
    console.error("Erreur manche suivante :", err);
  } finally {
    nextRoundBtn.disabled = false;
  }
});