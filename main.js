import {
  db,
  getSalonRef,
  initAnonymousSession,
  getDoc,
  setDoc,
  deleteDoc,
  runTransaction,
  serverTimestamp
} from "./firebase.js";

import {
  MIN_PLAYERS,
  MAX_PLAYERS,
  TURN_SECONDS,
  VOTE_SECONDS,
  ALLOWED_HEX_SET,
  THEMES,
  DEFAULT_THEME_ID,
  normalizeThemeId,
  pickSecretWord,
  generateSessionCode,
  sanitizePlayersList,
  resolveHostId,
  areAllPlayersReady,
  buildTurnOrder,
  createInitialGameState,
  advanceWriteTurn,
  resolveVotes
} from "./game.js";

import {
  attachSalonListener,
  detachSalonListener,
  persistSessionCodeForBoard,
  openBoardWindow,
  updateGameSessionCodeDisplay
} from "./sessionManager.js";

import {
  initRender,
  showScreen,
  showError,
  hideError,
  renderCounter,
  renderThemeSelector,
  renderColorPicker,
  renderLobby,
  renderGame
} from "./render.js";

import {
  initTimers,
  setupTimerDom
} from "./timers.js";

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
  voteTimerInterval: null,
  timeoutTriggeredForTurn: null,
  timeoutTriggeredForVoteRound: null
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
const profileModeBadge = document.getElementById("profileModeBadge");
const nameInput = document.getElementById("nameInput");
const profileForm = document.getElementById("profileForm");
const profileError = document.getElementById("profileError");
const colorsGrid = document.getElementById("colorsGrid");
const backToCodeBtn = document.getElementById("backToCodeBtn");
const submitProfileBtn = profileForm.querySelector('button[type="submit"]');

// Écran 3 : Salon & Hôte
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

// Initialisation des modules
initTimers(state);
setupTimerDom({ phaseWriteView, writeInstruction, phaseVoteView, voteGrid });

initRender({
  state,
  dom: {
    screens,
    profileError,
    minPlayersNotice,
    themeGrid,
    themeHint,
    playersGrid,
    playerCountText,
    statusDot,
    hostControls,
    kickAllBtn,
    toggleReadyBtn,
    colorsGrid,
    roundDisplay,
    phaseTitle,
    roleBanner,
    phaseWriteView,
    writeInstruction,
    wordForm,
    wordInput,
    submitWordBtn,
    writeProgressText,
    phaseDiscussView,
    wordsList,
    goToVoteBtn,
    phaseVoteView,
    voteGrid,
    voteProgressText,
    phaseResultView,
    resultBanner,
    nextRoundBtn
  },
  callbacks: {
    isCurrentUserHost,
    selectSessionTheme,
    castVote
  }
});

joinSubmitBtn.disabled = true;
createSessionBtn.disabled = true;

function isCurrentUserHost() {
  return Boolean(state.playerId && state.hostId && state.playerId === state.hostId);
}

function startSalonListener(code) {
  attachSalonListener(code, state, {
    screens,
    resetLocalSessionState,
    showScreen,
    renderGame,
    renderLobby,
    renderCounter,
    renderColorPicker
  });
}

function resetLocalSessionState(noticeMessage = "") {
  detachSalonListener(state);
  state.sessionCode = null;
  state.hostId = null;
  state.selectedThemeId = DEFAULT_THEME_ID;
  state.selectedColor = null;
  state.players = [];
  state.game = null;
  state.isNewSession = false;
  state.timeoutTriggeredForTurn = null;
  state.timeoutTriggeredForVoteRound = null;
  updateGameSessionCodeDisplay(null);
  renderCounter([]);
  showScreen("code");
  if (noticeMessage) {
    showError(codeError, noticeMessage);
  }
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
    updateGameSessionCodeDisplay(code);
    renderCounter(currentPlayers);
    startSalonListener(code);

    if (alreadyIn && state.game?.status === "playing") {
      renderGame();
      showScreen("game");
    } else if (alreadyIn) {
      renderLobby();
      showScreen("lobby");
    } else {
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
    updateGameSessionCodeDisplay(newCode);
    renderCounter([]);
    startSalonListener(newCode);

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
      persistSessionCodeForBoard(state.sessionCode);
      openBoardWindow(state.sessionCode);
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
      const nextGame = startNow ? createInitialGameState(updatedPlayers, themeId, Date.now()) : null;

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
      showError(gameError, `Les ${TURN_SECONDS} secondes sont écoulées : tu perds ton mot pour ce tour.`);
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
  hideError(gameError);

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
          votes: {},
          voteDeadline: Date.now() + VOTE_SECONDS * 1000
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
  hideError(gameError);

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game || game.phase !== "vote") return;

      if (game.voteDeadline && Date.now() > game.voteDeadline + 250) {
        throw new Error("VOTE_TIME_EXPIRED");
      }

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
          voteDeadline: null,
          phase: outcome.nextPhase,
          lastResult: outcome.resultData
        },
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    if (err.message === "VOTE_TIME_EXPIRED") {
      showError(gameError, `Le temps de vote (${VOTE_SECONDS}s) est écoulé.`);
    } else {
      console.error("Erreur vote :", err);
      showError(gameError, "Erreur lors de l'enregistrement du vote.");
    }
  }
}

nextRoundBtn.addEventListener("click", async () => {
  if (!state.sessionCode) return;
  nextRoundBtn.disabled = true;
  hideError(gameError);

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
        const safeThemeId = normalizeThemeId(data.themeId || game.themeId);
        const nextSecretWord = pickSecretWord(safeThemeId, game.secretWord || null);
        transaction.update(salonRef, {
          game: {
            ...game,
            round: (game.round || 1) + 1,
            themeId: safeThemeId,
            themeLabel: THEMES[safeThemeId]?.label || game.themeLabel,
            secretWord: nextSecretWord,
            turnOrder: nextOrder,
            currentTurnIndex: 0,
            turnDeadline: Date.now() + TURN_SECONDS * 1000,
            voteDeadline: null,
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