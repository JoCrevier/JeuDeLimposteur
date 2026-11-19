export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;
export const TURN_SECONDS = 20;

export const PALETTE = [
  { name: "Rouge", hex: "#ef4444" },
  { name: "Orange", hex: "#f97316" },
  { name: "Ambre", hex: "#f59e0b" },
  { name: "Citron", hex: "#84cc16" },
  { name: "Émeraude", hex: "#10b981" },
  { name: "Cyan", hex: "#06b6d4" },
  { name: "Bleu", hex: "#3b82f6" },
  { name: "Indigo", hex: "#6366f1" },
  { name: "Violet", hex: "#a855f7" },
  { name: "Rose", hex: "#ec4899" },
  { name: "Corail", hex: "#fb7185" },
  { name: "Menthe", hex: "#2dd4bf" },
  { name: "Or", hex: "#eab308" },
  { name: "Ciel", hex: "#38bdf8" }
];

export const ALLOWED_HEX_SET = new Set(PALETTE.map((c) => c.hex));

// 5 thèmes maximum, 10 mots par thème
export const THEMES = {
  espace: {
    id: "espace",
    label: "Espace",
    words: [
      "Télescope",
      "Éclipse",
      "Astéroïde",
      "Supernova",
      "Satellite",
      "Cratère",
      "Cosmonaute",
      "Constellation",
      "Comète",
      "Gravité"
    ]
  },
  ocean: {
    id: "ocean",
    label: "Océan",
    words: [
      "Voilier",
      "Sous-marin",
      "Phare",
      "Glacier",
      "Récif",
      "Abysses",
      "Harpon",
      "Archipel",
      "Mousson",
      "Boussole"
    ]
  },
  medieval: {
    id: "medieval",
    label: "Médiéval",
    words: [
      "Forteresse",
      "Labyrinthe",
      "Cathédrale",
      "Blason",
      "Pont-levis",
      "Catapulte",
      "Chevalier",
      "Donjon",
      "Grimoire",
      "Tournoi"
    ]
  },
  gastronomie: {
    id: "gastronomie",
    label: "Gastronomie",
    words: [
      "Croissant",
      "Fondue",
      "Truffe",
      "Macaron",
      "Épice",
      "Levain",
      "Cannelle",
      "Bistro",
      "Saffran",
      "Tiramisu"
    ]
  },
  cinema: {
    id: "cinema",
    label: "Cinéma",
    words: [
      "Scénario",
      "Projecteur",
      "Doublage",
      "Générique",
      "Clap",
      "Caméra",
      "Cascades",
      "Bande-son",
      "Caméo",
      "Avant-première"
    ]
  }
};

export const THEME_LIST = Object.values(THEMES).slice(0, 5);
export const DEFAULT_THEME_ID = THEME_LIST[0].id;

export function normalizeThemeId(themeId) {
  return typeof themeId === "string" && themeId in THEMES ? themeId : DEFAULT_THEME_ID;
}

export function generateSessionCode() {
  return String(Math.floor(10000 + Math.random() * 90000));
}

export function sanitizePlayersList(rawPlayers) {
  if (!Array.isArray(rawPlayers)) return [];
  return rawPlayers
    .filter(
      (p) =>
        p &&
        typeof p.id === "string" &&
        typeof p.name === "string" &&
        typeof p.color === "string" &&
        ALLOWED_HEX_SET.has(p.color)
    )
    .slice(0, MAX_PLAYERS)
    .map((p) => ({
      id: p.id,
      name: p.name.trim().slice(0, 20) || "Joueur",
      color: p.color,
      ready: Boolean(p.ready),
      eliminated: Boolean(p.eliminated)
    }));
}

export function resolveHostId(rawHostId, players) {
  if (typeof rawHostId === "string" && players.some((p) => p.id === rawHostId)) {
    return rawHostId;
  }
  return players[0]?.id || null;
}

export function areAllPlayersReady(players) {
  return players.length >= MIN_PLAYERS && players.every((p) => p.ready === true);
}

export function buildTurnOrder(players) {
  const activeIds = players.filter((p) => !p.eliminated).map((p) => p.id);
  for (let i = activeIds.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [activeIds[i], activeIds[j]] = [activeIds[j], activeIds[i]];
  }
  return activeIds;
}

