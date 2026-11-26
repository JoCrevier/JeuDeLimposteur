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
  state,
  screens,
  dom,
  isCurrentUserHost,
  persistSessionCodeForBoard,
  openBoardWindow,
  showScreen,
  showError,
  hideError
} from "./state.js";

import { stopTurnTimer, stopVoteTimer } from "./timers.js";
import {
  renderCounter,
  renderColorPicker,
  renderThemeSelector,
  renderLobby,
  renderGame
} from "./ui.js";

dom.joinSubmitBtn.disabled = true;
dom.createSessionBtn.disabled = true;

import { initBackgroundAnimations } from "./bg-animation.js";
initBackgroundAnimations(11);

function stopSalonListener() {
  stopTurnTimer();
  stopVoteTimer();
  if (state.unsubscribeSalon) {
    state.unsubscribeSalon();
    state.unsubscribeSalon = null;
  }
}

function resetLocalSessionState(noticeMessage = "") {
  stopSalonListener();
  Object.assign(state, {
    sessionCode: null,
    hostId: null,
    selectedThemeId: DEFAULT_THEME_ID,
    selectedColor: null,
    players: [],
    game: null,
    isNewSession: false,
    timeoutTriggeredForTurn: null,
    timeoutTriggeredForVoteRound: null
  });
  renderCounter([]);
  showScreen("code");
  if (noticeMessage) showError(dom.codeError, noticeMessage);
}

// Helper centralisé pour exécuter une transaction sur le salon courant
async function updateSalonTransaction(callback) {
  if (!state.sessionCode) return;
  const salonRef = getSalonRef(state.sessionCode);
  return runTransaction(db, async (transaction) => {
    const snap = await transaction.get(salonRef);
    if (!snap.exists()) return null;
    return callback(transaction, salonRef, snap.data());
  });
}

// Actions liées au salon & au jeu
async function selectSessionTheme(themeId) {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  const safeThemeId = normalizeThemeId(themeId);
  state.selectedThemeId = safeThemeId;
  renderThemeSelector(selectSessionTheme);

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
      const currentHost = resolveHostId(data.hostId, sanitizePlayersList(data.players));
      if (currentHost !== state.playerId) return;
      transaction.update(salonRef, { themeId: safeThemeId, updatedAt: serverTimestamp() });
    });
  } catch (err) {
    console.error("Erreur sélection thème :", err);
  }
}

async function castVote(targetId) {
  if (!state.sessionCode || !state.playerId || targetId === state.playerId) return;
  hideError(dom.gameError);

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
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
          game: { ...game, votes: updatedVotes },
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
      showError(dom.gameError, "Le temps de vote (60s) est écoulé.");
    } else {
      console.error("Erreur vote :", err);
      showError(dom.gameError, "Erreur lors de l'enregistrement du vote.");
    }
  }
}

