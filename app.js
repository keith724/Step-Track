/* ---------- Setup ---------- */
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

const DEFAULT_STRIDE_M = 0.759; // ~6'0" / 183cm average adult stride
const LB_PER_KG = 2.20462;
const KG_PER_STONE = 6.35029;
const CM_PER_INCH = 2.54;
const MILES_PER_KM = 0.621371;
const ADMIN_EMAIL = "keith@9cr.uk";
const APP_VERSION = "0011"; // bumped by one with every file update shipped

/* ---------- Teams (live from Firestore, editable from the Teams tab) ---------- */
let TEAMS_LIST = []; // [{ id, name, inviteCode }]

async function loadTeamsList(){
  try{
    const snap = await db.collection("teams").get();
    TEAMS_LIST = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    TEAMS_LIST.sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }catch(e){
    console.error("Couldn't load teams", e);
    TEAMS_LIST = [];
  }
}

function findTeamByInviteCode(code){
  return TEAMS_LIST.find(t => t.inviteCode === code);
}

function teamNameById(id){
  if(!id) return "No team";
  const t = TEAMS_LIST.find(x => x.id === id);
  return t ? t.name : "Unknown team";
}

// One-time migration: if the database has no teams yet, seed it from the
// SEED_TEAMS object in firebase-config.js, then never touch that object
// again. Only the admin account has permission to write here, so this is
// only attempted when they're the one signed in.
async function seedTeamsIfEmpty(){
  try{
    const snap = await db.collection("teams").get();
    if(!snap.empty) return;
    const codes = Object.keys(SEED_TEAMS);
    for(const code of codes){
      const t = SEED_TEAMS[code];
      await db.collection("teams").doc(t.id).set({
        name: t.name, inviteCode: code, createdAt: Date.now()
      });
    }
    await loadTeamsList();
  }catch(e){
    console.error("Couldn't seed teams", e);
  }
}

// Teams need to be readable before anyone has signed in (the sign-up form
// has to validate an invite code against them), so load them immediately
// rather than waiting for auth state.
loadTeamsList();

function pad(n){ return n < 10 ? "0" + n : "" + n; }
function todayStr(){
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function daysAgoStr(n){
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
}
function daysBetweenInclusive(startStr, endStr){
  const start = new Date(startStr + "T00:00:00");
  const end = new Date(endStr + "T00:00:00");
  const diff = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, diff);
}
function dontDoesnt(count){
  return count === 1 ? "doesn't" : "don't";
}
function stepsEntryId(date){
  return `${uid}_${date}`;
}
function getSavedTeamSelection(){
  try{
    const raw = localStorage.getItem("ss_steps_team_ids");
    const arr = raw ? JSON.parse(raw) : null;
    return Array.isArray(arr) && arr.length > 0 ? arr : [profile.teamId];
  }catch(e){
    return [profile.teamId];
  }
}
function setSavedTeamSelection(arr){
  localStorage.setItem("ss_steps_team_ids", JSON.stringify(arr));
}
function shortDate(dateStr){
  const parts = dateStr.split("-");
  return `${parts[2]}/${parts[1]}`;
}
function computeStride(profile){
  if(!profile) return DEFAULT_STRIDE_M;
  if(profile.mode === "manual" && profile.strideM) return profile.strideM;
  if(profile.mode === "height" && profile.heightCm) return +(profile.heightCm * 0.415 / 100).toFixed(3);
  return DEFAULT_STRIDE_M;
}
function fmtDistance(steps, strideM){
  return kmToDistanceUnit((steps * strideM) / 1000, getDistanceUnit()).toFixed(2) + " " + distanceUnitLabel(getDistanceUnit());
}
function toast(msg){
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 1800);
}
function friendlyAuthError(e){
  const map = {
    "auth/email-already-in-use": "That email already has an account — try logging in instead.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/weak-password": "Password needs to be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — wait a moment and try again."
  };
  return map[e.code] || "Something went wrong — check your connection and try again.";
}

/* ---------- Weight unit helpers ---------- */
function kgToUnit(kg, unit){
  if(unit === "lb") return kg * LB_PER_KG;
  if(unit === "stone") return kg / KG_PER_STONE;
  return kg;
}
function unitToKg(val, unit){
  if(unit === "lb") return val / LB_PER_KG;
  if(unit === "stone") return val * KG_PER_STONE;
  return val;
}
function weightUnitLabel(unit){
  return unit === "lb" ? "lb" : unit === "stone" ? "stone" : "kg";
}

/* ---------- Board distance unit (device-local preference) ---------- */
/* ---------- Distance unit (device-local, applies app-wide) ---------- */
function getDistanceUnit(){
  return localStorage.getItem("ss_distance_unit") || "km";
}
function setDistanceUnit(unit){
  localStorage.setItem("ss_distance_unit", unit);
}
function kmToDistanceUnit(km, unit){
  return unit === "mi" ? km * MILES_PER_KM : km;
}
function distanceUnitLabel(unit){
  return unit === "mi" ? "mi" : "km";
}

/* ---------- Height helpers ---------- */
function ftInToCm(feet, inches){
  return ((feet || 0) * 12 + (inches || 0)) * CM_PER_INCH;
}
function cmToFtIn(cm){
  const totalInches = cm / CM_PER_INCH;
  const feet = Math.floor(totalInches / 12);
  const inches = Math.round(totalInches - feet * 12);
  return { feet, inches };
}

/* ---------- State ---------- */
let uid = null;
let profile = null; // users/{uid} doc: { name, mode, heightCm, strideM, weightUnit, heightUnit }
let weightChart = null;
let waterChart = null;
let challenge = null; // config/challenge doc: { active, startDate, endDate }
let viewingTeamId = null; // which team's leaderboard is currently shown (admin can change this)
let lastHistoryDocs = []; // cached for switching between list/graph without refetching
let stepsChart = null;
let lastBoardRows = []; // cached leaderboard rows, so paging doesn't need a refetch
let lastBoardSortMode = "total";
let lastBoardUnit = "km";
let boardPage = 0;
const BOARD_PAGE_SIZE = 8;

/* ---------- Auth gate UI wiring ---------- */
const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");

document.getElementById("show-signup").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("form-login").style.display = "none";
  document.getElementById("form-signup").style.display = "block";
  document.getElementById("gate-error").textContent = "";
});

document.querySelectorAll(".password-toggle").forEach(btn => {
  btn.addEventListener("click", () => {
    const input = document.getElementById(btn.dataset.target);
    if(!input) return;
    const showing = input.type === "text";
    input.type = showing ? "password" : "text";
    btn.textContent = showing ? "👁" : "🙈";
    btn.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
});
document.getElementById("show-login").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("form-signup").style.display = "none";
  document.getElementById("form-login").style.display = "block";
  document.getElementById("gate-error").textContent = "";
});

document.getElementById("login-btn").addEventListener("click", async () => {
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const errEl = document.getElementById("gate-error");
  errEl.textContent = "";
  if(!email || !password){ errEl.textContent = "Enter your email and password."; return; }
  try{
    await auth.signInWithEmailAndPassword(email, password);
  }catch(e){
    console.error(e);
    errEl.textContent = friendlyAuthError(e);
  }
});

