import {
  db,
  getSalonRef,
  initAnonymousSession,
  onSnapshot
} from "./firebase.js";

import {
  THEMES,
  DEFAULT_THEME_ID,
  TURN_SECONDS,
  VOTE_SECONDS,
  normalizeThemeId,
  sanitizePlayersList
} from "./game.js";

const boardCodeDisplay = document.getElementById("boardCodeDisplay");
const boardRoundDisplay = document.getElementById("boardRoundDisplay");
const boardPhaseDisplay = document.getElementById("boardPhaseDisplay");
const boardTimerPill = document.getElementById("boardTimerPill");
const liveIndicator = document.getElementById("liveIndicator");

const boardStage = document.getElementById("boardStage");
const submittedCountBadge = document.getElementById("submittedCountBadge");
const submittedWordsList = document.getElementById("submittedWordsList");

const votesPanel = document.getElementById("votesPanel");
const votesCountBadge = document.getElementById("votesCountBadge");
const votesBreakdownList = document.getElementById("votesBreakdownList");

const boardThemeTitle = document.getElementById("boardThemeTitle");
const boardStatusSubtext = document.getElementById("boardStatusSubtext");
const themeWordsCount = document.getElementById("themeWordsCount");
const themeWordsGrid = document.getElementById("themeWordsGrid");

const boardPlayersStrip = document.getElementById("boardPlayersStrip");
const boardResultBanner = document.getElementById("boardResultBanner");

let currentSalonData = null;
let unsubscribeSalon = null;
let timerInterval = null;

function getCodeFromUrlOrStorage() {
  const params = new URLSearchParams(window.location.search);
  const queryCode = (params.get("code") || "").replace(/\D/g, "").slice(0, 5);
  if (/^\d{5}$/.test(queryCode)) {
    return queryCode;
  }

  try {
    const saved = (sessionStorage.getItem("activeSessionCode") || "").replace(/\D/g, "").slice(0, 5);
    if (/^\d{5}$/.test(saved)) {
      return saved;
    }
  } catch (_) {
    // Ignorer si sessionStorage est indisponible
  }

  return null;
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
}

function updateBoardTimer() {
  const game = currentSalonData?.game;
  if (!game || game.status !== "playing") {
    boardTimerPill.classList.add("hidden");
    stopTimer();
    return;
  }

  if (game.phase === "write" && game.turnDeadline) {
    const sec = Math.max(0, Math.min(TURN_SECONDS, Math.ceil((game.turnDeadline - Date.now()) / 1000)));
    boardTimerPill.classList.remove("hidden");
    boardTimerPill.textContent = `Écriture : ${sec}s`;
    boardTimerPill.classList.toggle("urgent", sec <= 5);
    return;
  }

  if (game.phase === "vote" && game.voteDeadline) {
    const sec = Math.max(0, Math.min(VOTE_SECONDS, Math.ceil((game.voteDeadline - Date.now()) / 1000)));
    boardTimerPill.classList.remove("hidden");
    boardTimerPill.textContent = `Vote : ${sec}s`;
    boardTimerPill.classList.toggle("urgent", sec <= 10);
    return;
  }

  boardTimerPill.classList.add("hidden");
}

function startTimerIfNeeded() {
  stopTimer();
  updateBoardTimer();
  timerInterval = setInterval(updateBoardTimer, 250);
}

function countVotesAnonymously(players, game) {
  const counts = {};
  const activePlayers = players.filter((p) => !p.eliminated);
  const activeIds = new Set(activePlayers.map((p) => p.id));

  activePlayers.forEach((p) => {
    counts[p.id] = 0;
  });

  // On ignore volontairement les clés (qui a voté) pour ne garder que le total par cible
  const votesMap = game?.votes && typeof game.votes === "object" ? game.votes : {};
  Object.entries(votesMap).forEach(([voterId, targetId]) => {
    if (activeIds.has(voterId) && targetId in counts) {
      counts[targetId] += 1;
    }
  });

  return counts;
}

