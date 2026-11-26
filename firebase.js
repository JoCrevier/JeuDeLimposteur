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
  deleteDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

if (!window.firebaseConfig) {
  throw new Error(
    "firebase-config.js est introuvable. " +
    "En local : crée-le à la racine (voir README). " +
    "Sur GitHub Pages : vérifie le workflow de déploiement."
  );
}

const app = initializeApp(window.firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export function getSalonRef(code) {
  return doc(db, "salons", code);
}

export function initAnonymousSession(onUserReady, onAuthError) {
  onAuthStateChanged(auth, async (user) => {
    if (user) {
      onUserReady(user.uid);
    } else {
      try {
        await signInAnonymously(auth);
      } catch (err) {
        console.error("Erreur auth anonyme :", err);
        onAuthError(err);
      }
    }
  });
}

export { getDoc, setDoc, deleteDoc, onSnapshot, runTransaction, serverTimestamp };