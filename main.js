import {
  db,
  getSalonRef,
  initAnonymousSession,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "./firebase.js";

import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  TURN_SECONDS,
  PALETTE,
  ALLOWED_HEX_SET,
  THEMES,
  THEME_LIST,
  DEFAULT_THEME_ID,
  normalizeThemeId,
  generateSessionCode,
  sanitizePlayersList,
  resolveHostId,
  areAllPlayersReady,
  buildTurnOrder,
  createInitialGameState,
  advanceWriteTurn,
  resolveVotes
} from "./game.js";

const state = {
  sessionCode: null,
  playerId: null,
  hostId: null,
  selectedThemeId: DEFAULT_THEME_ID,
  selectedColor: null,
  players: [],
  game: null,
  unsubscribeSalon: null,
  authReady: false,
  isNewSession: false,
  turnTimerInterval: null,
  timeoutTriggeredForTurn: null
};

const screens = {
  code: document.getElementById("screenCode"),
  profile: document.getElementById("screenProfile"),
  lobby: document.getElementById("screenLobby"),
  game: document.getElementById("screenGame")
};

// Écran 1 : Créer ou Rejoindre
const modeJoinBtn = document.getElementById("modeJoinBtn");
const modeCreateBtn = document.getElementById("modeCreateBtn");
const joinForm = document.getElementById("joinForm");
const createBox = document.getElementById("createBox");
const codeInput = document.getElementById("codeInput");
const codeError = document.getElementById("codeError");
const createError = document.getElementById("createError");
const joinSubmitBtn = document.getElementById("joinSubmitBtn");
const createSessionBtn = document.getElementById("createSessionBtn");

// Écran 2 : Profil
const profileCodeDisplay = document.getElementById("profileCodeDisplay");
const profileModeBadge = document.getElementById("profileModeBadge");
const nameInput = document.getElementById("nameInput");
const profileForm = document.getElementById("profileForm");
const profileError = document.getElementById("profileError");
const colorsGrid = document.getElementById("colorsGrid");
const backToCodeBtn = document.getElementById("backToCodeBtn");
const submitProfileBtn = profileForm.querySelector('button[type="submit"]');

// Écran 3 : Salon & Hôte
const activeCodeDisplay = document.getElementById("activeCodeDisplay");
const minPlayersNotice = document.getElementById("minPlayersNotice");
const themeGrid = document.getElementById("themeGrid");
const themeHint = document.getElementById("themeHint");
const playersGrid = document.getElementById("playersGrid");
const playerCountText = document.getElementById("playerCountText");
const statusDot = document.getElementById("statusDot");
const hostControls = document.getElementById("hostControls");
const kickAllBtn = document.getElementById("kickAllBtn");
const deleteSessionBtn = document.getElementById("deleteSessionBtn");
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

// Barre de tour actif + chronomètre
const turnBox = document.createElement("div");
turnBox.className = "turn-box";
const turnStatusText = document.createElement("span");
turnStatusText.style.fontWeight = "600";
const turnTimerPill = document.createElement("span");
turnTimerPill.className = "timer-pill";
turnTimerPill.textContent = `${TURN_SECONDS}s`;
turnBox.append(turnStatusText, turnTimerPill);
phaseWriteView.insertBefore(turnBox, writeInstruction);

joinSubmitBtn.disabled = true;
createSessionBtn.disabled = true;

function isCurrentUserHost() {
  return Boolean(state.playerId && state.hostId && state.playerId === state.hostId);
}

function resetLocalSessionState(noticeMessage = "") {
  stopSalonListener();
  state.sessionCode = null;
  state.hostId = null;
  state.selectedThemeId = DEFAULT_THEME_ID;
  state.selectedColor = null;
  state.players = [];
  state.game = null;
  state.isNewSession = false;
  state.timeoutTriggeredForTurn = null;
  renderCounter([]);
  showScreen("code");
  if (noticeMessage) {
    showError(codeError, noticeMessage);
  }
}

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

function stopTurnTimer() {
  if (state.turnTimerInterval) {
    clearInterval(state.turnTimerInterval);
    state.turnTimerInterval = null;
  }
}

function stopSalonListener() {
  stopTurnTimer();
  if (state.unsubscribeSalon) {
    state.unsubscribeSalon();
    state.unsubscribeSalon = null;
  }
}

function getRemainingTurnSeconds(game) {
  if (!game?.turnDeadline) return TURN_SECONDS;
  return Math.max(0, Math.ceil((game.turnDeadline - Date.now()) / 1000));
}