function renderVotesPanel(players, game) {
  if (!votesPanel || !votesBreakdownList || !votesCountBadge) return;

  const isVotePhase = game?.status === "playing" && game.phase === "vote";
  votesPanel.classList.toggle("hidden", !isVotePhase);
  boardStage?.classList.toggle("has-votes", Boolean(isVotePhase));

  if (!isVotePhase) {
    votesBreakdownList.innerHTML = "";
    return;
  }

  const activePlayers = players.filter((p) => !p.eliminated);
  const counts = countVotesAnonymously(players, game);
  const totalVotes = Object.values(counts).reduce((sum, n) => sum + n, 0);

  votesCountBadge.textContent = `${totalVotes} ${totalVotes > 1 ? "votes" : "vote"}`;
  votesBreakdownList.innerHTML = "";

  const sortedTargets = [...activePlayers].sort((a, b) => (counts[b.id] || 0) - (counts[a.id] || 0));

  sortedTargets.forEach((target) => {
    const nbVotes = counts[target.id] || 0;

    const card = document.createElement("div");
    card.className = "vote-row-card" + (nbVotes > 0 ? " has-votes" : "");

    const left = document.createElement("div");
    left.className = "vote-row-player";

    const dot = document.createElement("span");
    dot.className = "author-dot";
    dot.style.backgroundColor = target.color;

    const nameSpan = document.createElement("span");
    nameSpan.textContent = target.name;

    left.append(dot, nameSpan);

    const badge = document.createElement("span");
    badge.className = "vote-count-pill";
    badge.textContent = `${nbVotes} ${nbVotes > 1 ? "votes" : "vote"}`;

    card.append(left, badge);
    votesBreakdownList.appendChild(card);
  });
}

function renderThemeWords(themeId) {
  const safeId = normalizeThemeId(themeId);
  const theme = THEMES[safeId] || THEMES[DEFAULT_THEME_ID];
  const words = Array.isArray(theme.words) ? theme.words : [];

  boardThemeTitle.textContent = theme.label;
  themeWordsCount.textContent = `${words.length} ${words.length > 1 ? "mots" : "mot"}`;
  themeWordsGrid.innerHTML = "";

  words.forEach((word) => {
    const chip = document.createElement("div");
    chip.className = "theme-word-chip";
    chip.textContent = word;
    themeWordsGrid.appendChild(chip);
  });
}

