# Cyber Grid — Attack & Defense Simulation

A Stratego-style tabletop/projector game where a **Blue Team (Defenders)** protects a
critical electricity-grid server against a **Red Team (Attackers)**, using scenario
cards instead of free-form piece movement. An admin (facilitator) runs the action from
a laptop; everyone else watches the live board on a shared screen or projector.

> This is a tabletop facilitation game for training/awareness purposes. It does not
> simulate real exploits, run any real network traffic, or teach attack techniques —
> it's a turn-based board game with a cybersecurity skin.

---

## How the game is played

1. **Setup** — the admin places all 24 Blue pieces and 20 Red pieces on the board
   (hidden from the public display, exactly like Stratego). Blue deploys in rows 5–7,
   Red in rows 0–2. Rows 3–4 are the neutral DMZ.
2. **Play** — teams take turns. Picking a scenario card does not move anything by
   itself — it only sets the odds for whatever you do next. Each turn is a 3-click
   sequence on the admin console:
   1. Click a scenario card on the right that matches the acting side (e.g. *Phishing
      Campaign* for Red) — the blue instruction banner above the board will confirm
      it's armed and tell you what to click next. (You can also skip the card and
      just move a piece plainly, with no modifier.)
   2. Click that side's piece on the **Tactical Board** in the center.
   3. Click an adjacent cell — an empty one to simply move there, or an enemy piece
      to trigger a clash.
   4. Click **End Turn** to pass to the other side.
3. **Clashes** — when pieces meet, a "Resolve Clash" panel opens on the right showing
   attacker vs. defender and the odds. Set or randomize the roll, then click
   **Resolve & Apply**. Both pieces are revealed publicly when this happens.
4. **Detection meter** — every attacking action carries a detection risk. If the
   meter reaches 100%, the SOC catches the intrusion and **Blue wins** instantly.
5. **Win conditions**
   - **Blue wins** if the detection meter maxes out, or if all Red units are eliminated.
   - **Red wins** if they breach the Critical Server piece before being detected, or
     if all of Blue's movable defenders are eliminated.

---

## What's in this repository

```
index.html              Public board display (for the projector / shared screen)
admin.html               Admin control panel (PIN-gated, for the facilitator's laptop)
data/gameData.js         Piece rosters, ranks, and the full scenario card library
js/stateShape.js         Shared game-state shape + helper functions
js/gameEngine.js         Combat resolution & win-condition logic (pure functions)
js/firebaseConfig.js     Firebase project config — YOU edit this before deploying
js/adminConfig.js        Admin panel PIN — YOU edit this before deploying
js/board.js              Public board rendering + live state subscription
js/admin.js              Admin panel logic: setup, moves, clashes, scenario cards
css/theme.css            Shared design tokens (colors, type, buttons, panels)
css/board.css             Public board styles
css/admin.css             Admin panel styles
assets/icons/sprite.svg  All piece icons as a single inline SVG sprite sheet
```

No build step, no framework, no `npm install`. It's plain HTML/CSS/JS so it runs
directly on GitHub Pages.

---

## Why you need Firebase

GitHub Pages only serves static files — it has no server of its own. The admin's
laptop and the projector display are two different browsers that need to see the
same live game state. **Firebase Realtime Database** is a free, hosted database that
both pages connect to directly from the browser, so the projector updates the instant
the admin makes a move. There's no backend code to write or host — Firebase's free
"Spark" tier handles it.

---

## Part 1 — Create your Firebase project (one-time, ~5 minutes)

1. Go to **https://console.firebase.google.com** and sign in with any Google account.
2. Click **"Add project"** (or "Create a project").
   - Give it any name, e.g. `cyber-grid-game`.
   - When asked about Google Analytics, you can **disable** it — not needed here.
   - Click **Create project** and wait for it to finish provisioning.
3. Once inside your new project, look at the left sidebar and click **Build → Realtime Database**.
4. Click **Create Database**.
   - Choose any region close to you.
   - When asked about security rules, choose **"Start in test mode"** for now (we'll
     tighten this in Part 3 below — test mode is fine for a private game night but
     should not be left open indefinitely).
5. You'll now see an empty database with a URL at the top that looks like
   `https://cyber-grid-game-default-rtdb.firebaseio.com` — note this down, you'll need it.
6. Now register a **web app** so you get the config keys this project needs:
   - Click the **gear icon** next to "Project Overview" (top-left) → **Project settings**.
   - Scroll to **"Your apps"** and click the **`</>`** (web) icon.
   - Give the app any nickname, e.g. `cyber-grid-web`. You do **not** need Firebase
     Hosting — just register the app.
   - Firebase will show you a config object that looks like this:

     ```js
     const firebaseConfig = {
       apiKey: "AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
       authDomain: "cyber-grid-game.firebaseapp.com",
       databaseURL: "https://cyber-grid-game-default-rtdb.firebaseio.com",
       projectId: "cyber-grid-game",
       storageBucket: "cyber-grid-game.appspot.com",
       messagingSenderId: "123456789012",
       appId: "1:123456789012:web:abcdef1234567890"
     };
     ```
   - **Copy this whole block.** You'll paste it into the game in the next step.

---

## Part 2 — Plug your Firebase config into the game

1. Open **`js/firebaseConfig.js`** in this project.
2. Find this block near the top:

   ```js
   const firebaseConfig = {
     apiKey: "YOUR_API_KEY",
     authDomain: "YOUR_PROJECT.firebaseapp.com",
     databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
     projectId: "YOUR_PROJECT",
     storageBucket: "YOUR_PROJECT.appspot.com",
     messagingSenderId: "YOUR_SENDER_ID",
     appId: "YOUR_APP_ID"
   };
   ```
