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
export const db = getFirestore(app);
export const storage = getStorage(app);

// Each dashboard uses its own named Firebase app, so its session is stored
// separately AND its Firestore/Storage requests carry that same signed-in user.
const adminApp = initializeApp(firebaseConfig, "website-admin-session");
const doctorApp = initializeApp(firebaseConfig, "website-doctor-session");
export const adminAuth = getAuth(adminApp);
export const adminDb = getFirestore(adminApp);
export const adminStorage = getStorage(adminApp);
export const doctorAuth = getAuth(doctorApp);
export const doctorDb = getFirestore(doctorApp);
export const doctorStorage = getStorage(doctorApp);