function renderSubmittedWords(players, game) {
  const wordsMap = game?.words && typeof game.words === "object" ? game.words : {};
  const turnOrder = Array.isArray(game?.turnOrder) ? game.turnOrder : [];

  const orderedIds = [];
  turnOrder.forEach((id) => {
    if (id in wordsMap && !orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  });
  Object.keys(wordsMap).forEach((id) => {
    if (!orderedIds.includes(id)) {
      orderedIds.push(id);
    }
  });

  const validCount = orderedIds.filter((id) => Boolean(wordsMap[id])).length;
  submittedCountBadge.textContent = `${validCount} ${validCount > 1 ? "mots" : "mot"}`;

  submittedWordsList.innerHTML = "";
  if (orderedIds.length === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "empty-words-state";
    emptyEl.textContent =
      game?.status === "playing"
        ? "Aucun mot écrit pour le moment. Les mots apparaîtront ici dès qu'un joueur valide son tour."
        : "En attente du début de la partie pour afficher les mots écrits.";
    submittedWordsList.appendChild(emptyEl);
    return;
  }

  orderedIds.forEach((playerId) => {
    const player = players.find((p) => p.id === playerId);
    const wordValue = wordsMap[playerId];

    const card = document.createElement("div");
    card.className = "submitted-word-card";
    if (player?.color) {
      card.style.borderLeftColor = player.color;
    }

    const author = document.createElement("div");
    author.className = "submitted-word-author";

    const dot = document.createElement("span");
    dot.className = "author-dot";
    dot.style.backgroundColor = player?.color || "#6366f1";

    const nameSpan = document.createElement("span");
    nameSpan.textContent = player?.name || "Joueur";

    author.append(dot, nameSpan);

    const wordEl = document.createElement("div");
    if (wordValue) {
      wordEl.className = "submitted-word-text";
      wordEl.textContent = wordValue;
    } else {
      wordEl.className = "submitted-word-text missed";
      wordEl.textContent = "Temps écoulé — aucun mot";
    }

    card.append(author, wordEl);
    submittedWordsList.appendChild(card);
  });
}

function renderPlayersStrip(players, game) {
  boardPlayersStrip.innerHTML = "";
  if (!players.length) {
    const placeholder = document.createElement("span");
    placeholder.style.color = "var(--text-muted)";
    placeholder.textContent = "Aucun joueur connecté pour le moment.";
    boardPlayersStrip.appendChild(placeholder);
    return;
  }

  const activeTurnPlayerId =
    game?.status === "playing" && game.phase === "write" && Array.isArray(game.turnOrder)
      ? game.turnOrder[game.currentTurnIndex || 0]
      : null;

  players.forEach((p) => {
    const chip = document.createElement("div");
    chip.className =
      "player-chip" +
      (p.id === activeTurnPlayerId ? " active-turn" : "") +
      (p.eliminated ? " eliminated" : "");

    const dot = document.createElement("span");
    dot.className = "author-dot";
    dot.style.backgroundColor = p.color;

    const label = document.createElement("span");
    label.textContent = p.name + (p.id === activeTurnPlayerId ? " (écrit...)" : "");

    chip.append(dot, label);
    boardPlayersStrip.appendChild(chip);
  });
}

function renderBoard(data) {
  currentSalonData = data;
  const resolvedCode = data?.code || getCodeFromUrlOrStorage() || "-----";
  boardCodeDisplay.textContent = resolvedCode;

  if (!data) {
    liveIndicator.classList.add("waiting");
    boardRoundDisplay.textContent = "Session introuvable";
    boardPhaseDisplay.textContent = "Hors ligne";
    boardStatusSubtext.textContent =
      "Aucune session trouvée. Crée ou rejoins une session depuis l'écran joueur.";
    renderThemeWords(DEFAULT_THEME_ID);
    renderSubmittedWords([], null);
    renderVotesPanel([], null);
    renderPlayersStrip([], null);
    boardResultBanner.classList.add("hidden");
    stopTimer();
    return;
  }

  liveIndicator.classList.remove("waiting");
  const players = sanitizePlayersList(data.players);
  const game = data.game || null;
  const themeId = game?.themeId || data.themeId || DEFAULT_THEME_ID;

  renderThemeWords(themeId);
  renderSubmittedWords(players, game);
  renderVotesPanel(players, game);
  renderPlayersStrip(players, game);

  if (game && game.status === "playing") {
    boardRoundDisplay.textContent = `Manche ${game.round || 1}`;
    if (game.phase === "write") {
      boardPhaseDisplay.textContent = "Phase 1 : Écriture";
      const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
      const currentPlayer = players.find((p) => p.id === order[game.currentTurnIndex || 0]);
      boardStatusSubtext.textContent = currentPlayer
        ? `C'est au tour de ${currentPlayer.name} d'écrire un mot.`
        : "Phase d'écriture en cours.";
    } else if (game.phase === "discuss") {
      boardPhaseDisplay.textContent = "Phase 2 : Délibération";
      boardStatusSubtext.textContent = "Observez les mots écrits à gauche et discutez ensemble.";
    } else if (game.phase === "vote") {
      boardPhaseDisplay.textContent = "Phase 3 : Vote (60s)";
      boardStatusSubtext.textContent = "Les joueurs votent sur leur écran. Le nombre de votes s'affiche en direct.";
    } else if (game.phase === "result") {
      boardPhaseDisplay.textContent = "Résultat de la manche";
      boardStatusSubtext.textContent = "Préparation de la manche suivante...";
    } else if (game.phase === "finished") {
      boardPhaseDisplay.textContent = "Partie terminée";
      boardStatusSubtext.textContent = "Retour au salon en cours ou prochaine partie.";
    }
  } else {
    boardRoundDisplay.textContent = "Salon d'attente";
    boardPhaseDisplay.textContent = `${players.length} joueur(s)`;
    boardStatusSubtext.textContent =
      "Tous les joueurs doivent se mettre « Prêt » sur leur téléphone pour lancer la partie.";
  }

  if (game?.lastResult?.message) {
    boardResultBanner.textContent = game.lastResult.message;
    boardResultBanner.classList.remove("hidden");
  } else {
    boardResultBanner.classList.add("hidden");
  }

  startTimerIfNeeded();
}

function listenToSession(code) {
  if (unsubscribeSalon) {
    unsubscribeSalon();
    unsubscribeSalon = null;
  }

  unsubscribeSalon = onSnapshot(
    getSalonRef(code),
    (snap) => {
      if (!snap.exists()) {
        renderBoard(null);
        return;
      }
      renderBoard(snap.data());
    },
    (err) => {
      console.error("Erreur écoute tableau principal :", err);
    }
  );
}

const initialCode = getCodeFromUrlOrStorage();
if (initialCode) {
  boardCodeDisplay.textContent = initialCode;
}
renderThemeWords(DEFAULT_THEME_ID);
renderSubmittedWords([], null);
renderVotesPanel([], null);
renderPlayersStrip([], null);

initAnonymousSession(
  () => {
    const code = getCodeFromUrlOrStorage();
    if (code) {
      listenToSession(code);
    } else {
      boardStatusSubtext.textContent =
        "Ajoute ?code=12345 dans l'adresse ou ouvre cet écran depuis une session créée.";
    }
  },
  (err) => {
    console.error("Erreur auth écran principal :", err);
    boardStatusSubtext.textContent = "Erreur de connexion à la session.";
  }
);