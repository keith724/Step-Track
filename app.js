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

/* ---------- Auth gate UI wiring ---------- */
const gateEl = document.getElementById("gate");
const appEl = document.getElementById("app");

document.getElementById("show-signup").addEventListener("click", (e) => {
  e.preventDefault();
  document.getElementById("form-login").style.display = "none";
  document.getElementById("form-signup").style.display = "block";
  document.getElementById("gate-error").textContent = "";
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
  const team = TEAMS[invite];
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

  await loadProfile();
  document.getElementById("header-sub").textContent = `Welcome back, ${profile.name} · ${profile.teamName || ""}`;

  wireTabs();
  wireToday();
  wireProfile();
  wireWellness();
  wireChallengeAdmin();
  wireBoardTeamSwitcher();

  viewingTeamId = profile.teamId;
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

  // Backfill: anyone who signed up before teams existed gets defaulted to
  // the first team, so their existing entries and login keep working.
  if(!profile.teamId){
    const firstKey = Object.keys(TEAMS)[0];
    profile.teamId = TEAMS[firstKey].id;
    profile.teamName = TEAMS[firstKey].name;
    await db.collection("users").doc(uid).set(
      { teamId: profile.teamId, teamName: profile.teamName }, { merge: true }
    );
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

  dateInput.addEventListener("change", () => loadStepsForDate(dateInput.value));

  document.getElementById("save-steps").addEventListener("click", async () => {
    const val = parseInt(document.getElementById("steps-input").value, 10);
    if(isNaN(val) || val < 0){ toast("Enter a valid step count"); return; }
    const date = dateInput.value || todayStr();

    const id = `${uid}_${date}`;
    try{
      await db.collection("entries").doc(id).set({
        member: uid,
        name: profile.name,
        teamId: profile.teamId,
        date: date,
        steps: val,
        updatedAt: Date.now()
      });
      toast(date === todayStr() ? "Saved!" : `Saved for ${date}`);
      await refreshToday();
      await refreshHistory();
      await refreshBoard();
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
    }
  });
}

async function loadStepsForDate(date){
  const label = document.getElementById("steps-input-label");
  label.textContent = date === todayStr() ? "Steps" : `Steps (editing ${date})`;
  try{
    const snap = await db.collection("entries").doc(`${uid}_${date}`).get();
    document.getElementById("steps-input").value = snap.exists ? snap.data().steps : "";
  }catch(e){
    console.error(e);
  }
}

async function refreshToday(){
  const snap = await db.collection("entries").doc(`${uid}_${todayStr()}`).get();
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
    const snap = await db.collection("entries")
      .where("member", "==", uid)
      .orderBy("date", "desc")
      .limit(14)
      .get();

    if(snap.empty){
      listEl.innerHTML = `<div class="empty">No entries yet — log today's steps above.</div>`;
      return;
    }
    const stride = computeStride(profile);
    listEl.innerHTML = snap.docs.map(d => {
      const e = d.data();
      return `<div class="history-item">
        <span class="date">${e.date}</span>
        <span class="mono">${e.steps.toLocaleString()} steps · ${fmtDistance(e.steps, stride)}</span>
      </div>`;
    }).join("");
  }catch(e){
    console.error(e);
    listEl.innerHTML = `<div class="empty">Couldn't load history yet. If this is the first run, Firestore may need a moment to build an index — check the browser console for a one-click link.</div>`;
  }
}

/* ---------- Leaderboard (steps only — weight/water never appear here) ---------- */
function wireBoardTeamSwitcher(){
  const userEmail = (auth.currentUser.email || "").toLowerCase();
  if(userEmail !== ADMIN_EMAIL.toLowerCase()) return;

  const card = document.getElementById("board-admin-team-card");
  const select = document.getElementById("board-team-select");
  card.style.display = "block";

  select.innerHTML = Object.values(TEAMS).map(t =>
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

async function refreshBoard(){
  const boardEl = document.getElementById("board-list");
  boardEl.innerHTML = `<div class="empty">Loading leaderboard...</div>`;
  const range = document.getElementById("board-range").value;
  const unit = getDistanceUnit();

  if(range === "challenge" && (!challenge || !challenge.startDate || !challenge.endDate)){
    boardEl.innerHTML = `<div class="empty">No challenge has been set up yet.</div>`;
    return;
  }

  try{
    let query = db.collection("entries").where("teamId", "==", viewingTeamId);
    if(range === "challenge"){
      query = query.where("date", ">=", challenge.startDate).where("date", "<=", challenge.endDate);
    }else if(range !== "alltime"){
      query = query.where("date", ">=", daysAgoStr(parseInt(range, 10)));
    }
    const entriesSnap = await query.get();
    const usersSnap = await db.collection("users").where("teamId", "==", viewingTeamId).get();

    const users = {};
    usersSnap.forEach(d => users[d.id] = d.data());

    const totals = {};
    entriesSnap.forEach(d => {
      const e = d.data();
      totals[e.member] = (totals[e.member] || 0) + e.steps;
    });

    let rows = Object.keys(totals).map(id => {
      const m = users[id] || { name: "Friend" };
      const stride = computeStride(m);
      return { id, name: m.name || "Friend", steps: totals[id], km: (totals[id] * stride) / 1000 };
    });

    Object.keys(users).forEach(id => {
      if(!(id in totals)) rows.push({ id, name: users[id].name || "Friend", steps: 0, km: 0 });
    });

    rows.sort((a, b) => b.steps - a.steps);

    if(rows.length === 0){
      boardEl.innerHTML = `<div class="empty">No one has logged steps yet — be the first!</div>`;
      return;
    }

    const max = Math.max(...rows.map(r => r.steps), 1);
    const medals = ["🥇", "🥈", "🥉"];

    boardEl.innerHTML = rows.map((r, i) => {
      const pct = Math.min(100, (r.steps / max) * 100);
      const isMe = r.id === uid;
      const dist = kmToDistanceUnit(r.km, unit);
      return `<div class="lane" style="${isMe ? "outline:1px solid rgba(232,185,63,0.5);" : ""}">
        <div class="lane-top">
          <div class="lane-name">
            <span class="bib">${i+1}</span>
            <span>${r.name}${isMe ? " (you)" : ""}</span>
            ${medals[i] ? `<span class="medal">${medals[i]}</span>` : ""}
          </div>
          <span class="mono" style="color:var(--gray);">${r.steps.toLocaleString()} · ${dist.toFixed(1)}${distanceUnitLabel(unit)}</span>
        </div>
        <div class="lane-track">
          <div class="lane-fill" style="width:${pct}%"></div>
          <div class="lane-runner" style="left:${pct}%">🏃</div>
        </div>
      </div>`;
    }).join("");
  }catch(e){
    console.error(e);
    boardEl.innerHTML = `<div class="empty">Couldn't load the leaderboard. If this is the first run, check the browser console — Firestore sometimes needs a one-click index link the first time.</div>`;
  }
}

/* ---------- Challenge admin (only keith@9cr.uk can see/edit this) ---------- */
function wireChallengeAdmin(){
  const card = document.getElementById("admin-challenge-card");
  const userEmail = (auth.currentUser.email || "").toLowerCase();
  if(userEmail !== ADMIN_EMAIL.toLowerCase()) return;

  card.style.display = "block";

  const teamSelect = document.getElementById("challenge-team-select");
  teamSelect.innerHTML = Object.values(TEAMS).map(t =>
    `<option value="${t.id}">${t.name}</option>`
  ).join("");
  teamSelect.value = profile.teamId; // default to the admin's own team

  loadChallengeIntoAdminForm(teamSelect.value);
  teamSelect.addEventListener("change", () => loadChallengeIntoAdminForm(teamSelect.value));

  document.getElementById("save-challenge").addEventListener("click", async () => {
    const teamId = teamSelect.value;
    const startDate = document.getElementById("challenge-start").value;
    const endDate = document.getElementById("challenge-end").value;
    const active = document.querySelector('input[name="challenge-active"]:checked').value === "on";
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
      await refreshWeight();
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
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
        await refreshWater();
        await loadWaterInputForDate(date);
      }catch(e){
        console.error(e);
        toast("Couldn't save — check your connection");
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
      await refreshWater();
    }catch(e){
      console.error(e);
      toast("Couldn't save — check your connection");
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
    const heightUnit = document.querySelector('input[name="height-unit"]:checked').value;
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
      document.getElementById("header-sub").textContent = `Welcome back, ${profile.name} · ${profile.teamName || ""}`;
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

  const heightUnit = document.querySelector('input[name="height-unit"]:checked').value;
  document.getElementById("height-cm-row").style.display = heightUnit === "cm" ? "block" : "none";
  document.getElementById("height-ftin-row").style.display = heightUnit === "ftin" ? "flex" : "none";
}

function updateProfilePreview(){
  const mode = document.getElementById("profile-mode").value;
  const heightUnit = document.querySelector('input[name="height-unit"]:checked').value;
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