document.getElementById("signup-btn").addEventListener("click", async () => {
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;
  const invite = document.getElementById("signup-invite").value.trim();
  const errEl = document.getElementById("gate-error");
  errEl.textContent = "";

  if(!name){ errEl.textContent = "Enter your name."; return; }
  if(TEAMS_LIST.length === 0) await loadTeamsList(); // in case this loaded before Firestore responded
  const team = findTeamByInviteCode(invite);
  if(!team){ errEl.textContent = "That invite code doesn't match."; return; }
  if(!email || !password){ errEl.textContent = "Enter an email and password."; return; }

  try{
    const cred = await auth.createUserWithEmailAndPassword(email, password);
    await cred.user.updateProfile({ displayName: name });
    await db.collection("users").doc(cred.user.uid).set({
      name, mode: "default", weightUnit: "kg", heightUnit: "cm",
      teamId: team.id, teamName: team.name, joinedAt: Date.now()
    });
    // onAuthStateChanged below picks up the new session and boots the app
  }catch(e){
    console.error(e);
    errEl.textContent = friendlyAuthError(e);
  }
});

document.getElementById("logout-btn").addEventListener("click", async () => {
  await auth.signOut();
});

/* ---------- Auth state ---------- */
auth.onAuthStateChanged(async (user) => {
  if(user){
    uid = user.uid;
    gateEl.style.display = "none";
    await boot();
  }else{
    uid = null;
    appEl.style.display = "none";
    gateEl.style.display = "flex";
  }
});

/* ---------- Boot main app ---------- */
async function boot(){
  appEl.style.display = "block";
  document.getElementById("app-version").textContent = `Version ${APP_VERSION}`;

  await loadProfile();
  document.getElementById("header-sub").textContent = `Welcome back, ${profile.name} · ${teamNameById(profile.teamId)}`;

  wireTabs();
  viewingTeamId = profile.teamId;
  wireToday();
  wireProfile();
  wireWellness();
  wireChallengeAdmin();
  wireTeamsTab();
  wireBoardTeamSwitcher();

  await refreshToday();
  await refreshHistory();
  await loadChallenge();
  await refreshBoard();
  await refreshWeight();
  await refreshWater();
  updateWaterDateLabel();
  await loadWeightForDate(todayStr());
  await loadWaterInputForDate(todayStr());

  document.getElementById("board-range").addEventListener("change", refreshBoard);
  document.querySelectorAll('input[name="board-sort"]').forEach(radio => {
    radio.addEventListener("change", refreshBoard);
  });

  const savedDistanceUnit = getDistanceUnit();
  const distanceUnitRadio = document.querySelector(`input[name="board-unit"][value="${savedDistanceUnit}"]`);
  if(distanceUnitRadio) distanceUnitRadio.checked = true;
  document.querySelectorAll('input[name="board-unit"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      setDistanceUnit(radio.value);
      await refreshToday();
      await refreshHistory();
      await refreshBoard();
      updateProfilePreview();
    });
  });

  if("serviceWorker" in navigator){
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

async function loadProfile(){
  const snap = await db.collection("users").doc(uid).get();
  profile = snap.exists
    ? snap.data()
    : { name: auth.currentUser.displayName || "Friend", mode: "default", weightUnit: "kg", heightUnit: "cm" };
  if(!profile.weightUnit) profile.weightUnit = "kg";
  if(!profile.heightUnit) profile.heightUnit = "cm";

  // Backfill: anyone who signed up before teams existed (field genuinely
  // absent) gets defaulted to the first team. If an admin has deliberately
  // set someone to "no team" (teamId explicitly ""), that's left alone —
  // it's a real choice, not a legacy gap.
  if(profile.teamId === undefined && TEAMS_LIST.length > 0){
    profile.teamId = TEAMS_LIST[0].id;
    profile.teamName = TEAMS_LIST[0].name;
    await db.collection("users").doc(uid).set(
      { teamId: profile.teamId, teamName: profile.teamName }, { merge: true }
    );
  }

  // Flag the admin's own profile doc so the security rules can let other
  // teams' members read their name when the admin cross-posts entries into
  // a team that isn't their own home team.
  if((auth.currentUser.email || "").toLowerCase() === ADMIN_EMAIL.toLowerCase() && !profile.isAdmin){
    profile.isAdmin = true;
    await db.collection("users").doc(uid).set({ isAdmin: true }, { merge: true });
  }

  document.getElementById("profile-name").value = profile.name;
  document.getElementById("profile-mode").value = profile.mode || "default";
  document.querySelector(`input[name="height-unit"][value="${profile.heightUnit}"]`).checked = true;
  document.querySelector(`input[name="weight-unit"][value="${profile.weightUnit}"]`).checked = true;
  updateWeightUnitLabel();
  document.getElementById("profile-team").textContent = profile.teamName || "";

  if(profile.heightCm){
    document.getElementById("profile-height-cm").value = profile.heightCm;
    const ftin = cmToFtIn(profile.heightCm);
    document.getElementById("profile-height-ft").value = ftin.feet;
    document.getElementById("profile-height-in").value = ftin.inches;
  }
  if(profile.strideM) document.getElementById("profile-stride").value = profile.strideM;

  updateProfileVisibility();
  updateProfilePreview();
}

/* ---------- Tabs ---------- */
function wireTabs(){
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("view-" + btn.dataset.view).classList.add("active");
    });
  });
}

/* ---------- Today (steps — shared/public within the group) ---------- */
function wireToday(){
  const dateInput = document.getElementById("steps-date");
  dateInput.max = todayStr();
  dateInput.value = todayStr();

  const userEmail = (auth.currentUser.email || "").toLowerCase();
  const isAdmin = userEmail === ADMIN_EMAIL.toLowerCase();
  if(isAdmin){
    const card = document.getElementById("steps-admin-team-card");
    const box = document.getElementById("steps-team-checkboxes");
    card.style.display = "block";
    box.innerHTML = TEAMS_LIST.map(t =>
      `<label class="checkbox-row"><input type="checkbox" class="steps-team-checkbox" value="${t.id}"><span>${t.name}</span></label>`
    ).join("");
    // default: whichever teams you last had ticked, remembered on this device
    const remembered = getSavedTeamSelection();
    box.querySelectorAll(".steps-team-checkbox").forEach(cb => {
      cb.checked = remembered.includes(cb.value);
    });
    box.addEventListener("change", () => {
      const checked = Array.from(box.querySelectorAll(".steps-team-checkbox:checked")).map(cb => cb.value);
      if(checked.length > 0) setSavedTeamSelection(checked);
    });
  }

  dateInput.addEventListener("change", () => loadStepsForDate(dateInput.value));

  document.getElementById("save-steps").addEventListener("click", async () => {
    const val = parseInt(document.getElementById("steps-input").value, 10);
    if(isNaN(val) || val < 0){ toast("Enter a valid step count"); return; }
    const date = dateInput.value || todayStr();

    const teamIds = isAdmin
      ? Array.from(document.querySelectorAll(".steps-team-checkbox:checked")).map(cb => cb.value)
      : (profile.teamId ? [profile.teamId] : []);

    if(teamIds.length === 0){
      toast(isAdmin ? "Tick at least one team" : "You're not on a team yet — ask your admin to assign you one");
      return;
    }

    const id = stepsEntryId(date);
    try{
      await db.collection("entries").doc(id).set({
        member: uid,
        name: profile.name,
        teamIds: teamIds,
        date: date,
        steps: val,
        updatedAt: Date.now()
      });
      // The save itself succeeded at this point — anything that goes wrong
      // below is just a display refresh, not a failed save, so it gets its
      // own quieter error handling instead of overwriting the success toast.
      toast(date === todayStr() ? "Saved!" : `Saved for ${date}`);
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
      return;
    }

    try{
      await refreshToday();
      await refreshHistory();
      await refreshBoard();
    }catch(e){
      // Save already succeeded above — a refresh hiccup here just means the
      // screen might be a step behind until the next reload, not a failure.
      console.error("Post-save refresh failed (save itself was fine):", e);
    }
  });

  document.querySelectorAll('input[name="history-view"]').forEach(radio => {
    radio.addEventListener("change", () => renderHistoryView(radio.value));
  });
}

