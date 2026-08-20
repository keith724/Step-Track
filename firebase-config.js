// ============================================================
// STEP 1 OF SETUP — paste your own Firebase project config here.
// See SETUP.md for exactly how to get these values (takes ~5 min, free).
// ============================================================
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  projectId: "PASTE_YOUR_PROJECT_ID",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

// Real sign-in now happens via Firebase Authentication (email + password),
// so accounts are properly separated per person. This invite code is just
// an extra "friends only" gate on account creation — it's checked in the
// app's code, not enforced by the database, so treat it as a courtesy
// lock, not real security. Change it to whatever you like.
const GROUP_INVITE_CODE = "walkies2026";
