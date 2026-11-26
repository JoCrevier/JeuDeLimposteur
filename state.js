import { DEFAULT_THEME_ID } from "./game.js";

export const state = {
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

export const screens = {
  code: document.getElementById("screenCode"),
  profile: document.getElementById("screenProfile"),
  lobby: document.getElementById("screenLobby"),
  game: document.getElementById("screenGame")
};

export const dom = {
  // Écran 1 : Créer ou Rejoindre
  modeJoinBtn: document.getElementById("modeJoinBtn"),
  modeCreateBtn: document.getElementById("modeCreateBtn"),
  joinForm: document.getElementById("joinForm"),
  createBox: document.getElementById("createBox"),
  codeInput: document.getElementById("codeInput"),
  codeError: document.getElementById("codeError"),
  createError: document.getElementById("createError"),
  joinSubmitBtn: document.getElementById("joinSubmitBtn"),
  createSessionBtn: document.getElementById("createSessionBtn"),

  // Écran 2 : Profil
  profileModeBadge: document.getElementById("profileModeBadge"),
  nameInput: document.getElementById("nameInput"),
  profileForm: document.getElementById("profileForm"),
  profileError: document.getElementById("profileError"),
  colorsGrid: document.getElementById("colorsGrid"),
  backToCodeBtn: document.getElementById("backToCodeBtn"),
  submitProfileBtn: document.querySelector('#profileForm button[type="submit"]'),

  // Écran 3 : Salon & Hôte
  minPlayersNotice: document.getElementById("minPlayersNotice"),
  themeGrid: document.getElementById("themeGrid"),
  themeHint: document.getElementById("themeHint"),
  playersGrid: document.getElementById("playersGrid"),
  playerCountText: document.getElementById("playerCountText"),
  statusDot: document.getElementById("statusDot"),
  hostControls: document.getElementById("hostControls"),
  kickAllBtn: document.getElementById("kickAllBtn"),
  deleteSessionBtn: document.getElementById("deleteSessionBtn"),
  leaveBtn: document.getElementById("leaveBtn"),
  toggleReadyBtn: document.getElementById("toggleReadyBtn"),

  // Écran 4 : Jeu
  roundDisplay: document.getElementById("roundDisplay"),
  phaseTitle: document.getElementById("phaseTitle"),
  roleBanner: document.getElementById("roleBanner"),
  gameError: document.getElementById("gameError"),

  phaseWriteView: document.getElementById("phaseWriteView"),
  writeInstruction: document.getElementById("writeInstruction"),
  wordForm: document.getElementById("wordForm"),
  wordInput: document.getElementById("wordInput"),
  submitWordBtn: document.getElementById("submitWordBtn"),
  writeProgressText: document.getElementById("writeProgressText"),

  phaseDiscussView: document.getElementById("phaseDiscussView"),
  wordsList: document.getElementById("wordsList"),
  goToVoteBtn: document.getElementById("goToVoteBtn"),

  phaseVoteView: document.getElementById("phaseVoteView"),
  voteGrid: document.getElementById("voteGrid"),
  voteProgressText: document.getElementById("voteProgressText"),

  phaseResultView: document.getElementById("phaseResultView"),
  resultBanner: document.getElementById("resultBanner"),
  gameLeaveBtn: document.getElementById("gameLeaveBtn"),
  nextRoundBtn: document.getElementById("nextRoundBtn")
};

export function isCurrentUserHost() {
  return Boolean(state.playerId && state.hostId && state.playerId === state.hostId);
}

export function persistSessionCodeForBoard(code) {
  if (!code) return;
  try {
    sessionStorage.setItem("activeSessionCode", code);
  } catch {
    // Ignorer si sessionStorage est indisponible
  }
}

export function openBoardWindow(code) {
  if (!code) return;
  persistSessionCodeForBoard(code);
  window.open(`board.html?code=${encodeURIComponent(code)}`, "_blank", "noopener,noreferrer");
}

export function showScreen(name) {
  Object.values(screens).forEach((s) => s.classList.remove("active"));
  screens[name]?.classList.add("active");
  if (name === "game" && state.sessionCode) {
    persistSessionCodeForBoard(state.sessionCode);
  }
}

export function showError(el, msg) {
  if (!el) return;
  el.textContent = msg;
  el.classList.add("visible");
}

export function hideError(el) {
  if (!el) return;
  el.textContent = "";
  el.classList.remove("visible");
}