async function loadStepsForDate(date){
  const label = document.getElementById("steps-input-label");
  label.textContent = date === todayStr() ? "Steps" : `Steps (editing ${date})`;
  try{
    const snap = await db.collection("entries").doc(stepsEntryId(date)).get();
    document.getElementById("steps-input").value = snap.exists ? snap.data().steps : "";

    // If this admin has a "Log to team" checklist, reflect which teams
    // this specific saved entry already belongs to (falls back to your
    // remembered selection for a date with no entry yet).
    const box = document.getElementById("steps-team-checkboxes");
    if(box){
      const savedTeamIds = (snap.exists && snap.data().teamIds) || getSavedTeamSelection();
      box.querySelectorAll(".steps-team-checkbox").forEach(cb => {
        cb.checked = savedTeamIds.includes(cb.value);
      });
    }
  }catch(e){
    console.error(e);
  }
}

async function refreshToday(){
  const snap = await db.collection("entries").doc(stepsEntryId(todayStr())).get();
  const steps = snap.exists ? snap.data().steps : 0;
  document.getElementById("today-steps").textContent = steps.toLocaleString();
  document.getElementById("today-distance").textContent = fmtDistance(steps, computeStride(profile));
  const dateInput = document.getElementById("steps-date");
  if(dateInput.value === todayStr() && steps){
    document.getElementById("steps-input").value = steps;
  }
}