function startSalonListener(code) {
  stopSalonListener();
  state.unsubscribeSalon = onSnapshot(
    getSalonRef(code),
    (snap) => {
      if (!snap.exists()) {
        if (state.isNewSession && screens.profile.classList.contains("active")) return;
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

      if (meInRoom && state.game?.status === "playing") {
        showScreen("game");
        renderGame(castVote);
        return;
      }

      if (screens.game.classList.contains("active") && !state.game) {
        showScreen("lobby");
      }

      if (screens.lobby.classList.contains("active")) {
        renderLobby(selectSessionTheme);
      } else if (screens.profile.classList.contains("active")) {
        renderCounter(state.players);
        if (state.selectedColor && state.players.some((p) => p.color === state.selectedColor)) {
          state.selectedColor = null;
        }
        renderColorPicker();
      }
    },
    (err) => console.error("Erreur temps réel Firestore :", err)
  );
}

// Initialisation de l'authentification anonyme
initAnonymousSession(
  (uid) => {
    state.playerId = uid;
    state.authReady = true;
    dom.joinSubmitBtn.disabled = false;
    dom.createSessionBtn.disabled = false;
  },
  (err) => {
    console.error("Erreur initialisation auth :", err);
    showError(dom.codeError, "Impossible d'initialiser la session sécurisée.");
    showError(dom.createError, "Impossible d'initialiser la session sécurisée.");
  }
);

// Événements Écran 1 : Accueil (Rejoindre / Créer)
function switchEntryMode(mode) {
  const isJoin = mode === "join";
  dom.modeJoinBtn.classList.toggle("active", isJoin);
  dom.modeCreateBtn.classList.toggle("active", !isJoin);
  dom.joinForm.classList.toggle("hidden", !isJoin);
  dom.createBox.classList.toggle("hidden", isJoin);
  hideError(dom.codeError);
  hideError(dom.createError);
}

dom.modeJoinBtn.addEventListener("click", () => switchEntryMode("join"));
dom.modeCreateBtn.addEventListener("click", () => switchEntryMode("create"));

dom.codeInput.addEventListener("input", () => {
  dom.codeInput.value = dom.codeInput.value.replace(/\D/g, "").slice(0, 5);
  hideError(dom.codeError);
});

dom.joinForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.authReady || !state.playerId) {
    showError(dom.codeError, "Connexion en cours, réessaie dans un instant.");
    return;
  }

  const code = dom.codeInput.value.trim();
  if (!/^\d{5}$/.test(code)) {
    showError(dom.codeError, "Le code doit contenir exactement 5 chiffres.");
    return;
  }

  dom.joinSubmitBtn.disabled = true;
  hideError(dom.codeError);

  try {
    const salonRef = getSalonRef(code);
    const snap = await getDoc(salonRef);

    if (!snap.exists()) {
      showError(dom.codeError, "Aucune session active trouvée avec ce code.");
      return;
    }

    const data = snap.data();
    const currentPlayers = sanitizePlayersList(data.players);

    if (currentPlayers.length === 0) {
      await deleteDoc(salonRef);
      showError(dom.codeError, "Cette session est vide et a été fermée.");
      return;
    }

    const alreadyIn = currentPlayers.some((p) => p.id === state.playerId);

    if (!alreadyIn && data?.game?.status === "playing") {
      showError(dom.codeError, "Une partie est déjà en cours dans cette session.");
      return;
    }

    if (!alreadyIn && currentPlayers.length >= MAX_PLAYERS) {
      showError(dom.codeError, `Cette session est complète (${MAX_PLAYERS}/${MAX_PLAYERS} joueurs maximum).`);
      return;
    }

    Object.assign(state, {
      sessionCode: code,
      hostId: resolveHostId(data.hostId, currentPlayers),
      selectedThemeId: normalizeThemeId(data.themeId),
      isNewSession: false,
      selectedColor: null,
      players: currentPlayers,
      game: data?.game || null
    });

    persistSessionCodeForBoard(code);
    renderCounter(currentPlayers);
    startSalonListener(code);

    if (alreadyIn && state.game?.status === "playing") {
      renderGame(castVote);
      showScreen("game");
    } else if (alreadyIn) {
      renderLobby(selectSessionTheme);
      showScreen("lobby");
    } else {
      dom.profileModeBadge.textContent = "Session active";
      renderColorPicker();
      showScreen("profile");
      dom.nameInput.focus();
    }
  } catch (err) {
    console.error("Erreur accès session :", err);
    showError(dom.codeError, `Erreur Firestore (${err?.code || "connexion"}).`);
  } finally {
    dom.joinSubmitBtn.disabled = false;
  }
});

