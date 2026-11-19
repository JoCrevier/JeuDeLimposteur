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

const firebaseConfig = {
  apiKey: "AIzaSyAAayaz2-yzC5sPFMtGsfH8t5xiMaAo56U",
  authDomain: "jeudelimposteur.firebaseapp.com",
  projectId: "jeudelimposteur",
  storageBucket: "jeudelimposteur.firebasestorage.app",
  messagingSenderId: "533130309819",
  appId: "1:533130309819:web:9fc5577a8a31e70608b99e"
};

const app = initializeApp(firebaseConfig);
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