3. Replace it with the real config block you copied from the Firebase console in
   Part 1, step 6. Save the file.

That's it — both `index.html` and `admin.html` load this same file, so one edit
configures the whole game.

---

## Part 3 — Lock down your database rules (recommended before real use)

"Test mode" rules allow anyone with your database URL to read and write to it
without restriction, which is fine for a quick private test but not great long-term.
Once you've confirmed the game works, tighten the rules:

1. In the Firebase console, go to **Realtime Database → Rules**.
2. Replace the rules with:

   ```json
   {
     "rules": {
       "games": {
         "$gameId": {
           ".read": true,
           ".write": true
         }
       }
     }
   }
   ```

   This keeps things simple (no login system) while scoping reads/writes to the
   `games/` path the app actually uses. For genuinely sensitive use, you'd want to
   add Firebase Authentication and tighten `.write` further — but for a facilitated
   game night where the admin PIN is the main gate, this level is reasonable.
3. Click **Publish**.

> **Reminder:** the admin PIN (see Part 4) is a light deterrent only, not real
> security — it's checked entirely in the browser. Don't use this game to manage or
> display anything genuinely sensitive.

---

## Part 4 — Set your admin PIN

1. Open **`js/adminConfig.js`**.
2. Change the value:

   ```js
   const ADMIN_PIN = "1234";
   ```

   to whatever PIN you want the facilitator to use to unlock `admin.html`.

---

## Part 5 — Deploy to GitHub Pages

1. Create a new GitHub repository (public or private — Pages works for both, though
   private repos need GitHub Pro/Team/Enterprise to publish Pages from a private repo).
2. Push all the files in this folder to that repository, preserving the folder
   structure (`index.html` and `admin.html` at the repo root, `css/`, `js/`,
   `data/`, and `assets/` as subfolders).
3. In the repository, go to **Settings → Pages**.
4. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose
   your default branch (e.g. `main`) and `/ (root)` as the folder, then **Save**.
5. After a minute or two, GitHub will show you a live URL, typically:
   `https://<your-username>.github.io/<repo-name>/`
6. Your two pages are now live at:
   - **Board (public/projector):** `https://<your-username>.github.io/<repo-name>/index.html`
   - **Admin (facilitator only):** `https://<your-username>.github.io/<repo-name>/admin.html`

Don't publicly share the admin URL/PIN — just the board link.

---

## Running a game night

1. Open the **board URL** on the projector/shared screen. It will show "SETUP" and
   an empty grid while it waits.
2. On your own laptop, open the **admin URL**, enter your PIN.
3. Use **Setup — Place Pieces** to deploy all 24 Blue and 20 Red pieces (the **Start
   Game** button unlocks automatically once both rosters are fully placed).
4. Click **Start Game (Lock Setup)**.
5. For each turn:
   - Pick the relevant **scenario card** for the side that's acting (Blue or Red
     tab in the card list).
   - Click the piece that's moving on the **Tactical Board**, then click an
     adjacent empty cell (simple move) or an adjacent enemy piece (clash).
   - For clashes, review the **attacker win odds**, set or randomize the **roll**,
     and click **Resolve & Apply**. Both pieces are revealed publicly at this point.
   - Click **End Turn** to pass to the other side.
6. The board, detection meter, rosters, and operations log update live for everyone
   watching the projector — no manual refresh needed.
7. When a win condition is hit, both screens show a full win banner automatically.
8. Click **New Game** to reset everything for another round.

---

## Customizing the game

- **Pieces and ranks** — edit `BLUE_PIECES` / `RED_PIECES` in `data/gameData.js`.
  Each side's piece counts must add up to ≤ 24 (3 rows × 8 columns) since that's the
  deployment zone size.
- **Scenario cards** — edit the `SCENARIO_CARDS` array in `data/gameData.js`. Each
  card has a `modifier` (added/subtracted from attacker odds), a `detectionRisk`
  (added to the meter when played), and `adminNotes` shown only to the facilitator.
- **Combat math** — see `resolveClash()` in `js/gameEngine.js` if you want to change
  how rank difference translates into odds, or adjust the special-case rules (like
  the Zero-Day Exploit auto-beating the Firewall).
- **Look and feel** — colors, fonts, and other design tokens are centralized as CSS
  variables at the top of `css/theme.css`.

---

## Troubleshooting

- **Board shows "connecting…" forever / "config error"** — double-check
  `js/firebaseConfig.js` has your real project values, not the `YOUR_API_KEY`
  placeholders, and that your Realtime Database was created (not just the project).
- **Pieces won't place during setup** — you can only place a piece type while it
  still has pieces left in the bank (the counter shows `placed/total`), and only
  inside that side's own deployment rows.
- **"Start Game" stays disabled** — every piece in both full rosters must be placed
  first; the button auto-enables the moment counts match.
- **A piece won't select, or selecting it doesn't highlight anywhere to move it** —
  this is expected for back-row pieces early in the game: just like classic Stratego,
  a piece with friendly pieces on all four adjacent sides has no legal move yet. It
  appears dimmed/hatched on the admin board, and clicking it shows a "Boxed in" hint
  instead of selecting it. Move the pieces in front of it first to open a path. (The
  Critical Server piece never moves at all — that's by design, it's the objective.)
- **Admin and board show different things** — both pages must point at the same
  Firebase project (same `js/firebaseConfig.js` file) and the same `GAME_ID` (set in
  that file, default `"default-room"`). If you want multiple simultaneous games on
  one Firebase project, change `GAME_ID` to something unique per game and deploy
  separate copies, or extend the app to let the admin choose a room.