function updateTurnTimerDisplay(game) {
  if (!game || game.phase !== "write") {
    stopTurnTimer();
    return;
  }

  const remaining = getRemainingTurnSeconds(game);
  turnTimerPill.textContent = `${remaining}s`;
  turnTimerPill.classList.toggle("urgent", remaining <= 5);

  if (remaining <= 0 && state.sessionCode && state.playerId) {
    const turnKey = `${game.round || 1}-${game.currentTurnIndex || 0}`;
    if (state.timeoutTriggeredForTurn !== turnKey) {
      state.timeoutTriggeredForTurn = turnKey;
      handleTurnTimeout(game.currentTurnIndex || 0);
    }
  }
}

function startTurnTimer(game) {
  stopTurnTimer();
  updateTurnTimerDisplay(game);
  state.turnTimerInterval = setInterval(() => {
    updateTurnTimerDisplay(state.game);
  }, 250);
}

async function handleTurnTimeout(expectedTurnIndex) {
  if (!state.sessionCode || !state.playerId) return;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game || game.phase !== "write") return;

      const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
      const currentIdx = game.currentTurnIndex || 0;
      if (currentIdx !== expectedTurnIndex) return;

      const deadline = game.turnDeadline || 0;
      if (Date.now() < deadline - 150) return;

      const activePlayerId = order[currentIdx];
      const updatedWords = { ...(game.words || {}) };
      if (activePlayerId && !(activePlayerId in updatedWords)) {
        updatedWords[activePlayerId] = null;
      }

      const nextGame = advanceWriteTurn(
        { ...game, words: updatedWords },
        Date.now()
      );

      transaction.update(salonRef, {
        game: nextGame,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur expiration tour :", err);
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

function renderThemeSelector() {
  const canPickTheme = isCurrentUserHost();
  const activeTheme = THEMES[normalizeThemeId(state.selectedThemeId)];

  themeHint.textContent = canPickTheme
    ? `Thème actif : ${activeTheme.label} (clique pour changer)`
    : `Thème choisi par l'hôte : ${activeTheme.label}`;

  themeGrid.innerHTML = "";
  THEME_LIST.forEach((theme) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn" + (theme.id === state.selectedThemeId ? " active" : "");
    btn.textContent = theme.label;
    btn.disabled = !canPickTheme;

    btn.addEventListener("click", () => selectSessionTheme(theme.id));
    themeGrid.appendChild(btn);
  });
}

async function selectSessionTheme(themeId) {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  const safeThemeId = normalizeThemeId(themeId);
  state.selectedThemeId = safeThemeId;
  renderThemeSelector();

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const currentHost = resolveHostId(data.hostId, sanitizePlayersList(data.players));
      if (currentHost !== state.playerId) return;

      transaction.update(salonRef, {
        themeId: safeThemeId,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur sélection thème :", err);
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
  renderThemeSelector();

  const amHost = isCurrentUserHost();
  hostControls.classList.toggle("hidden", !amHost);
  kickAllBtn.disabled = state.players.length <= 1;

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

    const tags = [];
    if (p.id === state.hostId) tags.push("Hôte ★");
    tags.push(p.id === state.playerId ? "Toi" : "Connecté");

    const tagEl = document.createElement("div");
    tagEl.className = "player-tag";
    tagEl.textContent = tags.join(" • ");

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
  const themeLabel = game.themeLabel || THEMES[normalizeThemeId(state.selectedThemeId)].label;
  roundDisplay.textContent = `Manche ${game.round || 1} • Thème : ${themeLabel}`;

  const me = state.players.find((p) => p.id === state.playerId);
  const amImpostor = game.impostorId === state.playerId;
  const amEliminated = Boolean(me?.eliminated);

  if (amImpostor) {
    roleBanner.className = "role-card impostor";
    roleBanner.textContent = "Rôle : IMPOSTEUR • Mot secret caché — devine-le !";
  } else {
    roleBanner.className = "role-card detective";
    roleBanner.textContent = `Mot secret : ${game.secretWord} • Enquêteur`;
  }

  phaseWriteView.classList.add("hidden");
  phaseDiscussView.classList.add("hidden");
  phaseVoteView.classList.add("hidden");
  phaseResultView.classList.add("hidden");

  const activePlayers = state.players.filter((p) => !p.eliminated);
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  const currentTurnIdx = game.currentTurnIndex || 0;
  const activeTurnPlayerId = order[currentTurnIdx] || null;
  const activeTurnPlayer = state.players.find((p) => p.id === activeTurnPlayerId);
  const isMyTurn = activeTurnPlayerId === state.playerId && !amEliminated;

  if (game.phase === "write") {
    phaseTitle.textContent = `Phase 1 / 3 : Écriture (${Math.min(currentTurnIdx + 1, order.length)} / ${order.length})`;
    phaseWriteView.classList.remove("hidden");

    const turnName = activeTurnPlayer
      ? activeTurnPlayer.id === state.playerId
        ? "C'est ton tour !"
        : `Tour de ${activeTurnPlayer.name}`
      : "Préparation du tour...";
    turnStatusText.textContent = turnName;
    startTurnTimer(game);

    const completedTurns = order.filter((id) => Boolean(game.words && id in game.words)).length;

    if (amEliminated) {
      writeInstruction.textContent = "Tu as été éliminé. Observe les tours des joueurs restants.";
      wordForm.classList.add("hidden");
    } else if (isMyTurn) {
      wordForm.classList.remove("hidden");
      wordInput.disabled = false;
      submitWordBtn.disabled = false;
      writeInstruction.textContent = amImpostor
        ? `Thème « ${themeLabel} » : tu ne vois pas le mot secret. Devinez-le à partir des indices et écris un mot en moins de ${TURN_SECONDS}s !`
        : `Le mot secret est « ${game.secretWord} » (thème ${themeLabel}). Écris un indice en moins de ${TURN_SECONDS}s :`;
      wordInput.focus();
    } else {
      wordForm.classList.add("hidden");
      writeInstruction.textContent = amImpostor
        ? `Attends que ${activeTurnPlayer?.name || "le joueur"} écrive son mot pour t'aider à deviner le mot secret...`
        : `Attends que ${activeTurnPlayer?.name || "le joueur"} écrive son mot (max ${TURN_SECONDS}s).`;
    }

    writeProgressText.textContent = `${completedTurns} / ${order.length} tours terminés.`;
  } else {
    stopTurnTimer();
  }

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

      const submittedWord = game.words && p.id in game.words ? game.words[p.id] : null;
      const wordVal = document.createElement("div");
      if (submittedWord) {
        wordVal.className = "word-value";
        wordVal.textContent = submittedWord;
      } else {
        wordVal.className = "word-value missed";
        wordVal.textContent = "Aucun mot (temps écoulé)";
      }

      card.append(header, wordVal);
      wordsList.appendChild(card);
    });

    goToVoteBtn.disabled = amEliminated;
  }

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

      const wordLabel =
        game.words && target.id in game.words && game.words[target.id]
          ? game.words[target.id]
          : "Aucun mot";

      const label = document.createElement("span");
      label.textContent = `${target.name} (${wordLabel})`;

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
        if (state.isNewSession && screens.profile.classList.contains("active")) {
          return;
        }
        const wasActive =
          screens.lobby.classList.contains("active") || screens.game.classList.contains("active");
        resetLocalSessionState(wasActive ? "La session a été supprimée par l'hôte." : "");
        return;
      }

      const data = snap.data();
      const hadJoinedRoom =
        screens.lobby.classList.contains("active") || screens.game.classList.contains("active");

      state.players = sanitizePlayersList(data.players);
      state.hostId = resolveHostId(data.hostId, state.players);
      state.selectedThemeId = normalizeThemeId(data.themeId);
      state.game = data.game || null;

      const meInRoom = state.players.some((p) => p.id === state.playerId);

      if (hadJoinedRoom && !meInRoom) {
        resetLocalSessionState("Tu as été expulsé de la session par l'hôte.");
        return;
      }

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

