import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInAnonymously,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "VOTRE_API_KEY",
  authDomain: "VOTRE_PROJET.firebaseapp.com",
  projectId: "VOTRE_PROJET",
  storageBucket: "VOTRE_PROJET.firebasestorage.app",
  messagingSenderId: "VOTRE_SENDER_ID",
  appId: "VOTRE_APP_ID"
};

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 12;
const PALETTE = [
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  sessionCode: null,
  playerId: null,
  selectedColor: null,
  players: [],
  unsubscribeSalon: null,
  authReady: false
};

const screens = {
  code: document.getElementById("screenCode"),
  profile: document.getElementById("screenProfile"),
  lobby: document.getElementById("screenLobby")
};

const codeInput = document.getElementById("codeInput");
const codeForm = document.getElementById("codeForm");
const codeError = document.getElementById("codeError");
const randomCodeBtn = document.getElementById("randomCodeBtn");

const nameInput = document.getElementById("nameInput");
const profileForm = document.getElementById("profileForm");
const profileError = document.getElementById("profileError");
const colorsGrid = document.getElementById("colorsGrid");
const backToCodeBtn = document.getElementById("backToCodeBtn");

const activeCodeDisplay = document.getElementById("activeCodeDisplay");
const minPlayersNotice = document.getElementById("minPlayersNotice");
const playersGrid = document.getElementById("playersGrid");
const playerCountText = document.getElementById("playerCountText");
const statusDot = document.getElementById("statusDot");
const leaveBtn = document.getElementById("leaveBtn");
const startGameBtn = document.getElementById("startGameBtn");
const submitCodeBtn = codeForm.querySelector('button[type="submit"]');

submitCodeBtn.disabled = true;

