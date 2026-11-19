export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

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

const SECRET_WORDS = [
  "Voilier",
  "Volcan",
  "Boussole",
  "Pyramide",
  "Télescope",
  "Igloo",
  "Parachute",
  "Sous-marin",
  "Phare",
  "Labyrinthe",
  "Glacier",
  "Cathédrale",
  "Montgolfière",
  "Éclipse",
  "Astéroïde",
  "Cascades",
  "Forteresse",
  "Squelette",
  "Horloge",
  "Bibliothèque"
];

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

export function areAllPlayersReady(players) {
  return players.length >= MIN_PLAYERS && players.every((p) => p.ready === true);
}

export function createInitialGameState(players) {
  const randomWord = SECRET_WORDS[Math.floor(Math.random() * SECRET_WORDS.length)];
  const randomImpostor = players[Math.floor(Math.random() * players.length)];

  return {
    status: "playing",
    phase: "write", // "write" | "discuss" | "vote" | "result" | "finished"
    round: 1,
    secretWord: randomWord,
    impostorId: randomImpostor.id,
    words: {},
    votes: {},
    lastResult: null
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

  // Égalité : personne n'est éliminé, on continue la partie
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