dom.createSessionBtn.addEventListener("click", async () => {
  if (!state.authReady || !state.playerId) {
    showError(dom.createError, "Connexion en cours, réessaie dans un instant.");
    return;
  }

  dom.createSessionBtn.disabled = true;
  hideError(dom.createError);

  try {
    let newCode = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const candidate = generateSessionCode();
      const existing = await getDoc(getSalonRef(candidate));
      if (!existing.exists()) {
        newCode = candidate;
        break;
      }
    }

    if (!newCode) {
      showError(dom.createError, "Impossible de générer un code disponible pour le moment.");
      return;
    }

    Object.assign(state, {
      sessionCode: newCode,
      hostId: state.playerId,
      selectedThemeId: DEFAULT_THEME_ID,
      isNewSession: true,
      selectedColor: null,
      players: [],
      game: null
    });

    persistSessionCodeForBoard(newCode);
    renderCounter([]);
    startSalonListener(newCode);

    dom.profileModeBadge.textContent = "Nouvelle session";
    renderColorPicker();
    showScreen("profile");
    dom.nameInput.focus();
  } catch (err) {
    console.error("Erreur création session :", err);
    showError(dom.createError, `Impossible de créer la session (${err?.code || "erreur"}).`);
  } finally {
    dom.createSessionBtn.disabled = false;
  }
});

// Événements Écran 2 : Profil
dom.profileForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const cleanName = dom.nameInput.value.trim().slice(0, 20);
  const chosenColor = state.selectedColor;

  if (!cleanName) return showError(dom.profileError, "Merci d'inscrire ton nom.");
  if (!chosenColor || !ALLOWED_HEX_SET.has(chosenColor)) {
    return showError(dom.profileError, "Merci de choisir une couleur valide.");
  }
  if (!state.sessionCode || !state.playerId) {
    return showError(dom.profileError, "Session invalide.");
  }

  dom.submitProfileBtn.disabled = true;
  hideError(dom.profileError);

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
      await setDoc(salonRef, {
        code: state.sessionCode,
        hostId: state.playerId,
        themeId: normalizeThemeId(state.selectedThemeId),
        players: [newPlayer],
        game: null,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      state.isNewSession = false;
      state.hostId = state.playerId;
      state.players = [newPlayer];
      openBoardWindow(state.sessionCode);
      renderLobby(selectSessionTheme);
      showScreen("lobby");
      return;
    }

    const res = await updateSalonTransaction((transaction, ref, data) => {
      const existingPlayers = sanitizePlayersList(data.players);
      const filtered = existingPlayers.filter((p) => p.id !== state.playerId);

      if (data?.game?.status === "playing") throw new Error("IN_PROGRESS");
      if (filtered.length >= MAX_PLAYERS) throw new Error("FULL");
      if (filtered.some((p) => p.color === chosenColor)) throw new Error("COLOR_TAKEN");

      filtered.push(newPlayer);
      const resolvedHost = resolveHostId(data.hostId, filtered) || state.playerId;

      transaction.update(ref, {
        hostId: resolvedHost,
        players: filtered,
        updatedAt: serverTimestamp()
      });
      return true;
    });

    if (res === null) throw new Error("NOT_FOUND");

    renderLobby(selectSessionTheme);
    showScreen("lobby");
  } catch (err) {
    const errorMap = {
      NOT_FOUND: "Cette session n'existe plus.",
      IN_PROGRESS: "La partie vient de démarrer.",
      FULL: `Limite de ${MAX_PLAYERS} joueurs atteinte.`,
      COLOR_TAKEN: "Cette couleur vient d'être prise, choisis-en une autre."
    };

    if (err.message === "COLOR_TAKEN") {
      state.selectedColor = null;
      renderColorPicker();
    }

    if (errorMap[err.message]) {
      showError(dom.profileError, errorMap[err.message]);
    } else {
      console.error("Erreur ajout joueur :", err);
      showError(dom.profileError, `Impossible de rejoindre la session (${err?.code || "erreur"}).`);
    }
  } finally {
    dom.submitProfileBtn.disabled = false;
  }
});

