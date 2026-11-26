import {
  getSalonRef,
  onSnapshot
} from "./firebase.js";

import {
  sanitizePlayersList,
  resolveHostId,
  normalizeThemeId
} from "./game.js";

import { stopTurnTimer, stopVoteTimer } from "./timers.js";

export function persistSessionCodeForBoard(code) {
  if (!code) return;
  try {
    sessionStorage.setItem("activeSessionCode", code);
  } catch (_) {
    // Ignorer si sessionStorage indisponible
  }
}

export function openBoardWindow(code) {
  if (!code) return;
  persistSessionCodeForBoard(code);
  const url = `board.html?code=${encodeURIComponent(code)}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

export function updateGameSessionCodeDisplay(code) {
  if (code) persistSessionCodeForBoard(code);
}

export function detachSalonListener(state) {
  stopTurnTimer();
  stopVoteTimer();
  if (state.unsubscribeSalon) {
    state.unsubscribeSalon();
    state.unsubscribeSalon = null;
  }
}

export function attachSalonListener(code, state, hooks) {
  detachSalonListener(state);
  state.unsubscribeSalon = onSnapshot(
    getSalonRef(code),
    (snap) => {
      if (!snap.exists()) {
        if (state.isNewSession && hooks.screens.profile.classList.contains("active")) {
          return;
        }
        const wasActive =
          hooks.screens.lobby.classList.contains("active") || hooks.screens.game.classList.contains("active");
        hooks.resetLocalSessionState(wasActive ? "La session a été supprimée par l'hôte." : "");
        return;
      }

      const data = snap.data();
      const hadJoinedRoom =
        hooks.screens.lobby.classList.contains("active") || hooks.screens.game.classList.contains("active");

      state.players = sanitizePlayersList(data.players);
      state.hostId = resolveHostId(data.hostId, state.players);
      state.selectedThemeId = normalizeThemeId(data.themeId);
      state.game = data.game || null;

      const meInRoom = state.players.some((p) => p.id === state.playerId);

      if (hadJoinedRoom && !meInRoom) {
        hooks.resetLocalSessionState("Tu as été expulsé de la session par l'hôte.");
        return;
      }

      if (meInRoom && state.game && state.game.status === "playing") {
        hooks.showScreen("game");
        hooks.renderGame();
        return;
      }

      if (hooks.screens.game.classList.contains("active") && !state.game) {
        hooks.showScreen("lobby");
      }

      if (hooks.screens.lobby.classList.contains("active")) {
        hooks.renderLobby();
      } else if (hooks.screens.profile.classList.contains("active")) {
        hooks.renderCounter(state.players);
        if (state.selectedColor && state.players.some((p) => p.color === state.selectedColor)) {
          state.selectedColor = null;
        }
        hooks.renderColorPicker();
      }
    },
    (err) => {
      console.error("Erreur temps réel Firestore :", err);
    }
  );
}