async function refreshHistory(){
  const listEl = document.getElementById("history-list");
  try{
    // Query shape now mirrors the leaderboard's fetchTeamEntries(): filter
    // explicitly on teamIds (new format) / teamId (old format) rather than
    // just member — a bare member-only query wasn't reliably satisfying the
    // security rule's own teamIds check for list operations.
    const [newSnap, oldSnap] = await Promise.all([
      db.collection("entries")
        .where("member", "==", uid)
        .where("teamIds", "array-contains", profile.teamId)
        .orderBy("date", "desc")
        .limit(14)
        .get(),
      db.collection("entries")
        .where("member", "==", uid)
        .where("teamId", "==", profile.teamId)
        .orderBy("date", "desc")
        .limit(14)
        .get()
    ]);

    const seen = new Set();
    const merged = [...newSnap.docs, ...oldSnap.docs].filter(d => {
      if(seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
    merged.sort((a, b) => b.data().date.localeCompare(a.data().date));
    lastHistoryDocs = merged.slice(0, 14).map(d => d.data());

    if(lastHistoryDocs.length === 0){
      listEl.innerHTML = `<div class="empty">No entries yet — log today's steps above.</div>`;
      if(stepsChart){ stepsChart.destroy(); stepsChart = null; }
      return;
    }
    const activeViewRadio = document.querySelector('input[name="history-view"]:checked');
    renderHistoryView(activeViewRadio ? activeViewRadio.value : "list");
  }catch(e){
    console.error(e);
    listEl.innerHTML = `<div class="empty">Couldn't load history yet. If this is the first run, Firestore may need a moment to build an index — check the browser console for a one-click link.</div>`;
  }
}

function renderHistoryView(mode){
  const listEl = document.getElementById("history-list");
  const chartWrap = document.getElementById("history-chart-wrap");

  if(lastHistoryDocs.length === 0){
    listEl.style.display = "block";
    chartWrap.style.display = "none";
    return;
  }

  const stride = computeStride(profile);

  if(mode === "graph"){
    listEl.style.display = "none";
    chartWrap.style.display = "block";
    const asc = lastHistoryDocs.slice().reverse();
    stepsChart = buildLineChart(
      "steps-chart", stepsChart,
      asc.map(e => shortDate(e.date)),
      asc.map(e => e.steps),
      "Steps",
      "#C24914"
    );
  }else{
    listEl.style.display = "block";
    chartWrap.style.display = "none";
    listEl.innerHTML = lastHistoryDocs.map(e => `<div class="history-item">
      <span class="date">${e.date}</span>
      <span class="mono">${e.steps.toLocaleString()} steps · ${fmtDistance(e.steps, stride)}</span>
    </div>`).join("");
  }
}

/* ---------- Leaderboard (steps only — weight/water never appear here) ---------- */
function wireBoardTeamSwitcher(){
  const userEmail = (auth.currentUser.email || "").toLowerCase();
  if(userEmail !== ADMIN_EMAIL.toLowerCase()) return;

  const card = document.getElementById("board-admin-team-card");
  const select = document.getElementById("board-team-select");
  card.style.display = "block";

  select.innerHTML = TEAMS_LIST.map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join("");
  select.value = profile.teamId;

  select.addEventListener("change", async () => {
    viewingTeamId = select.value;
    await loadChallenge();
    await refreshBoard();
  });
}

async function loadChallenge(){
  if(!viewingTeamId){
    challenge = null;
    renderChallengeBanner();
    return;
  }
  try{
    const snap = await db.collection("challenges").doc(viewingTeamId).get();
    challenge = snap.exists ? snap.data() : null;
  }catch(e){
    console.error(e);
    challenge = null;
  }
  renderChallengeBanner();
}

function renderChallengeBanner(){
  const banner = document.getElementById("challenge-banner");
  const textEl = document.getElementById("challenge-banner-text");
  if(!challenge || !challenge.active || !challenge.startDate || !challenge.endDate){
    banner.style.display = "none";
    return;
  }
  const today = todayStr();
  let status;
  if(today < challenge.startDate){
    status = `Starts ${challenge.startDate}`;
  }else if(today > challenge.endDate){
    status = `Finished ${challenge.endDate}`;
  }else{
    status = `In progress — ends ${challenge.endDate}`;
  }
  textEl.textContent = `${challenge.startDate} → ${challenge.endDate} · ${status}`;
  banner.style.display = "block";
}

async function fetchTeamEntries(teamId, range){
  // Support both the old schema (single `teamId` string, from entries saved
  // before this update) and the new schema (`teamIds` array) so existing
  // history keeps showing up on the leaderboard with no manual migration.
  let newQuery = db.collection("entries").where("teamIds", "array-contains", teamId);
  let oldQuery = db.collection("entries").where("teamId", "==", teamId);
  let windowStart = null;

  if(range === "challenge"){
    newQuery = newQuery.where("date", ">=", challenge.startDate).where("date", "<=", challenge.endDate);
    oldQuery = oldQuery.where("date", ">=", challenge.startDate).where("date", "<=", challenge.endDate);
    windowStart = challenge.startDate;
  }else if(range === "today"){
    newQuery = newQuery.where("date", "==", todayStr());
    oldQuery = oldQuery.where("date", "==", todayStr());
  }else if(range !== "alltime"){
    windowStart = daysAgoStr(parseInt(range, 10));
    newQuery = newQuery.where("date", ">=", windowStart);
    oldQuery = oldQuery.where("date", ">=", windowStart);
  }

  const [newSnap, oldSnap] = await Promise.all([newQuery.get(), oldQuery.get()]);
  return { docs: [...newSnap.docs, ...oldSnap.docs], windowStart };
}

function computeReportWindow(memberEarliest, nominalStart, usersRoster){
  // Finds the earliest date the report can safely start from, requiring at
  // least 4 people to already have data by that point — never further back
  // than that, even if some individuals' data goes back further.
  //
  // If fewer than 4 people have ever logged anything, "at least 4" simply
  // can't be satisfied — in that case we deliberately do NOT trim any
  // further than the window already naturally is (the nominal 7/30-day
  // start, or the earliest available data for all-time). Using the most
  // recent of a small handful of people's first-ever entries as a cutoff
  // would let one brand-new team member collapse the whole window down to
  // almost nothing, which is the opposite of what this feature is for.
  const idsWithData = Object.keys(memberEarliest);
  let reportStart;

  if(idsWithData.length === 0){
    reportStart = nominalStart || todayStr();
  }else if(idsWithData.length >= 4){
    const sortedDates = idsWithData.map(id => memberEarliest[id]).sort();
    const threshold = sortedDates[3];
    reportStart = nominalStart && nominalStart > threshold ? nominalStart : threshold;
  }else{
    const earliestAvailable = idsWithData.map(id => memberEarliest[id]).sort()[0];
    reportStart = nominalStart || earliestAvailable;
  }

  const missingNames = [];
  Object.keys(usersRoster).forEach(id => {
    const earliest = memberEarliest[id];
    if(!earliest || earliest > reportStart){
      missingNames.push(usersRoster[id].name || "Friend");
    }
  });

  return { reportStart, missingNames };
}

async function refreshBoard(){
  const boardEl = document.getElementById("board-list");
  const noteEl = document.getElementById("board-coverage-note");
  boardEl.innerHTML = `<div class="empty">Loading leaderboard...</div>`;
  noteEl.style.display = "none";

  if(!viewingTeamId){
    boardEl.innerHTML = `<div class="empty">You're not assigned to a team yet — ask your admin to assign you one.</div>`;
    return;
  }

  // Read every bit of page state defensively — if someone's browser has a
  // slightly stale copy of the page (e.g. mid-update, before a reload),
  // a missing element here should never be able to silently crash the
  // function and leave the screen stuck on "Loading...". Fall back to
  // sensible defaults instead.
  const rangeEl = document.getElementById("board-range");
  const range = rangeEl ? rangeEl.value : "7";
  const unit = getDistanceUnit();
  const sortRadio = document.querySelector('input[name="board-sort"]:checked');
  const sortMode = sortRadio ? sortRadio.value : "total";

  if(range === "challenge" && (!challenge || !challenge.startDate || !challenge.endDate)){
    boardEl.innerHTML = `<div class="empty">No challenge has been set up yet.</div>`;
    return;
  }

  try{
    const { docs: entryDocs, windowStart } = await fetchTeamEntries(viewingTeamId, range);
    const usersSnap = await db.collection("users").where("teamId", "==", viewingTeamId).get();

    const users = {};
    usersSnap.forEach(d => users[d.id] = d.data());

    // An entry can belong to someone whose *home* team differs from the
    // team being viewed (the admin cross-posting into another team). Fetch
    // any such profiles individually so their name/stride still show up
    // correctly instead of falling back to "Friend".
    const missingIds = new Set();
    entryDocs.forEach(d => { if(!(d.data().member in users)) missingIds.add(d.data().member); });
    for(const id of missingIds){
      try{
        const snap = await db.collection("users").doc(id).get();
        if(snap.exists) users[id] = snap.data();
      }catch(e){ console.error(e); }
    }

    // Each member's earliest entry date within whatever we just fetched.
    const memberEarliest = {};
    entryDocs.forEach(d => {
      const e = d.data();
      if(!(e.member in memberEarliest) || e.date < memberEarliest[e.member]) memberEarliest[e.member] = e.date;
    });

    let usableDocs = entryDocs;
    let days;

    if(range === "today"){
      days = 1;
    }else if(range === "alltime"){
      const { reportStart, missingNames } = computeReportWindow(memberEarliest, null, users);
      usableDocs = entryDocs.filter(d => d.data().date >= reportStart);
      days = daysBetweenInclusive(reportStart, todayStr());
      noteEl.textContent = `Reporting from ${reportStart} — the earliest date at least 4 current participants have data from.`
        + (missingNames.length > 0 ? ` Note: ${missingNames.join(", ")} ${dontDoesnt(missingNames.length)} have data going back that far.` : "");
      noteEl.style.display = "block";
    }else if(range === "7" || range === "30"){
      const { reportStart, missingNames } = computeReportWindow(memberEarliest, windowStart, users);
      usableDocs = entryDocs.filter(d => d.data().date >= reportStart);
      days = daysBetweenInclusive(reportStart, todayStr());
      noteEl.textContent = `Reporting from ${reportStart}.`
        + (missingNames.length > 0 ? ` Note: ${missingNames.join(", ")} ${dontDoesnt(missingNames.length)} have data going back that far.` : "");
      noteEl.style.display = "block";
    }else{
      // challenge: flag anyone whose data doesn't reach back to the start
      // of the challenge period (partial coverage skews their total).
      days = daysBetweenInclusive(challenge.startDate, challenge.endDate < todayStr() ? challenge.endDate : todayStr());

      const short = Object.keys(memberEarliest)
        .filter(id => memberEarliest[id] > windowStart)
        .map(id => (users[id] && users[id].name) || "Someone");

      if(short.length > 0){
        noteEl.textContent = `Note: ${short.join(", ")} ${dontDoesnt(short.length)} have data going back the full challenge period — their totals reflect fewer days.`;
        noteEl.style.display = "block";
      }
    }

    const totals = {};
    usableDocs.forEach(d => {
      const e = d.data();
      totals[e.member] = (totals[e.member] || 0) + e.steps;
    });

    let rows = Object.keys(totals).map(id => {
      const m = users[id] || { name: "Friend" };
      const stride = computeStride(m);
      const steps = totals[id];
      return { id, name: m.name || "Friend", steps, km: (steps * stride) / 1000, avg: steps / days };
    });

    Object.keys(users).forEach(id => {
      if(!(id in totals)) rows.push({ id, name: users[id].name || "Friend", steps: 0, km: 0, avg: 0 });
    });

    rows.sort((a, b) => sortMode === "average" ? b.avg - a.avg : b.steps - a.steps);

    lastBoardRows = rows;
    lastBoardSortMode = sortMode;
    lastBoardUnit = unit;
    boardPage = 0;
    renderBoardPage();
  }catch(e){
    console.error(e);
    boardEl.innerHTML = `<div class="empty">Couldn't load the leaderboard. If this is the first run, check the browser console — Firestore sometimes needs a one-click index link the first time.</div>`;
  }
}

function renderBoardPage(){
  const boardEl = document.getElementById("board-list");
  const rows = lastBoardRows;
  const sortMode = lastBoardSortMode;
  const unit = lastBoardUnit;

  if(rows.length === 0){
    boardEl.innerHTML = `<div class="empty">No one has logged steps yet — be the first!</div>`;
    return;
  }

  const max = Math.max(...rows.map(r => sortMode === "average" ? r.avg : r.steps), 1);
  const medals = ["🥇", "🥈", "🥉"];

  const totalPages = Math.ceil(rows.length / BOARD_PAGE_SIZE);
  boardPage = Math.max(0, Math.min(boardPage, totalPages - 1));
  const pageRows = rows.slice(boardPage * BOARD_PAGE_SIZE, (boardPage + 1) * BOARD_PAGE_SIZE);

  const rowsHtml = pageRows.map((r, i) => {
    const rank = boardPage * BOARD_PAGE_SIZE + i;
    const metric = sortMode === "average" ? r.avg : r.steps;
    const pct = Math.min(100, (metric / max) * 100);
    const isMe = r.id === uid;
    const dist = kmToDistanceUnit(r.km, unit);
    const statLine = sortMode === "average"
      ? `${Math.round(r.avg).toLocaleString()}/day avg · ${r.steps.toLocaleString()} total`
      : `${r.steps.toLocaleString()} · ${dist.toFixed(1)}${distanceUnitLabel(unit)}`;
    // Only ever award a medal to someone who actually has data for this
    // period — an empty row shouldn't inherit gold/silver/bronze just
    // because everyone above them also had nothing logged.
    const hasData = metric > 0;
    const medalHtml = (rank < 3 && hasData) ? `<span class="medal">${medals[rank]}</span>` : "";
    return `<div class="lane" style="${isMe ? "outline:1px solid rgba(232,185,63,0.5);" : ""}">
      <div class="lane-top">
        <div class="lane-name">
          <span class="bib">${rank+1}</span>
          <span>${r.name}${isMe ? " (you)" : ""}</span>
          ${medalHtml}
        </div>
        <span class="mono" style="color:var(--gray);">${statLine}</span>
      </div>
      <div class="lane-track">
        <div class="lane-fill" style="width:${pct}%"></div>
        <div class="lane-runner" style="left:${pct}%">🏃</div>
      </div>
    </div>`;
  }).join("");

  let pagerHtml = "";
  if(totalPages > 1){
    pagerHtml = `<div class="board-pager">
      <button class="pager-btn" id="board-prev" ${boardPage === 0 ? "disabled" : ""}>‹ Prev</button>
      <span class="pager-label">Page ${boardPage + 1} of ${totalPages}</span>
      <button class="pager-btn" id="board-next" ${boardPage === totalPages - 1 ? "disabled" : ""}>Next ›</button>
    </div>`;
  }

  boardEl.innerHTML = rowsHtml + pagerHtml;

  if(totalPages > 1){
    document.getElementById("board-prev").addEventListener("click", () => {
      boardPage = Math.max(0, boardPage - 1);
      renderBoardPage();
    });
    document.getElementById("board-next").addEventListener("click", () => {
      boardPage = Math.min(totalPages - 1, boardPage + 1);
      renderBoardPage();
    });
  }
}

/* ---------- Challenge admin (only keith@9cr.uk can see/edit this) ---------- */
function wireChallengeAdmin(){
  const card = document.getElementById("admin-challenge-card");
  const userEmail = (auth.currentUser.email || "").toLowerCase();
  if(userEmail !== ADMIN_EMAIL.toLowerCase()) return;

  card.style.display = "block";

  const teamSelect = document.getElementById("challenge-team-select");
  teamSelect.innerHTML = TEAMS_LIST.map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join("");
  teamSelect.value = profile.teamId; // default to the admin's own team

  loadChallengeIntoAdminForm(teamSelect.value);
  teamSelect.addEventListener("change", () => loadChallengeIntoAdminForm(teamSelect.value));

  document.getElementById("save-challenge").addEventListener("click", async () => {
    const teamId = teamSelect.value;
    const startDate = document.getElementById("challenge-start").value;
    const endDate = document.getElementById("challenge-end").value;
    const activeRadio = document.querySelector('input[name="challenge-active"]:checked');
    const active = activeRadio ? activeRadio.value === "on" : false;
    const statusEl = document.getElementById("challenge-admin-status");

    if(active && (!startDate || !endDate)){
      statusEl.textContent = "Set both a start and finish date before turning it on.";
      return;
    }
    if(active && startDate > endDate){
      statusEl.textContent = "Start date needs to be before the finish date.";
      return;
    }

    try{
      await db.collection("challenges").doc(teamId).set({
        active, startDate, endDate, updatedAt: Date.now(), updatedBy: userEmail
      });
      statusEl.textContent = "Saved.";
      if(teamId === profile.teamId){
        challenge = { active, startDate, endDate };
        renderChallengeBanner();
        await refreshBoard();
      }
    }catch(e){
      console.error(e);
      statusEl.textContent = "Couldn't save — check your connection.";
    }
  });
}

async function loadChallengeIntoAdminForm(teamId){
  const statusEl = document.getElementById("challenge-admin-status");
  statusEl.textContent = "";
  try{
    const snap = await db.collection("challenges").doc(teamId).get();
    const data = snap.exists ? snap.data() : null;
    document.getElementById("challenge-start").value = (data && data.startDate) || "";
    document.getElementById("challenge-end").value = (data && data.endDate) || "";
    const radio = document.querySelector(`input[name="challenge-active"][value="${data && data.active ? "on" : "off"}"]`);
    if(radio) radio.checked = true;
  }catch(e){
    console.error(e);
    statusEl.textContent = "Couldn't load this team's challenge.";
  }
}

/* ---------- Member management (only keith@9cr.uk can see/edit this) ---------- */
/* ---------- Teams tab (only keith@9cr.uk can see/use this) ---------- */
async function wireTeamsTab(){
  const userEmail = (auth.currentUser.email || "").toLowerCase();
  if(userEmail !== ADMIN_EMAIL.toLowerCase()) return;

  document.getElementById("tab-teams-btn").style.display = "flex";

  await seedTeamsIfEmpty();
  await loadTeamsList();
  renderTeamsList();
  await loadAllMembers();

  document.getElementById("add-team-btn").addEventListener("click", async () => {
    const nameInput = document.getElementById("new-team-name");
    const codeInput = document.getElementById("new-team-code");
    const statusEl = document.getElementById("add-team-status");
    const name = nameInput.value.trim();
    const code = codeInput.value.trim();

    if(!name || !code){ statusEl.textContent = "Enter both a team name and an invite code."; return; }
    if(findTeamByInviteCode(code)){ statusEl.textContent = "That invite code is already in use by another team."; return; }

    const newId = "team-" + Date.now().toString(36);
    try{
      await db.collection("teams").doc(newId).set({
        name, inviteCode: code, createdAt: Date.now()
      });
      await loadTeamsList();
      renderTeamsList();
      nameInput.value = "";
      codeInput.value = "";
      statusEl.textContent = `Added ${name}.`;
    }catch(e){
      console.error(e);
      statusEl.textContent = "Couldn't save — check your connection.";
    }
  });
}

function renderTeamsList(){
  const el = document.getElementById("teams-list");
  if(TEAMS_LIST.length === 0){
    el.innerHTML = `<div class="empty">No teams yet — add one above.</div>`;
    return;
  }

  el.innerHTML = TEAMS_LIST.map(t => `
    <div class="list-item">
      <button type="button" class="list-item-header" data-target="team-body-${t.id}">
        <span>${t.name}</span>
        <span class="chevron">›</span>
      </button>
      <div class="list-item-body" id="team-body-${t.id}">
        <div style="margin-bottom:8px;">
          <label style="font-size:11px;">Team name</label>
          <input type="text" class="team-name-input" data-id="${t.id}" value="${t.name.replace(/"/g, "&quot;")}">
        </div>
        <div class="row" style="gap:8px; align-items:flex-end;">
          <div style="flex:1;">
            <label style="font-size:11px;">Invite code</label>
            <input type="text" class="team-code-input" data-id="${t.id}" value="${t.inviteCode.replace(/"/g, "&quot;")}">
          </div>
          <button class="ghost team-save-btn" data-id="${t.id}" style="width:auto; padding:12px 18px;">Save</button>
          <button class="team-delete-btn" data-id="${t.id}" data-name="${t.name.replace(/"/g, "&quot;")}" title="Delete team" style="background:none; border:none; color:#e0785a; font-size:18px; padding:10px 6px; cursor:pointer; flex-shrink:0;">🗑</button>
        </div>
      </div>
    </div>
  `).join("");

  wireListItemToggles(el);

  el.querySelectorAll(".team-save-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const nameInput = el.querySelector(`.team-name-input[data-id="${id}"]`);
      const codeInput = el.querySelector(`.team-code-input[data-id="${id}"]`);
      const newName = nameInput.value.trim();
      const newCode = codeInput.value.trim();

      if(!newName || !newCode){ toast("Name and invite code can't be empty"); return; }
      const clash = TEAMS_LIST.find(t => t.inviteCode === newCode && t.id !== id);
      if(clash){ toast(`That code is already used by ${clash.name}`); return; }

      try{
        await db.collection("teams").doc(id).set({ name: newName, inviteCode: newCode }, { merge: true });
        await loadTeamsList();
        toast("Team updated");
        renderTeamsList();
        if(document.getElementById("admin-members-list")) await loadAllMembers();
        if(document.getElementById("header-sub")) await refreshHeaderIfSameTeam();
      }catch(e){
        console.error(e);
        toast("Couldn't save — check your connection");
      }
    });
  });

  el.querySelectorAll(".team-delete-btn").forEach(btn => {
    btn.addEventListener("click", () => deleteTeam(btn.dataset.id, btn.dataset.name));
  });
}