dom.backToCodeBtn.addEventListener("click", async () => {
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

// Événements Écran 3 : Salon & Hôte
dom.kickAllBtn.addEventListener("click", async () => {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  dom.kickAllBtn.disabled = true;

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
      const players = sanitizePlayersList(data.players);
      if (resolveHostId(data.hostId, players) !== state.playerId) return;

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
    dom.kickAllBtn.disabled = false;
  }
});

dom.deleteSessionBtn.addEventListener("click", async () => {
  if (!isCurrentUserHost() || !state.sessionCode) return;
  dom.deleteSessionBtn.disabled = true;
  const code = state.sessionCode;

  try {
    await deleteDoc(getSalonRef(code));
    resetLocalSessionState("Session supprimée.");
  } catch (err) {
    console.error("Erreur suppression session :", err);
  } finally {
    dom.deleteSessionBtn.disabled = false;
  }
});

dom.toggleReadyBtn.addEventListener("click", async () => {
  if (!state.sessionCode || !state.playerId) return;
  dom.toggleReadyBtn.disabled = true;

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
      if (data.game?.status === "playing") return;

      const updatedPlayers = sanitizePlayersList(data.players).map((p) =>
        p.id === state.playerId ? { ...p, ready: !p.ready, eliminated: false } : p
      );

      const themeId = normalizeThemeId(data.themeId);
      const nextGame = areAllPlayersReady(updatedPlayers)
        ? createInitialGameState(updatedPlayers, themeId, Date.now())
        : null;

      transaction.update(salonRef, {
        players: updatedPlayers,
        game: nextGame,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur statut prêt :", err);
  } finally {
    dom.toggleReadyBtn.disabled = false;
  }
});

async function leaveSession() {
  const code = state.sessionCode;
  const uid = state.playerId;

  dom.nameInput.value = "";
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

dom.leaveBtn.addEventListener("click", leaveSession);
dom.gameLeaveBtn.addEventListener("click", leaveSession);

// Événements Écran 4 : Phases de jeu
dom.wordForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const word = dom.wordInput.value.trim().slice(0, 30);
  if (!word || !state.sessionCode || !state.playerId) return;

  dom.submitWordBtn.disabled = true;
  hideError(dom.gameError);

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
      const game = data.game;
      if (!game || game.phase !== "write") return;

      const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
      const currentIdx = game.currentTurnIndex || 0;
      if (order[currentIdx] !== state.playerId) throw new Error("NOT_YOUR_TURN");
      if (game.turnDeadline && Date.now() > game.turnDeadline + 250) {
        throw new Error("TIME_EXPIRED");
      }

      const me = sanitizePlayersList(data.players).find((p) => p.id === state.playerId);
      if (!me || me.eliminated) return;

      const updatedWords = { ...(game.words || {}), [state.playerId]: word };
      transaction.update(salonRef, {
        game: advanceWriteTurn({ ...game, words: updatedWords }, Date.now()),
        updatedAt: serverTimestamp()
      });
    });

    dom.wordInput.value = "";
  } catch (err) {
    if (err.message === "NOT_YOUR_TURN") {
      showError(dom.gameError, "Ce n'est pas ton tour d'écrire.");
    } else if (err.message === "TIME_EXPIRED") {
      showError(dom.gameError, "Les 20 secondes sont écoulées : tu perds ton mot pour ce tour.");
    } else {
      console.error("Erreur envoi mot :", err);
      showError(dom.gameError, "Impossible d'enregistrer ton mot.");
    }
  } finally {
    dom.submitWordBtn.disabled = false;
  }
});

dom.goToVoteBtn.addEventListener("click", async () => {
  if (!state.sessionCode || !state.playerId) return;
  dom.goToVoteBtn.disabled = true;
  hideError(dom.gameError);

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
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
    dom.goToVoteBtn.disabled = false;
  }
});

dom.nextRoundBtn.addEventListener("click", async () => {
  if (!state.sessionCode) return;
  dom.nextRoundBtn.disabled = true;
  hideError(dom.gameError);

  try {
    await updateSalonTransaction((transaction, salonRef, data) => {
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
        const safeThemeId = normalizeThemeId(data.themeId || game.themeId);
        transaction.update(salonRef, {
          game: {
            ...game,
            round: (game.round || 1) + 1,
            themeId: safeThemeId,
            themeLabel: THEMES[safeThemeId]?.label || game.themeLabel,
            secretWord: pickSecretWord(safeThemeId, game.secretWord || null),
            turnOrder: buildTurnOrder(players),
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
    dom.nextRoundBtn.disabled = false;
  }
});