initAnonymousSession(
  (uid) => {
    state.playerId = uid;
    state.authReady = true;
    joinSubmitBtn.disabled = false;
    createSessionBtn.disabled = false;
  },
  (err) => {
    console.error("Erreur initialisation auth :", err);
    showError(codeError, "Impossible d'initialiser la session sécurisée.");
    showError(createError, "Impossible d'initialiser la session sécurisée.");
  }
);

modeJoinBtn.addEventListener("click", () => {
  modeJoinBtn.classList.add("active");
  modeCreateBtn.classList.remove("active");
  joinForm.classList.remove("hidden");
  createBox.classList.add("hidden");
  hideError(codeError);
  hideError(createError);
});

modeCreateBtn.addEventListener("click", () => {
  modeCreateBtn.classList.add("active");
  modeJoinBtn.classList.remove("active");
  createBox.classList.remove("hidden");
  joinForm.classList.add("hidden");
  hideError(codeError);
  hideError(createError);
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 5);
  hideError(codeError);
});

joinForm.addEventListener("submit", async (e) => {
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

  joinSubmitBtn.disabled = true;
  hideError(codeError);

  try {
    const salonRef = getSalonRef(code);
    const snap = await getDoc(salonRef);

    if (!snap.exists()) {
      showError(codeError, "Aucune session active trouvée avec ce code.");
      return;
    }

    const data = snap.data();
    const currentPlayers = sanitizePlayersList(data.players);

    if (currentPlayers.length === 0) {
      await deleteDoc(salonRef);
      showError(codeError, "Cette session est vide et a été fermée.");
      return;
    }

    const alreadyIn = currentPlayers.some((p) => p.id === state.playerId);

    if (!alreadyIn && data?.game?.status === "playing") {
      showError(codeError, "Une partie est déjà en cours dans cette session.");
      return;
    }

    if (!alreadyIn && currentPlayers.length >= MAX_PLAYERS) {
      showError(codeError, `Cette session est complète (${MAX_PLAYERS}/${MAX_PLAYERS} joueurs maximum).`);
      return;
    }

    state.sessionCode = code;
    state.hostId = resolveHostId(data.hostId, currentPlayers);
    state.selectedThemeId = normalizeThemeId(data.themeId);
    state.isNewSession = false;
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
      profileCodeDisplay.textContent = code;
      profileModeBadge.textContent = "Session active";
      renderColorPicker();
      showScreen("profile");
      nameInput.focus();
    }
  } catch (err) {
    console.error("Erreur accès session :", err);
    showError(codeError, `Erreur Firestore (${err?.code || "connexion"}).`);
  } finally {
    joinSubmitBtn.disabled = false;
  }
});

