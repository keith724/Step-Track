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
// accounts are properly separated per person. Each invite code below maps
// to a completely separate team — separate leaderboard, separate members,
// separate challenge dates. Teams never see each other's data; this is
// enforced by the Firestore security rules (see SETUP.md), not just hidden
// in the app's code.
//
// Add as many teams as you like. "id" must be unique and, once people have
// started signing up with a code, shouldn't be changed (it's how existing
// members stay linked to their team).
const TEAMS = {
  "walking26": { id: "team-1", name: "Marsh Lads" },
  "walk2026": { id: "team-2", name: "Team 2" }
};