// Shared accordion behaviour: clicking a .list-item-header toggles the
// visibility of its paired .list-item-body (matched by id/data-target).
function wireListItemToggles(container){
  container.querySelectorAll(".list-item-header").forEach(header => {
    header.addEventListener("click", () => {
      const body = document.getElementById(header.dataset.target);
      if(!body) return;
      const isOpen = body.classList.contains("open");
      // Close any other open item in this same list first, so only one is
      // expanded at a time — keeps a long list manageable.
      container.querySelectorAll(".list-item-body.open").forEach(b => b.classList.remove("open"));
      container.querySelectorAll(".list-item-header.open").forEach(h => h.classList.remove("open"));
      if(!isOpen){
        body.classList.add("open");
        header.classList.add("open");
      }
    });
  });
}

async function deleteTeam(teamId, teamName){
  try{
    const snap = await db.collection("users").where("teamId", "==", teamId).get();
    const members = snap.docs.map(d => d.data().name || "Unnamed");

    let confirmMessage;
    if(members.length === 0){
      confirmMessage = `Delete ${teamName}? No members are currently on this team.\n\nThis can't be undone. Continue?`;
    }else{
      confirmMessage =
        `Delete ${teamName}?\n\n` +
        `The following ${members.length} member(s) will be set to "No team" — they'll keep their account and past step history, but won't count toward any leaderboard until reassigned:\n\n` +
        members.map(n => `• ${n}`).join("\n") +
        `\n\nThis can't be undone. Continue?`;
    }

    if(!window.confirm(confirmMessage)) return;

    for(const doc of snap.docs){
      await db.collection("users").doc(doc.id).set({ teamId: "", teamName: "" }, { merge: true });
    }

    await db.collection("teams").doc(teamId).delete();
    await db.collection("challenges").doc(teamId).delete().catch(() => {}); // harmless if none exists

    await loadTeamsList();
    renderTeamsList();
    await loadAllMembers();
    toast(`Deleted ${teamName}`);
  }catch(e){
    console.error(e);
    toast("Couldn't delete — check your connection");
  }
}