createSessionBtn.addEventListener("click", async () => {
  if (!state.authReady || !state.playerId) {
    showError(createError, "Connexion en cours, réessaie dans un instant.");
    return;
  }

  createSessionBtn.disabled = true;
  hideError(createError);

  try {
    let newCode = null;

    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateSessionCode();
      const ref = getSalonRef(candidate);
      const existing = await getDoc(ref);
      if (!existing.exists()) {
        newCode = candidate;
        break;
      }
    }

    if (!newCode) {
      showError(createError, "Impossible de générer un code disponible pour le moment.");
      return;
    }

    state.sessionCode = newCode;
    state.hostId = state.playerId;
    state.selectedThemeId = DEFAULT_THEME_ID;
    state.isNewSession = true;
    state.selectedColor = null;
    state.players = [];
    state.game = null;
    renderCounter([]);
    startSalonListener(newCode);

    profileCodeDisplay.textContent = newCode;
    profileModeBadge.textContent = "Nouvelle session";
    renderColorPicker();
    showScreen("profile");
    nameInput.focus();
  } catch (err) {
    console.error("Erreur création session :", err);
    showError(createError, `Impossible de créer la session (${err?.code || "erreur"}).`);
  } finally {
    createSessionBtn.disabled = false;
  }
});

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
  if (!state.sessionCode || !state.playerId) {
    showError(profileError, "Session invalide.");
    return;
  }

  submitProfileBtn.disabled = true;
  hideError(profileError);

  const newPlayer = {
    id: state.playerId,
    name: cleanName,
    color: chosenColor,
    ready: false,
    eliminated: false
  };

  try {
    const salonRef = getSalonRef(state.sessionCode);

    if (state.isNewSession) {
      const initialDoc = {
        code: state.sessionCode,
        hostId: state.playerId,
        themeId: normalizeThemeId(state.selectedThemeId),
        players: [newPlayer],
        game: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      };
      await setDoc(salonRef, initialDoc);
      state.isNewSession = false;
      state.hostId = state.playerId;
      state.players = [newPlayer];
      renderLobby();
      showScreen("lobby");
      return;
    }

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) {
        throw new Error("NOT_FOUND");
      }

      const data = snap.data();
      const existingPlayers = sanitizePlayersList(data.players);
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

      filtered.push(newPlayer);
      const resolvedHost = resolveHostId(data.hostId, filtered) || state.playerId;

      transaction.update(salonRef, {
        hostId: resolvedHost,
        players: filtered,
        updatedAt: serverTimestamp()
      });
    });

    renderLobby();
    showScreen("lobby");
  } catch (err) {
    if (err.message === "NOT_FOUND") {
      showError(profileError, "Cette session n'existe plus.");
    } else if (err.message === "IN_PROGRESS") {
      showError(profileError, "La partie vient de démarrer.");
    } else if (err.message === "FULL") {
      showError(profileError, `Limite de ${MAX_PLAYERS} joueurs atteinte.`);
    } else if (err.message === "COLOR_TAKEN") {
      state.selectedColor = null;
      renderColorPicker();
      showError(profileError, "Cette couleur vient d'être prise, choisis-en une autre.");
    } else {
      console.error("Erreur ajout joueur :", err);
      showError(profileError, `Impossible de rejoindre la session (${err?.code || "erreur"}).`);
    }
  } finally {
    submitProfileBtn.disabled = false;
  }
});

