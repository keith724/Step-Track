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

// Real sign-in happens via Firebase Authentication (email + password), so
// accounts are properly separated per person. Each invite code maps to a
// completely separate team — separate leaderboard, separate members,
// separate challenge dates. Teams never see each other's data; this is
// enforced by the Firestore security rules (see SETUP.md), not just hidden
// in the app's code.
//
// Teams now live in Firestore and are managed from within the app itself
// (Teams tab, visible to the admin account) — add, rename, or change invite
// codes there rather than editing this file. The object below is only a
// ONE-TIME seed: the first time the admin account loads the app after this
// update, if the database's teams collection is empty, it's populated from
// this list, then never read again. Safe to leave as-is afterward.
const SEED_TEAMS = {
  "walking26": { id: "team-1", name: "Marsh Lads" },
  "walk2026": { id: "team-2", name: "Team 2" }
};
