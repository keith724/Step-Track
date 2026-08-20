// ============================================================
// STEP 1 OF SETUP — paste your own Firebase project config here.
// See SETUP.md for exactly how to get these values (takes ~5 min, free).
// ============================================================
// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBlyRYmgQ2pjxDnDRU-fFTQU8xJbXisCz0",
  authDomain: "step-track-100.firebaseapp.com",
  projectId: "step-track-100",
  storageBucket: "step-track-100.firebasestorage.app",
  messagingSenderId: "394193007112",
  appId: "1:394193007112:web:94491a29a1819b0fb917bd",
  measurementId: "G-4H66H48RJB"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);

// Real sign-in now happens via Firebase Authentication (email + password),
// so accounts are properly separated per person. This invite code is just
// an extra "friends only" gate on account creation — it's checked in the
// app's code, not enforced by the database, so treat it as a courtesy
// lock, not real security. Change it to whatever you like.
const GROUP_INVITE_CODE = "walkies2026";
