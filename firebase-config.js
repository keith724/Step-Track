// ============================================================
// STEP 1 OF SETUP — paste your own Firebase project config here.
// See SETUP.md for exactly how to get these values (takes ~5 min, free).
// ============================================================
const firebaseConfig = {
  apiKey: "AIzaSyBlyRYmgQ2pjxDnDRU-fFTQU8xJbXisCz0",
  authDomain: "step-track-100.firebaseapp.com",
  projectId: "step-track-100",
  storageBucket: "step-track-100.firebasestorage.app",
  messagingSenderId: "394193007112",
  appId: "1:394193007112:web:94491a29a1819b0fb917bd"
};

// Real sign-in now happens via Firebase Authentication (email + password),
// so accounts are properly separated per person. This invite code is just
// an extra "friends only" gate on account creation — it's checked in the
// app's code, not enforced by the database, so treat it as a courtesy
// lock, not real security. Change it to whatever you like.
const GROUP_INVITE_CODE = "walking26";
