/* ============================================================
   CYBER GRID :: FIREBASE CONFIG & STATE WRAPPER
   ------------------------------------------------------------
   1. Replace the firebaseConfig values below with your own
      project's config (see README.md "Firebase Setup").
   2. Both index.html (board) and admin.html (control panel)
      load this file and call FireState.* to read/write the
      single shared game document at /games/{GAME_ID}.
   ============================================================ */

// >>> REPLACE THIS WITH YOUR OWN FIREBASE PROJECT CONFIG <<<
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "YOUR_PROJECT",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

// A fixed game-room id keeps this simple for a single in-person session.
// Change it if you want multiple simultaneous games on one Firebase project.
const GAME_ID = "default-room";

const FireState = (function () {
  let db = null;
  let ready = false;
  let initError = null;

  function init() {
    try {
      if (!window.firebase) {
        throw new Error("Firebase SDK not loaded. Check the <script> tags in your HTML.");
      }
      if (firebaseConfig.apiKey === "YOUR_API_KEY") {
        throw new Error("Firebase is not configured yet. Edit js/firebaseConfig.js with your project's keys.");
      }
      if (!firebase.apps || !firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      db = firebase.database();
      ready = true;
    } catch (err) {
      initError = err;
      console.error("[FireState] init failed:", err.message);
    }
    return ready;
  }

  function gameRef(path = "") {
    if (!db) return null;
    return db.ref(`games/${GAME_ID}${path ? "/" + path : ""}`);
  }

  /** Subscribe to the full game state. Calls cb(state) on every change. */
  function subscribe(cb) {
    if (!ready && !init()) {
      cb(null, initError);
      return () => {};
    }
    const ref = gameRef();
    const handler = (snap) => cb(snap.val(), null);
    ref.on("value", handler);
    return () => ref.off("value", handler);
  }

  /** Replace (merge at root) the game state. */
  function update(partialState) {
    if (!ready && !init()) return Promise.reject(initError);
    return gameRef().update(partialState);
  }

  /** Set the entire state, overwriting everything. Used for full resets. */
  function set(fullState) {
    if (!ready && !init()) return Promise.reject(initError);
    return gameRef().set(fullState);
  }

  /** Push an entry onto the move/event log. */
  function pushLog(entry) {
    if (!ready && !init()) return Promise.reject(initError);
    return gameRef("log").push({ ...entry, ts: Date.now() });
  }

  /** One-time read (no live subscription). */
  function getOnce() {
    if (!ready && !init()) return Promise.reject(initError);
    return gameRef().once("value").then(snap => snap.val());
  }

  function isReady() { return ready; }
  function getInitError() { return initError; }

  return { init, subscribe, update, set, pushLog, getOnce, isReady, getInitError, GAME_ID };
})();
