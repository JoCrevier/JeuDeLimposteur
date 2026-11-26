import { db, getSalonRef, runTransaction, serverTimestamp } from "./firebase.js";
import {
  TURN_SECONDS,
  VOTE_SECONDS,
  sanitizePlayersList,
  advanceWriteTurn,
  resolveVotes
} from "./game.js";
import { state, dom } from "./state.js";

// Création des éléments UI des chronomètres
const turnBox = document.createElement("div");
turnBox.className = "turn-box";
export const turnStatusText = document.createElement("span");
turnStatusText.style.fontWeight = "600";
const turnTimerPill = document.createElement("span");
turnTimerPill.className = "timer-pill";
turnTimerPill.textContent = `${TURN_SECONDS}s`;
turnBox.append(turnStatusText, turnTimerPill);
dom.phaseWriteView.insertBefore(turnBox, dom.writeInstruction);

const voteTimerBox = document.createElement("div");
voteTimerBox.className = "turn-box";
Object.assign(voteTimerBox.style, {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "10px"
});
const voteTimerLabel = document.createElement("span");
voteTimerLabel.style.fontWeight = "600";
voteTimerLabel.textContent = "Temps restant pour voter";
const voteTimerPill = document.createElement("span");
voteTimerPill.className = "timer-pill";
voteTimerPill.textContent = `${VOTE_SECONDS}s`;
voteTimerBox.append(voteTimerLabel, voteTimerPill);
dom.phaseVoteView.insertBefore(voteTimerBox, dom.voteGrid);

export function stopTurnTimer() {
  if (state.turnTimerInterval) {
    clearInterval(state.turnTimerInterval);
    state.turnTimerInterval = null;
  }
}

export function stopVoteTimer() {
  if (state.voteTimerInterval) {
    clearInterval(state.voteTimerInterval);
    state.voteTimerInterval = null;
  }
}

function getRemainingSeconds(deadline, maxSeconds) {
  if (!deadline) return maxSeconds;
  const raw = Math.ceil((deadline - Date.now()) / 1000);
  return Math.max(0, Math.min(maxSeconds, raw));
}

function updateTurnTimerDisplay(game) {
  if (!game || game.phase !== "write") {
    stopTurnTimer();
    return;
  }

  const remaining = getRemainingSeconds(game.turnDeadline, TURN_SECONDS);
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
  state.turnTimerInterval = setInterval(() => updateTurnTimerDisplay(state.game), 250);
}

function updateVoteTimerDisplay(game) {
  if (!game || game.phase !== "vote") {
    stopVoteTimer();
    return;
  }

  const remaining = getRemainingSeconds(game.voteDeadline, VOTE_SECONDS);
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
  state.voteTimerInterval = setInterval(() => updateVoteTimerDisplay(state.game), 250);
}

async function handleTurnTimeout(expectedTurnIndex) {
  if (!state.sessionCode || !state.playerId) return;

  try {
    const salonRef = getSalonRef(state.sessionCode);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;

      const game = snap.data().game;
      if (!game || game.phase !== "write") return;

      const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
      const currentIdx = game.currentTurnIndex || 0;
      if (currentIdx !== expectedTurnIndex) return;
      if (Date.now() < (game.turnDeadline || 0) - 150) return;

      const activePlayerId = order[currentIdx];
      const updatedWords = { ...(game.words || {}) };
      if (activePlayerId && !(activePlayerId in updatedWords)) {
        updatedWords[activePlayerId] = null;
      }

      transaction.update(salonRef, {
        game: advanceWriteTurn({ ...game, words: updatedWords }, Date.now()),
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur expiration tour :", err);
  }
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
      if (game.voteDeadline && Date.now() < game.voteDeadline - 200) return;

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