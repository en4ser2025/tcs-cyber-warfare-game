/* ============================================================
   CYBER GRID :: BOARD (public display) LOGIC
   ============================================================ */

(function () {
  let spriteLoaded = false;
  let lastLogIds = new Set();

  // ---- Load the SVG sprite sheet once ----
  fetch("assets/icons/sprite.svg")
    .then(r => r.text())
    .then(svg => {
      document.getElementById("sprite-mount").innerHTML = svg;
      spriteLoaded = true;
    })
    .catch(err => console.error("Failed to load icon sprite:", err));

  // ---- Build the 64-cell grid skeleton once ----
  const boardEl = document.getElementById("board");
  function buildBoardSkeleton() {
    boardEl.innerHTML = "";
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = document.createElement("div");
        const zone = zoneForRow(row);
        cell.className = `cell zone-${zone}`;
        cell.dataset.row = row;
        cell.dataset.col = col;
        cell.id = `cell-${row}-${col}`;
        const coord = document.createElement("div");
        coord.className = "cell-coord";
        coord.textContent = cellKey(row, col);
        cell.appendChild(coord);
        boardEl.appendChild(cell);
      }
    }
  }
  buildBoardSkeleton();

  function pieceIcon(pieceId) {
    const def = GameEngine.findPieceDef(pieceId);
    return def ? def.icon : "shield";
  }
  function pieceDef(pieceId) { return GameEngine.findPieceDef(pieceId); }

  // ---- Render board pieces from state ----
  function renderBoard(state) {
    // clear existing pieces
    document.querySelectorAll(".cell .piece").forEach(p => p.remove());

    const board = state.board || {};
    Object.entries(board).forEach(([key, unit]) => {
      if (!unit || unit.eliminated) return;
      const { row, col } = parseCellKey(key);
      const cellEl = document.getElementById(`cell-${row}-${col}`);
      if (!cellEl) return;

      const def = pieceDef(unit.pieceId);
      const piece = document.createElement("div");
      const isObjective = def?.isObjective;

      if (unit.revealed) {
        piece.className = `piece ${unit.side}${isObjective ? " objective" : ""}`;
        piece.innerHTML = `<svg><use href="#icon-${def?.icon || "shield"}"></use></svg>`;
        const tag = document.createElement("div");
        tag.className = "piece-rank-tag";
        tag.textContent = def?.short || "?";
        piece.appendChild(tag);
      } else {
        piece.className = `piece hidden ${unit.side}-side`;
        piece.innerHTML = `<svg><use href="#icon-locked"></use></svg>`;
      }
      cellEl.appendChild(piece);
    });
  }

  // ---- Render rosters (remaining counts per piece type) ----
  function renderRoster(state, side, containerId) {
    const roster = side === "blue" ? BLUE_PIECES : RED_PIECES;
    const eliminated = (state.eliminated && state.eliminated[side]) || {};
    const remaining = {};
    roster.forEach(p => remaining[p.id] = p.count - (eliminated[p.id] || 0));

    const container = document.getElementById(containerId);
    container.innerHTML = "";
    roster.forEach(p => {
      const row = document.createElement("div");
      const left = remaining[p.id];
      row.className = "roster-row" + (left === 0 ? " depleted" : "");
      row.innerHTML = `
        <svg><use href="#icon-${p.icon}"></use></svg>
        <span>${p.name}</span>
        <span class="count">${left}/${p.count}</span>
      `;
      container.appendChild(row);
    });
  }

  // ---- Detection meter ----
  function renderDetection(state) {
    const pct = Math.max(0, Math.min(100, state.detectionMeter || 0));
    document.getElementById("detection-fill").style.width = pct + "%";
    document.getElementById("detection-pct").textContent = pct + "%";
  }

  // ---- Phase / turn pills ----
  function renderStatus(state) {
    const phaseText = document.getElementById("phase-text");
    const turnPill = document.getElementById("turn-pill");
    const turnText = document.getElementById("turn-text");

    phaseText.textContent = (state.phase || "setup").toUpperCase();

    if (state.phase === "playing") {
      turnPill.className = `pill pill-${state.turn}`;
      turnText.textContent = `${(state.turn || "blue").toUpperCase()} TURN \u00b7 #${state.turnNumber || 1}`;
    } else if (state.phase === "ended") {
      turnPill.className = "pill";
      turnText.textContent = "GAME OVER";
    } else {
      turnPill.className = "pill";
      turnText.textContent = "AWAITING SETUP";
    }
  }

  // ---- Active scenario banner ----
  function renderActiveScenario(state) {
    const banner = document.getElementById("now-playing-banner");
    const s = state.activeScenario;
    if (!s) { banner.style.display = "none"; return; }
    const card = SCENARIO_CARDS.find(c => c.id === s.cardId);
    if (!card) { banner.style.display = "none"; return; }
    banner.style.display = "flex";
    const sideEl = document.getElementById("now-playing-side");
    sideEl.className = `pill pill-${s.side}`;
    sideEl.innerHTML = `<span class="pill-dot"></span>${s.side.toUpperCase()}`;
    document.getElementById("now-playing-name").textContent = card.name;
    document.getElementById("now-playing-desc").textContent = card.description;
  }

  // ---- Log feed ----
  function renderLog(state) {
    const log = state.log || {};
    const feed = document.getElementById("log-feed");
    const entries = Object.entries(log).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));

    entries.forEach(([id, entry]) => {
      if (lastLogIds.has(id)) return;
      lastLogIds.add(id);
      const div = document.createElement("div");
      div.className = `log-entry ${entry.side || ""}`;
      const time = new Date(entry.ts || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      div.innerHTML = `<span class="ts">${time}</span>${escapeHtml(entry.text || "")}`;
      feed.prepend(div);
    });

    // cap displayed entries for performance
    while (feed.children.length > 60) feed.removeChild(feed.lastChild);
  }

  function escapeHtml(str) {
    const d = document.createElement("div");
    d.textContent = str;
    return d.innerHTML;
  }

  // ---- Win overlay ----
  function renderWin(state) {
    const overlay = document.getElementById("win-overlay");
    if (!state.winner) { overlay.style.display = "none"; return; }
    overlay.style.display = "flex";
    const card = document.getElementById("win-card");
    card.className = `panel win-card ${state.winner}-win`;
    document.getElementById("win-title").textContent =
      state.winner === "blue" ? "DEFENDERS WIN" : "ATTACKERS WIN";
    document.getElementById("win-reason").textContent = state.winReason || "";
  }

  // ---- Connection indicator ----
  function setConnStatus(online) {
    const dot = document.getElementById("conn-dot");
    const text = document.getElementById("conn-text");
    dot.className = "conn-dot " + (online ? "online" : "offline");
    text.textContent = online ? "live" : "disconnected";
  }

  // ---- Main render dispatch ----
  function renderAll(state) {
    if (!state) return;
    renderBoard(state);
    renderRoster(state, "blue", "blue-roster");
    renderRoster(state, "red", "red-roster");
    renderDetection(state);
    renderStatus(state);
    renderActiveScenario(state);
    renderLog(state);
    renderWin(state);
  }

  // ---- Boot ----
  function boot() {
    setConnStatus(false);
    FireState.subscribe((state, err) => {
      if (err) {
        setConnStatus(false);
        document.getElementById("conn-text").textContent = "config error \u2014 see console";
        console.error(err);
        return;
      }
      setConnStatus(true);
      if (!state) return; // empty room, waiting for admin to initialize
      renderAll(state);
    });
  }

  // Wait a tick for sprite fetch to at least be in-flight before first render
  document.addEventListener("DOMContentLoaded", boot);
})();
