// ============ Firebase shared config (Doctor Website Engine) ============
// Same Firebase project as the Clinic Management app.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCWsKLiMjUREhEpMZarud5j2K6rLDQqsSo",
  authDomain: "bookmydoctor-6c93c.firebaseapp.com",
  projectId: "bookmydoctor-6c93c",
  storageBucket: "bookmydoctor-6c93c.firebasestorage.app",
  messagingSenderId: "88063096613",
  appId: "1:88063096613:web:293c77b09078d943964ccc",
  measurementId: "G-VJ2PE37JSJ"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
// Named Firebase apps keep admin and doctor sessions in separate browser
// storage keys. This prevents one dashboard tab from replacing or clearing
// the other dashboard's signed-in account on the same domain.
export const adminAuth = getAuth(initializeApp(firebaseConfig, "website-admin-session"));
export const doctorAuth = getAuth(initializeApp(firebaseConfig, "website-doctor-session"));
export const db = getFirestore(app);
export const storage = getStorage(app);