async function refreshHeaderIfSameTeam(){
  document.getElementById("header-sub").textContent = `Welcome back, ${profile.name} · ${teamNameById(profile.teamId)}`;
}

async function loadAllMembers(){
  const listEl = document.getElementById("admin-members-list");
  listEl.innerHTML = `<div class="empty">Loading members...</div>`;

  try{
    const snap = await db.collection("users").get();
    const members = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    members.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    if(members.length === 0){
      listEl.innerHTML = `<div class="empty">No members found.</div>`;
      return;
    }

    const teamOptions = TEAMS_LIST.map(t => `<option value="${t.id}">${t.name}</option>`).join("");

    listEl.innerHTML = members.map(m => `
      <div class="list-item">
        <button type="button" class="list-item-header" data-target="member-body-${m.id}">
          <span>${m.name || "Unnamed"}${m.id === uid ? " (you)" : ""}</span>
          <span class="row" style="gap:8px; width:auto;">
            <span class="mono" style="color:var(--gray); font-size:12px;">${teamNameById(m.teamId)}</span>
            <span class="chevron">›</span>
          </span>
        </button>
        <div class="list-item-body" id="member-body-${m.id}">
          <div class="row between" style="gap:8px;">
            <select class="member-team-select" data-uid="${m.id}" data-original-team="${m.teamId || ""}" style="width:auto; font-size:13px; padding:6px 10px; flex:1;">
              <option value="">No team</option>
              ${teamOptions}
            </select>
            ${m.id === uid ? "" : `<button class="member-delete-btn" data-uid="${m.id}" data-name="${(m.name || "Unnamed").replace(/"/g, "&quot;")}" title="Delete member's data" style="background:none; border:none; color:#e0785a; font-size:16px; padding:4px 6px; cursor:pointer; flex-shrink:0;">🗑</button>`}
          </div>
        </div>
      </div>
    `).join("");

    wireListItemToggles(listEl);

    // Set each select's current value after inserting (safer than baking
    // "selected" into the HTML string when values may contain quotes).
    members.forEach(m => {
      const sel = listEl.querySelector(`.member-team-select[data-uid="${m.id}"]`);
      if(sel) sel.value = m.teamId || "";
    });

    listEl.querySelectorAll(".member-team-select").forEach(sel => {
      sel.addEventListener("change", async () => {
        const memberUid = sel.dataset.uid;
        const newTeamId = sel.value; // "" means no team at all
        const team = TEAMS_LIST.find(t => t.id === newTeamId);
        try{
          await db.collection("users").doc(memberUid).set({
            teamId: newTeamId,
            teamName: team ? team.name : ""
          }, { merge: true });
          sel.dataset.originalTeam = newTeamId;
          toast(newTeamId ? `Set to ${team.name}` : "Set to no team");
          await loadAllMembers(); // refresh so the header's team label updates
        }catch(e){
          console.error(e);
          toast("Couldn't update — check your connection");
          sel.value = sel.dataset.originalTeam || ""; // revert the dropdown on failure
        }
      });
    });

    listEl.querySelectorAll(".member-delete-btn").forEach(btn => {
      btn.addEventListener("click", () => deleteMember(btn.dataset.uid, btn.dataset.name));
    });
  }catch(e){
    console.error(e);
    listEl.innerHTML = `<div class="empty">Couldn't load members — check your connection.</div>`;
  }
}