function getSalonRef(code) {
  return doc(db, "salons", code);
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

function stopSalonListener() {
  if (state.unsubscribeSalon) {
    state.unsubscribeSalon();
    state.unsubscribeSalon = null;
  }
}

function startSalonListener(code) {
  stopSalonListener();
  state.unsubscribeSalon = onSnapshot(
    getSalonRef(code),
    (snap) => {
      state.players = snap.exists() && Array.isArray(snap.data().players)
        ? snap.data().players
        : [];

      renderCounter(state.players);

      if (screens.lobby.classList.contains("active")) {
        renderLobby();
      } else if (screens.profile.classList.contains("active")) {
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
      minPlayersNotice.textContent = "Minimum atteint — prêt à démarrer !";
      minPlayersNotice.style.color = "var(--success)";
    }
  }

  if (startGameBtn) {
    startGameBtn.disabled = count < MIN_PLAYERS;
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

  playersGrid.innerHTML = "";
  state.players.forEach((p) => {
    const card = document.createElement("div");
    card.className = "player-card";

    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.style.backgroundColor = p.color;
    avatar.textContent = p.name.charAt(0).toUpperCase();

    const info = document.createElement("div");
    const nameEl = document.createElement("div");
    nameEl.className = "player-name";
    nameEl.textContent = p.name;

    const tagEl = document.createElement("div");
    tagEl.className = "player-tag";
    tagEl.textContent = p.id === state.playerId ? "Toi" : "Connecté";

    info.append(nameEl, tagEl);
    card.append(avatar, info);
    playersGrid.appendChild(card);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    state.playerId = user.uid;
    state.authReady = true;
    submitCodeBtn.disabled = false;
  } else {
    try {
      await signInAnonymously(auth);
    } catch (err) {
      console.error("Erreur auth anonyme :", err);
      showError(codeError, "Impossible d'initialiser la session sécurisée.");
    }
  }
});

codeInput.addEventListener("input", () => {
  codeInput.value = codeInput.value.replace(/\D/g, "").slice(0, 5);
  hideError(codeError);
});

randomCodeBtn.addEventListener("click", () => {
  codeInput.value = String(Math.floor(10000 + Math.random() * 90000));
  hideError(codeError);
});

codeForm.addEventListener("submit", async (e) => {
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

  submitCodeBtn.disabled = true;
  hideError(codeError);

  try {
    const salonRef = getSalonRef(code);
    const snap = await getDoc(salonRef);
    const currentPlayers = snap.exists() && Array.isArray(snap.data().players)
      ? snap.data().players
      : [];

    const alreadyIn = currentPlayers.some((p) => p.id === state.playerId);
    if (!alreadyIn && currentPlayers.length >= MAX_PLAYERS) {
      showError(codeError, `Cette session est complète (${MAX_PLAYERS}/${MAX_PLAYERS} joueurs maximum).`);
      submitCodeBtn.disabled = false;
      return;
    }

    state.sessionCode = code;
    state.selectedColor = null;
    state.players = currentPlayers;
    renderCounter(currentPlayers);
    startSalonListener(code);

    if (alreadyIn) {
      renderLobby();
      showScreen("lobby");
    } else {
      renderColorPicker();
      showScreen("profile");
      nameInput.focus();
    }
  } catch (err) {
    console.error("Erreur accès salon :", err);
    showError(codeError, "Erreur de connexion à la base de données.");
  } finally {
    submitCodeBtn.disabled = false;
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
  if (!chosenColor) {
    showError(profileError, "Merci de choisir une couleur.");
    return;
  }
  if (!state.sessionCode || !state.playerId) {
    showError(profileError, "Session invalide.");
    return;
  }

  const submitBtn = profileForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  hideError(profileError);

  try {
    const salonRef = getSalonRef(state.sessionCode);

    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      const existingPlayers = snap.exists() && Array.isArray(snap.data().players)
        ? snap.data().players
        : [];

      const filtered = existingPlayers.filter((p) => p.id !== state.playerId);

      if (filtered.length >= MAX_PLAYERS) {
        throw new Error("FULL");
      }
      if (filtered.some((p) => p.color === chosenColor)) {
        throw new Error("COLOR_TAKEN");
      }

      filtered.push({
        id: state.playerId,
        name: cleanName,
        color: chosenColor
      });

      if (!snap.exists()) {
        transaction.set(salonRef, {
          code: state.sessionCode,
          players: filtered,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      } else {
        transaction.update(salonRef, {
          players: filtered,
          updatedAt: serverTimestamp()
        });
      }
    });

    renderLobby();
    showScreen("lobby");
  } catch (err) {
    if (err.message === "FULL") {
      showError(profileError, `Limite de ${MAX_PLAYERS} joueurs atteinte.`);
    } else if (err.message === "COLOR_TAKEN") {
      state.selectedColor = null;
      renderColorPicker();
      showError(profileError, "Cette couleur vient d'être prise, choisis-en une autre.");
    } else {
      console.error("Erreur ajout joueur :", err);
      showError(profileError, "Impossible de rejoindre la session pour le moment.");
    }
  } finally {
    submitBtn.disabled = false;
  }
});

backToCodeBtn.addEventListener("click", () => {
  stopSalonListener();
  state.sessionCode = null;
  state.selectedColor = null;
  state.players = [];
  renderCounter([]);
  showScreen("code");
});

leaveBtn.addEventListener("click", async () => {
  const code = state.sessionCode;
  const uid = state.playerId;

  stopSalonListener();
  state.sessionCode = null;
  state.selectedColor = null;
  state.players = [];
  nameInput.value = "";
  renderCounter([]);
  showScreen("code");

  if (!code || !uid) return;

  try {
    const salonRef = getSalonRef(code);
    await runTransaction(db, async (transaction) => {
      const snap = await transaction.get(salonRef);
      if (!snap.exists()) return;
      const existingPlayers = Array.isArray(snap.data().players) ? snap.data().players : [];
      const updated = existingPlayers.filter((p) => p.id !== uid);
      transaction.update(salonRef, {
        players: updated,
        updatedAt: serverTimestamp()
      });
    });
  } catch (err) {
    console.error("Erreur départ session :", err);
  }
});

startGameBtn.addEventListener("click", () => {
  if (state.players.length < MIN_PLAYERS) return;
  alert(`La partie commence avec ${state.players.length} joueurs dans la session ${state.sessionCode} !`);
});