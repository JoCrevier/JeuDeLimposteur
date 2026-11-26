import {
  db,
  getSalonRef,
  runTransaction,
  serverTimestamp
} from "./firebase.js";

import {
  TURN_SECONDS,
  VOTE_SECONDS,
  sanitizePlayersList,
  advanceWriteTurn,
  resolveVotes
} from "./game.js";

let state = null;
let turnTimerPill = null;
let voteTimerPill = null;

export function initTimers(sharedState) {
  state = sharedState;
}

export function setupTimerDom({ phaseWriteView, writeInstruction, phaseVoteView, voteGrid }) {
  // Barre de tour actif + chronomètre d'écriture
  const turnBox = document.createElement("div");
  turnBox.className = "turn-box";
  const turnStatusText = document.createElement("span");
  turnStatusText.style.fontWeight = "600";
  turnTimerPill = document.createElement("span");
  turnTimerPill.className = "timer-pill";
  turnTimerPill.textContent = `${TURN_SECONDS}s`;
  turnBox.append(turnStatusText, turnTimerPill);
  phaseWriteView.insertBefore(turnBox, writeInstruction);

  // Barre de chronomètre de vote (60s)
  const voteTimerBox = document.createElement("div");
  voteTimerBox.className = "turn-box";
  voteTimerBox.style.display = "flex";
  voteTimerBox.style.justifyContent = "space-between";
  voteTimerBox.style.alignItems = "center";
  voteTimerBox.style.marginBottom = "10px";
  const voteTimerLabel = document.createElement("span");
  voteTimerLabel.style.fontWeight = "600";
  voteTimerLabel.textContent = "Temps restant pour voter";
  voteTimerPill = document.createElement("span");
  voteTimerPill.className = "timer-pill";
  voteTimerPill.textContent = `${VOTE_SECONDS}s`;
  voteTimerBox.append(voteTimerLabel, voteTimerPill);
  phaseVoteView.insertBefore(voteTimerBox, voteGrid);
}

export function setTurnStatusText(text) {
  const span = turnTimerPill?.previousSibling;
  if (span) span.textContent = text;
}

export function stopTurnTimer() {
  if (state?.turnTimerInterval) {
    clearInterval(state.turnTimerInterval);
    state.turnTimerInterval = null;
  }
}

export function stopVoteTimer() {
  if (state?.voteTimerInterval) {
    clearInterval(state.voteTimerInterval);
    state.voteTimerInterval = null;
  }
}

function getRemainingTurnSeconds(game) {
  if (!game?.turnDeadline) return TURN_SECONDS;
  const rawSeconds = Math.ceil((game.turnDeadline - Date.now()) / 1000);
  return Math.max(0, Math.min(TURN_SECONDS, rawSeconds));
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

export function startTurnTimer(game) {
  const turnKey = `${game?.round || 1}-${game?.currentTurnIndex || 0}`;
  if (state.timeoutTriggeredForTurn && !state.timeoutTriggeredForTurn.startsWith(turnKey)) {
    state.timeoutTriggeredForTurn = null;
  }
  stopTurnTimer();
  updateTurnTimerDisplay(game);
  state.turnTimerInterval = setInterval(() => {
    updateTurnTimerDisplay(state.game);
  }, 250);
}

function getRemainingVoteSeconds(game) {
  if (!game?.voteDeadline) return VOTE_SECONDS;
  const rawSeconds = Math.ceil((game.voteDeadline - Date.now()) / 1000);
  return Math.max(0, Math.min(VOTE_SECONDS, rawSeconds));
}

function updateVoteTimerDisplay(game) {
  if (!game || game.phase !== "vote") {
    stopVoteTimer();
    return;
  }

  const remaining = getRemainingVoteSeconds(game);
  voteTimerPill.textContent = `${remaining}s`;
  voteTimerPill.classList.toggle("urgent", remaining <= 10);

  if (remaining <= 0 && state.sessionCode && state.playerId) {
    const voteKey = `${game.round || 1}`;
    if (state.timeoutTriggeredForVoteRound !== voteKey) {
      state.timeoutTriggeredForVoteRound = voteKey;
      handleVoteTimeout();
    }
  }
}

export function startVoteTimer(game) {
  const voteKey = `${game?.round || 1}`;
  if (state.timeoutTriggeredForVoteRound && state.timeoutTriggeredForVoteRound !== voteKey) {
    state.timeoutTriggeredForVoteRound = null;
  }
  stopVoteTimer();
  updateVoteTimerDisplay(game);
  state.voteTimerInterval = setInterval(() => {
    updateVoteTimerDisplay(state.game);
  }, 250);
}

async function handleVoteTimeout() {
  if (!state.sessionCode || !state.playerId) return;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const data = snap.data();
      const game = data.game;
      if (!game || game.phase !== "vote") return;

      const deadline = game.voteDeadline || 0;
      if (deadline && Date.now() < deadline - 200) return;

      const players = sanitizePlayersList(data.players);
      const outcome = resolveVotes(players, game);

      transaction.update(salonRef, {
        players: outcome.updatedPlayers,
        game: {
          ...game,
          voteDeadline: null,
          phase: outcome.nextPhase,
          lastResult: outcome.resultData
        },
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur expiration vote :", err);
  }
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