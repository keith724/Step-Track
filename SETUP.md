# Step Squad — setup & install guide

This is a small installable web app (PWA). It works like a native Android app once
installed — icon on the home screen, opens full-screen, no browser address bar —
but it's built with plain HTML/CSS/JS so there's no app store, no signing keys,
and no cost. Everyone signs in with their own email/password account (Firebase
Authentication). Steps are shared with the group for the leaderboard; weight and
water logs are private to each account and enforced as private by the database
rules, not just hidden in the UI.

Total setup time: ~20 minutes, done once by whoever's setting this up for the group.

---

## 1. Create a free Firebase project

1. Go to https://console.firebase.google.com and sign in with any Google account.
2. Click **Add project**, give it a name (e.g. `step-squad`), and finish the wizard
   (you can turn off Google Analytics — not needed).
3. In the left menu, click **Build → Firestore Database → Create database**.
   - Choose **Start in test mode** for now — you'll replace these rules with the
     real ones in step 3 below before sharing the app.
   - Pick any region close to your group.
4. In the left menu, click **Build → Authentication → Get started**.
   - Under **Sign-in method**, enable **Email/Password**.
5. Click the **gear icon → Project settings**, scroll to **Your apps**, click the
   **</> (Web)** icon, give it a nickname, and click **Register app**.
6. Firebase will show you a `firebaseConfig` object. Copy the values into
   `firebase-config.js` in this folder, replacing the `PASTE_YOUR_...` placeholders.
7. In that same file, edit the `TEAMS` object to set up your team(s) — each
   entry maps an invite code to a completely separate team (own leaderboard,
   own members, own challenge dates). See "Adding a second team" further
   down for details.

---

## 2. Put the files online

The app needs to live at a public URL so everyone's phone can reach the same
Firebase project. Easiest free option — **Netlify Drop**, no account needed:

1. Go to https://app.netlify.com/drop
2. Drag the whole `step-tracker` folder (with your edited `firebase-config.js`
   inside it) onto the page.
3. Netlify gives you a live URL like `https://random-name-123.netlify.app`.
   That's the link you'll send to your friends.

(Alternative: GitHub Pages, if you'd rather have a permanent account-based host —
create a repo, upload these files, enable Pages in repo Settings. Same result.)

**One extra Firebase step when you have your real URL:** in the Firebase console,
go to **Authentication → Settings → Authorized domains** and add your Netlify (or
GitHub Pages) domain. Firebase blocks sign-in from unrecognised domains by default.

---

## 3. Lock down the database rules (do this before sharing the app)

This is the step that actually makes weight and water private — not just hidden
in the app's UI, but unreadable by anyone except the account that wrote it.