export function createInitialGameState(players, themeId = DEFAULT_THEME_ID, nowMs = Date.now()) {
  const safeThemeId = normalizeThemeId(themeId);
  const theme = THEMES[safeThemeId];
  const pool = theme.words;
  const randomWord = pool[Math.floor(Math.random() * pool.length)];
  const randomImpostor = players[Math.floor(Math.random() * players.length)];
  const turnOrder = buildTurnOrder(players);

  return {
    status: "playing",
    phase: turnOrder.length > 0 ? "write" : "discuss",
    round: 1,
    themeId: safeThemeId,
    themeLabel: theme.label,
    secretWord: randomWord,
    impostorId: randomImpostor.id,
    turnOrder,
    currentTurnIndex: 0,
    turnDeadline: turnOrder.length > 0 ? nowMs + TURN_SECONDS * 1000 : null,
    words: {},
    votes: {},
    lastResult: null
  };
}

export function advanceWriteTurn(game, nowMs = Date.now()) {
  const order = Array.isArray(game.turnOrder) ? game.turnOrder : [];
  const nextIndex = (game.currentTurnIndex || 0) + 1;

  if (order.length === 0 || nextIndex >= order.length) {
    return {
      ...game,
      currentTurnIndex: nextIndex,
      turnDeadline: null,
      phase: "discuss"
    };
  }

  return {
    ...game,
    currentTurnIndex: nextIndex,
    turnDeadline: nowMs + TURN_SECONDS * 1000,
    phase: "write"
  };
}

export function resolveVotes(players, game) {
  const activePlayers = players.filter((p) => !p.eliminated);
  const tally = {};

  activePlayers.forEach((p) => {
    const targetId = game.votes?.[p.id];
    if (targetId && activePlayers.some((ap) => ap.id === targetId)) {
      tally[targetId] = (tally[targetId] || 0) + 1;
    }
  });

  let maxVotes = 0;
  let topCandidates = [];

  Object.entries(tally).forEach(([id, count]) => {
    if (count > maxVotes) {
      maxVotes = count;
      topCandidates = [id];
    } else if (count === maxVotes) {
      topCandidates.push(id);
    }
  });

  if (topCandidates.length !== 1) {
    return {
      updatedPlayers: players,
      nextPhase: "result",
      resultData: {
        eliminatedId: null,
        eliminatedName: null,
        wasImpostor: false,
        winner: null,
        message: "Égalité dans les votes ! Personne n'est éliminé cette manche."
      }
    };
  }

  const eliminatedId = topCandidates[0];
  const eliminatedPlayer = players.find((p) => p.id === eliminatedId);
  const updatedPlayers = players.map((p) =>
    p.id === eliminatedId ? { ...p, eliminated: true } : p
  );

  const remainingActive = updatedPlayers.filter((p) => !p.eliminated);
  const wasImpostor = eliminatedId === game.impostorId;

  if (wasImpostor) {
    return {
      updatedPlayers,
      nextPhase: "finished",
      resultData: {
        eliminatedId,
        eliminatedName: eliminatedPlayer?.name || "Inconnu",
        wasImpostor: true,
        winner: "detectives",
        message: `${eliminatedPlayer?.name} a été éliminé... C'était l'IMPOSTEUR ! Victoire des enquêteurs ! Le mot secret était « ${game.secretWord} ».`
      }
    };
  }

  if (remainingActive.length <= 2) {
    const impostor = players.find((p) => p.id === game.impostorId);
    return {
      updatedPlayers,
      nextPhase: "finished",
      resultData: {
        eliminatedId,
        eliminatedName: eliminatedPlayer?.name || "Inconnu",
        wasImpostor: false,
        winner: "impostor",
        message: `${eliminatedPlayer?.name} était innocent ! Il ne reste plus assez de joueurs : victoire de l'imposteur (${impostor?.name || "Inconnu"}) ! Le mot était « ${game.secretWord} ».`
      }
    };
  }

  return {
    updatedPlayers,
    nextPhase: "result",
    resultData: {
      eliminatedId,
      eliminatedName: eliminatedPlayer?.name || "Inconnu",
      wasImpostor: false,
      winner: null,
      message: `${eliminatedPlayer?.name} a été éliminé... mais ce n'était pas l'imposteur ! La partie continue.`
    }
  };
}