async function deleteMember(memberUid, memberName){
  const confirmed = window.confirm(
    `Delete ${memberName}'s data? This removes their profile and every step entry they've logged, ` +
    `on every team. Their weight/water logs stay private and untouched. ` +
    `This does NOT delete their login — do that separately in Firebase console → Authentication if needed.\n\n` +
    `This can't be undone. Continue?`
  );
  if(!confirmed) return;

  try{
    // "member" is present on every entry regardless of whether it uses the
    // old single-team format or the new teamIds array, so one query catches
    // everything this person has ever logged, on every team.
    const snap = await db.collection("entries").where("member", "==", memberUid).get();

    for(const d of snap.docs){
      await db.collection("entries").doc(d.id).delete();
    }
    await db.collection("users").doc(memberUid).delete();

    toast(`Deleted ${memberName}'s data`);
    await loadAllMembers();
    await refreshBoard();
  }catch(e){
    console.error(e);
    toast("Couldn't delete — check your connection");
  }
}

/* ---------- Wellness: weight + water — private, stored under users/{uid}/... ---------- */
function wireWellness(){
  const weightDate = document.getElementById("weight-date");
  weightDate.max = todayStr();
  weightDate.value = todayStr();
  weightDate.addEventListener("change", () => loadWeightForDate(weightDate.value));

  const waterDate = document.getElementById("water-date");
  waterDate.max = todayStr();
  waterDate.value = todayStr();
  waterDate.addEventListener("change", () => {
    updateWaterDateLabel();
    loadWaterInputForDate(waterDate.value);
  });

  document.querySelectorAll('input[name="weight-unit"]').forEach(radio => {
    radio.addEventListener("change", async () => {
      profile.weightUnit = radio.value;
      updateWeightUnitLabel();
      await db.collection("users").doc(uid).set({ weightUnit: radio.value }, { merge: true });
      await refreshWeight();
    });
  });

  document.getElementById("save-weight").addEventListener("click", async () => {
    const raw = parseFloat(document.getElementById("weight-input").value);
    if(isNaN(raw) || raw <= 0){ toast("Enter a valid weight"); return; }
    const weightKg = +unitToKg(raw, profile.weightUnit).toFixed(2);
    const date = weightDate.value || todayStr();
    try{
      await db.collection("users").doc(uid).collection("weightLogs").doc(date).set({
        date: date, weightKg, updatedAt: Date.now()
      });
      toast(date === todayStr() ? "Weight saved" : `Weight saved for ${date}`);
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
      return;
    }
    try{
      await refreshWeight();
    }catch(e){
      console.error("Post-save refresh failed (save itself was fine):", e);
    }
  });

  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const add = parseInt(btn.dataset.add, 10);
      const date = waterDate.value || todayStr();
      try{
        await db.collection("users").doc(uid).collection("waterLogs").doc(date).set({
          date: date,
          ml: firebase.firestore.FieldValue.increment(add),
          updatedAt: Date.now()
        }, { merge: true });
        toast(date === todayStr() ? `+${add}ml` : `+${add}ml on ${date}`);
      }catch(e){
        console.error(e);
        toast("Couldn't save — check your connection");
        return;
      }
      try{
        await refreshWater();
        await loadWaterInputForDate(date);
      }catch(e){
        console.error("Post-save refresh failed (save itself was fine):", e);
      }
    });
  });

  document.getElementById("save-water").addEventListener("click", async () => {
    const val = parseInt(document.getElementById("water-input").value, 10);
    if(isNaN(val) || val < 0){ toast("Enter a valid amount"); return; }
    const date = waterDate.value || todayStr();
    try{
      await db.collection("users").doc(uid).collection("waterLogs").doc(date).set({
        date: date, ml: val, updatedAt: Date.now()
      });
      toast(date === todayStr() ? "Water total set" : `Water total set for ${date}`);
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
      return;
    }
    try{
      await refreshWater();
    }catch(e){
      console.error("Post-save refresh failed (save itself was fine):", e);
    }
  });
}

async function loadWeightForDate(date){
  try{
    const snap = await db.collection("users").doc(uid).collection("weightLogs").doc(date).get();
    const input = document.getElementById("weight-input");
    input.value = snap.exists ? kgToUnit(snap.data().weightKg, profile.weightUnit).toFixed(1) : "";
  }catch(e){
    console.error(e);
  }
}

function updateWaterDateLabel(){
  const date = document.getElementById("water-date").value;
  document.getElementById("water-date-label").textContent =
    date === todayStr() ? "Date (quick-add buttons below apply to this date)" : `Date (editing ${date})`;
}

async function loadWaterInputForDate(date){
  try{
    const snap = await db.collection("users").doc(uid).collection("waterLogs").doc(date).get();
    document.getElementById("water-input").value = snap.exists ? (snap.data().ml || 0) : "";
  }catch(e){
    console.error(e);
  }
}

function updateWeightUnitLabel(){
  document.getElementById("weight-input-label").textContent = `Log today's weight (${weightUnitLabel(profile.weightUnit)})`;
}

function buildLineChart(canvasId, existing, labels, data, label, color){
  const ctx = document.getElementById(canvasId).getContext("2d");
  if(existing) existing.destroy();
  return new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [{
        label: label,
        data: data,
        borderColor: color,
        backgroundColor: color,
        tension: 0.3,
        pointRadius: 3,
        fill: false
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8A94A6", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#8A94A6", font: { size: 10 } }, grid: { color: "rgba(245,241,232,0.06)" } }
      }
    }
  });
}

function buildBarChart(canvasId, existing, labels, data, label, color){
  const ctx = document.getElementById(canvasId).getContext("2d");
  if(existing) existing.destroy();
  return new Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [{ label: label, data: data, backgroundColor: color, borderRadius: 4 }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#8A94A6", font: { size: 10 } }, grid: { display: false } },
        y: { ticks: { color: "#8A94A6", font: { size: 10 } }, grid: { color: "rgba(245,241,232,0.06)" } }
      }
    }
  });
}