Go to **Firestore Database → Rules** in the Firebase console and replace the
contents with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Step entries: readable only by signed-in members of the SAME team as
    // the entry (checked by looking up your own team on your users/ doc),
    // or by the keith@9cr.uk admin account viewing any team. Writable only
    // by the entry's own owner, tagged to their own team.
    match /entries/{entryId} {
      allow read: if request.auth != null
                  && (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.teamId == resource.data.teamId
                      || request.auth.token.email == 'keith@9cr.uk');
      allow create, update: if request.auth != null
                             && request.auth.uid == request.resource.data.member
                             && request.resource.data.teamId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.teamId;
      allow delete: if request.auth != null && request.auth.uid == resource.data.member;
    }

    // Profile doc: name + stride + team settings. Readable by your own
    // team-mates (needed for the leaderboard) or the admin account viewing
    // any team, writable only by the owner.
    match /users/{uid} {
      allow read: if request.auth != null
                  && (request.auth.uid == uid
                      || get(/databases/$(database)/documents/users/$(request.auth.uid)).data.teamId == resource.data.teamId
                      || request.auth.token.email == 'keith@9cr.uk');
      allow write: if request.auth != null && request.auth.uid == uid;

      // Weight and water logs live *inside* each user's own document tree.
      // Only that exact uid can read or write them — nobody else, including
      // other signed-in group members (even on the same team), can reach
      // these paths.
      match /weightLogs/{date} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
      match /waterLogs/{date} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }

    // Challenge settings, one doc per team (doc ID = team ID). Every
    // signed-in member can read their OWN team's challenge doc (for the
    // banner/filter); only keith@9cr.uk can read or write ANY team's
    // challenge doc, which is what lets one admin manage every team.
    match /challenges/{teamId} {
      allow read: if request.auth != null
                  && (get(/databases/$(database)/documents/users/$(request.auth.uid)).data.teamId == teamId
                      || request.auth.token.email == 'keith@9cr.uk');
      allow write: if request.auth != null
                   && request.auth.token.email == 'keith@9cr.uk';
    }
  }
}
```

Click **Publish**. From this point on:
- Nobody can read or write anything without being signed in.
- You can only ever see step totals, names, and challenge info for **your own team** — team 2's data is completely invisible to team 1's members, and vice versa — except for the `keith@9cr.uk` admin account, which can view any team's leaderboard via the team picker on the Leaderboard tab.
- Only the account owner can ever read or write their own weight/water logs — this stays true even for the admin account, since weight/water rules have no admin exception.
- Only the account signed in as `keith@9cr.uk` can set or change challenge
  dates for either team.

---

## 4. Install it on each person's Android phone

Send everyone the URL from step 2. On each phone:

1. Open the link in **Chrome**.
2. Tap the **⋮ menu** (top right) → **Add to Home screen** → **Install**.
   (On some phones Chrome shows an automatic "Install app" banner instead —
   just tap it.)
3. The Step Squad icon now appears on the home screen like any other app.
   Opening it launches full-screen with no browser bar.
4. First launch: tap **Create an account**, enter name / email / password and
   the group invite code you set in step 1. After that they just log in.

Each person can then, on their own phone:
- Log steps for the day under **Today** — visible to the group.
- Check the **Leaderboard** tab (7 days / 30 days / all time).
- Log weight and water under **Wellness** — visible only to them, on any
  device they log into.
- Go to **Profile** to set their height (or an exact stride length) so their
  distance is personalised instead of using the 6'0" default.

If someone gets a new phone, they just install the app again and log in with
the same email/password — their data follows their account, not the device.

---

## How distance is calculated

- Default: stride length ≈ 0.76 m, based on an average 6'0" (183 cm) adult
  (stride ≈ 41.5% of height).
- "My height" mode: enter height in cm and the same 41.5% formula is used.
- "Manual" mode: enter an exact stride length in metres if someone already
  knows theirs (e.g. from a fitness watch).
- Distance = steps × stride length. It's a reasonable estimate, not a
  precise GPS measurement.

---

## Adding a second team (or third, fourth...)

Open `firebase-config.js` and look at the `TEAMS` object:

```javascript
const TEAMS = {
  "walking26": { id: "team-1", name: "Keith's Squad" },
  "CHANGE_ME": { id: "team-2", name: "Second Team" }
};
```

- The key (`"walking26"`, `"CHANGE_ME"`) is the invite code people type in at
  sign-up.
- `id` must be unique per team and, once anyone has signed up using that
  team's code, shouldn't be changed — it's the permanent link between a
  member and their team's data.
- `name` is just the friendly label shown in the app (welcome message,
  leaderboard admin dropdown).

Rename `"CHANGE_ME"` to whatever invite code the second team should use, and
change `"Second Team"` to their actual name. Add more entries the same way
for further teams.

**What each team gets:** their own completely separate leaderboard, member
list, and challenge dates — invisible to other teams, enforced by the
Firestore rules above, not just hidden in the app. Everyone signs in through
the exact same app URL; the invite code they use at sign-up is what silently
assigns them to their team.

**What's shared across teams:** only the `keith@9cr.uk` admin account, which
can set challenge dates for any team via a team picker in its Profile tab.
Regular members of one team have no visibility into another team's admin
controls, or any of their data.

---

## What the invite code does and doesn't do

Each code in `TEAMS` is checked in the app's JavaScript at sign-up — a
friendly speed bump so a random person who finds your URL can't just sign up
as either team, not a cryptographic secret (anyone could technically read the
codes from the page source). The real security is the Firestore rules above,
which control what a signed-in account can actually read or write regardless
of how they signed up. For a private friend-group setup, this two-layer
approach (soft gate on signup + hard rules on data access) is a reasonable
balance of simplicity and privacy. If you later want to remove the invite
codes entirely and instead approve members by hand, or add password reset
emails, those are both small additions — just ask.