backToCodeBtn.addEventListener("click", async () => {
  const code = state.sessionCode;
  const wasNew = state.isNewSession;

  resetLocalSessionState();

  if (code && wasNew) {
    try {
      const ref = getSalonRef(code);
      const snap = await getDoc(ref);
      if (snap.exists() && sanitizePlayersList(snap.data().players).length === 0) {
        await deleteDoc(ref);
      }
    } catch (err) {
      console.error("Erreur nettoyage session vide :", err);
    }
  }
});

kickAllBtn.addEventListener("click", async () => {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  kickAllBtn.disabled = true;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const players = sanitizePlayersList(data.players);
      const currentHost = resolveHostId(data.hostId, players);
      if (currentHost !== state.playerId) return;

      const hostOnly = players
        .filter((p) => p.id === state.playerId)
        .map((p) => ({ ...p, ready: false, eliminated: false }));

      transaction.update(salonRef, {
        hostId: state.playerId,
        players: hostOnly,
        game: null,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur expulsion joueurs :", err);
  } finally {
    kickAllBtn.disabled = false;
  }
});

deleteSessionBtn.addEventListener("click", async () => {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  deleteSessionBtn.disabled = true;
  const code = state.sessionCode;

  try {
    const salonRef = getSalonRef(code);
    await deleteDoc(salonRef);
    resetLocalSessionState("Session supprimée.");
  } catch (err) {
    console.error("Erreur suppression session :", err);
  } finally {
    deleteSessionBtn.disabled = false;
  }
});

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

      const themeId = normalizeThemeId(data.themeId);
      const startNow = areAllPlayersReady(updatedPlayers);
      const nextGame = startNow ? createInitialGameState(updatedPlayers, themeId) : null;

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

async function leaveSession() {
  const code = state.sessionCode;
  const uid = state.playerId;

  nameInput.value = "";
  resetLocalSessionState();

  if (!code || !uid) return;

  try {
    const salonRef = getSalonRef(code);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;

      const data = snap.data();
      const updated = sanitizePlayersList(data.players).filter((p) => p.id !== uid);

      if (updated.length === 0) {
        transaction.delete(salonRef);
      } else {
        const nextHost =
          data.hostId === uid ? updated[0].id : resolveHostId(data.hostId, updated);
        transaction.update(salonRef, {
          hostId: nextHost,
          players: updated,
          game: updated.length < MIN_PLAYERS ? null : data.game || null,
          updatedAt: serverTimestamp()
        });
      }
    });
  } catch (err) {
    console.error("Erreur départ session :", err);
  }
}

leaveBtn.addEventListener("click", leaveSession);
gameLeaveBtn.addEventListener("click", leaveSession);

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

      const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
      const currentIdx = game.currentTurnIndex || 0;
      if (order[currentIdx] !== state.playerId) {
        throw new Error("NOT_YOUR_TURN");
      }

      if (game.turnDeadline && Date.now() > game.turnDeadline + 250) {
        throw new Error("TIME_EXPIRED");
      }

      const players = sanitizePlayersList(data.players);
      const me = players.find((p) => p.id === state.playerId);
      if (!me || me.eliminated) return;

      const updatedWords = { ...(game.words || {}), [state.playerId]: word };
      const nextGame = advanceWriteTurn(
        { ...game, words: updatedWords },
        Date.now()
      );

      transaction.update(salonRef, {
        game: nextGame,
        updatedAt: serverTimestamp()
      });
    });

    wordInput.value = "";
  } catch (err) {
    if (err.message === "NOT_YOUR_TURN") {
      showError(gameError, "Ce n'est pas ton tour d'écrire.");
    } else if (err.message === "TIME_EXPIRED") {
      showError(gameError, "Les 20 secondes sont écoulées : tu perds ton mot pour ce tour.");
    } else {
      console.error("Erreur envoi mot :", err);
      showError(gameError, "Impossible d'enregistrer ton mot.");
    }
  } finally {
    submitWordBtn.disabled = false;
  }
});

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
        const players = sanitizePlayersList(data.players);
        const nextOrder = buildTurnOrder(players);
        transaction.update(salonRef, {
          game: {
            ...game,
            round: (game.round || 1) + 1,
            turnOrder: nextOrder,
            currentTurnIndex: 0,
            turnDeadline: Date.now() + TURN_SECONDS * 1000,
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