async function refreshWeight(){
  try{
    const snap = await db.collection("users").doc(uid).collection("weightLogs")
      .orderBy("date", "desc").limit(14).get();

    const historyEl = document.getElementById("weight-history");
    if(snap.empty){
      document.getElementById("weight-latest").textContent = "–";
      document.getElementById("weight-trend").textContent = "No entries yet";
      historyEl.innerHTML = "";
      if(weightChart){ weightChart.destroy(); weightChart = null; }
      return;
    }
    const unit = profile.weightUnit;
    const docsDesc = snap.docs.map(d => d.data());
    const latest = docsDesc[0];
    document.getElementById("weight-latest").textContent = kgToUnit(latest.weightKg, unit).toFixed(1) + " " + weightUnitLabel(unit);

    if(docsDesc.length > 1){
      const diffKg = latest.weightKg - docsDesc[1].weightKg;
      const diff = +kgToUnit(Math.abs(diffKg), unit).toFixed(1);
      const arrow = diffKg > 0 ? "▲" : diffKg < 0 ? "▼" : "→";
      document.getElementById("weight-trend").textContent = arrow + " " + diff + " " + weightUnitLabel(unit) + " vs previous entry";
    }else{
      document.getElementById("weight-trend").textContent = "First entry logged";
    }

    historyEl.innerHTML = docsDesc.map(function(e){
      return '<div class="history-item"><span class="date">' + e.date + '</span><span class="mono">' +
        kgToUnit(e.weightKg, unit).toFixed(1) + " " + weightUnitLabel(unit) + '</span></div>';
    }).join("");

    const docsAsc = docsDesc.slice().reverse();
    weightChart = buildLineChart(
      "weight-chart", weightChart,
      docsAsc.map(function(e){ return shortDate(e.date); }),
      docsAsc.map(function(e){ return +kgToUnit(e.weightKg, unit).toFixed(1); }),
      "Weight (" + weightUnitLabel(unit) + ")",
      "#E8B93F"
    );
  }catch(e){
    console.error(e);
  }
}

async function refreshWater(){
  try{
    const snap = await db.collection("users").doc(uid).collection("waterLogs")
      .orderBy("date", "desc").limit(14).get();

    if(snap.empty){
      document.getElementById("water-today").textContent = "0 ml";
      document.getElementById("water-today-l").textContent = "0.0 L today";
      if(waterChart){ waterChart.destroy(); waterChart = null; }
      return;
    }

    const docsDesc = snap.docs.map(d => d.data());
    const todayEntry = docsDesc.find(function(e){ return e.date === todayStr(); });
    const todayMl = todayEntry ? (todayEntry.ml || 0) : 0;
    document.getElementById("water-today").textContent = todayMl.toLocaleString() + " ml";
    document.getElementById("water-today-l").textContent = (todayMl / 1000).toFixed(1) + " L today";

    const docsAsc = docsDesc.slice().reverse();
    waterChart = buildBarChart(
      "water-chart", waterChart,
      docsAsc.map(function(e){ return shortDate(e.date); }),
      docsAsc.map(function(e){ return e.ml || 0; }),
      "Water (ml)",
      "#4C9A5B"
    );
  }catch(e){
    console.error(e);
  }
}

/* ---------- Profile ---------- */
function wireProfile(){
  document.getElementById("profile-mode").addEventListener("change", () => {
    updateProfileVisibility();
    updateProfilePreview();
  });
  document.querySelectorAll('input[name="height-unit"]').forEach(radio => {
    radio.addEventListener("change", () => {
      updateProfileVisibility();
      updateProfilePreview();
    });
  });
  document.getElementById("profile-height-cm").addEventListener("input", updateProfilePreview);
  document.getElementById("profile-height-ft").addEventListener("input", updateProfilePreview);
  document.getElementById("profile-height-in").addEventListener("input", updateProfilePreview);
  document.getElementById("profile-stride").addEventListener("input", updateProfilePreview);

  document.getElementById("save-profile").addEventListener("click", async () => {
    const name = document.getElementById("profile-name").value.trim() || profile.name;
    const mode = document.getElementById("profile-mode").value;
    const heightUnitRadio = document.querySelector('input[name="height-unit"]:checked');
    const heightUnit = heightUnitRadio ? heightUnitRadio.value : "cm";
    const strideM = parseFloat(document.getElementById("profile-stride").value) || null;

    let heightCm = null;
    if(heightUnit === "cm"){
      heightCm = parseFloat(document.getElementById("profile-height-cm").value) || null;
    }else{
      const ft = parseFloat(document.getElementById("profile-height-ft").value) || 0;
      const inch = parseFloat(document.getElementById("profile-height-in").value) || 0;
      heightCm = (ft || inch) ? +ftInToCm(ft, inch).toFixed(1) : null;
    }

    const data = { name, mode, heightUnit };
    if(mode === "height") data.heightCm = heightCm;
    if(mode === "manual") data.strideM = strideM;

    try{
      await db.collection("users").doc(uid).set(data, { merge: true });
      profile = Object.assign({}, profile, data);
      document.getElementById("header-sub").textContent = `Welcome back, ${profile.name} · ${teamNameById(profile.teamId)}`;
      toast("Profile saved");
      await refreshToday();
      await refreshHistory();
      await refreshBoard();
    }catch(e){
      console.error(e);
      toast("Couldn't save profile — check your connection");
    }
  });
}

function updateProfileVisibility(){
  const mode = document.getElementById("profile-mode").value;
  document.getElementById("profile-height-row").style.display = mode === "height" ? "block" : "none";
  document.getElementById("profile-stride-row").style.display = mode === "manual" ? "block" : "none";

  const heightUnitRadio1 = document.querySelector('input[name="height-unit"]:checked');
  const heightUnit = heightUnitRadio1 ? heightUnitRadio1.value : "cm";
  document.getElementById("height-cm-row").style.display = heightUnit === "cm" ? "block" : "none";
  document.getElementById("height-ftin-row").style.display = heightUnit === "ftin" ? "flex" : "none";
}

function updateProfilePreview(){
  const mode = document.getElementById("profile-mode").value;
  const heightUnitRadio2 = document.querySelector('input[name="height-unit"]:checked');
  const heightUnit = heightUnitRadio2 ? heightUnitRadio2.value : "cm";
  const strideM = parseFloat(document.getElementById("profile-stride").value);

  let heightCm;
  if(heightUnit === "cm"){
    heightCm = parseFloat(document.getElementById("profile-height-cm").value);
  }else{
    const ft = parseFloat(document.getElementById("profile-height-ft").value) || 0;
    const inch = parseFloat(document.getElementById("profile-height-in").value) || 0;
    heightCm = ftInToCm(ft, inch);
  }

  const tmp = { mode: mode, heightCm: heightCm, strideM: strideM };
  const stride = computeStride(tmp);
  const unit = getDistanceUnit();
  const dist = kmToDistanceUnit((10000*stride)/1000, unit);
  document.getElementById("profile-preview").textContent =
    "Estimated stride: " + stride.toFixed(2) + " m · 10,000 steps ≈ " + dist.toFixed(1) + " " + distanceUnitLabel(unit);
}
