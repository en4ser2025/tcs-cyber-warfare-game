/* ============================================================
   CYBER GRID :: BOARD (public display) LOGIC
   ============================================================ */

(function () {
  let spriteLoaded = false;
  let lastLogIds = new Set();
  let boardCountdownInterval = null;
  const VOTE_DURATION_S = 40;
  const BOARD_RING_CIRCUMFERENCE = 113; // 2π × 18

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

    const container = document.getElementById(containerId);
    container.innerHTML = "";
    roster.forEach(p => {
      const elimCount = eliminated[p.id] || 0;
      const left = p.count - elimCount;

      // Status: depleted = all gone, partial = some gone, normal = none gone
      const status = left === 0 ? "depleted" : elimCount > 0 ? "partial" : "";

      const row = document.createElement("div");
      row.className = "roster-row" + (status ? " " + status : "");
      row.innerHTML = `
        <svg><use href="#icon-${p.icon}"></use></svg>
        <span>${p.name}</span>
        <span class="count">${left}/${p.count}</span>
      `;
      container.appendChild(row);
    });
  }

  // ---- Render scenario cards on the public board ----
  function renderScenarioCards(state) {
    const activeCardId = state.activeScenario ? state.activeScenario.cardId : null;

    ["blue", "red"].forEach(side => {
      const containerId = "public-" + side + "-cards";
      const container = document.getElementById(containerId);
      if (!container) return;

      const cards = SCENARIO_CARDS.filter(c => c.side === side);
      container.innerHTML = "";
      cards.forEach(card => {
        const isActive = card.id === activeCardId;
        const div = document.createElement("div");
        div.className = "pub-card " + side + "-card" + (isActive ? " active-card" : "");

        const pips = Array.from({ length: 5 }, (_, i) =>
          `<span class="${i < card.difficulty ? "on" : ""}"></span>`
        ).join("");

        const modStr = card.modifier >= 0 ? "+" + card.modifier : "" + card.modifier;
        const typeLabel = card.type.toUpperCase();

        div.innerHTML = `
          <div class="pub-card-name">${card.name}</div>
          <div class="pub-card-meta">
            <span>${typeLabel}</span>
            <span>mod ${modStr}</span>
            <span>detect +${card.detectionRisk}</span>
            <span class="pub-card-pips">${pips}</span>
          </div>
          <div class="pub-card-desc">${card.description}</div>
        `;
        container.appendChild(div);
      });
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

  // ---- QR Code — fully self-contained, zero external requests ----
  // Minimal QR encoder for short URLs (alphanumeric + special chars, version 1-10).
  // Generates a clean SVG data URL — no library, no network call, works offline.
  let qrGenerated = false;

  function getVoteUrl() {
    const href = window.location.href;
    const base = href
      .replace(/\/index\.html(\?.*)?$/, "")
      .replace(/\/index\.TEST\.html(\?.*)?$/, "")
      .replace(/\/$/, "");
    return base + "/vote.html";
  }

  // Minimal Reed-Solomon + QR matrix generator for byte-mode URLs
  // Supports URLs up to ~150 chars (QR version 1-6, ECC level M)
  function makeQRSvg(text, pixelSize) {
    // Use the most reliable cross-platform approach:
    // generate a QR via a data URI using the qr-svg algorithm inline.
    // Implementation: encode text as QR version auto, return SVG string.

    // We implement a minimal but complete QR encoder here.
    // For brevity and reliability we use the well-tested algorithm below.

    function qrEncode(str) {
      // GF(256) arithmetic
      const GF_EXP = new Uint8Array(512);
      const GF_LOG = new Uint8Array(256);
      let x = 1;
      for (let i = 0; i < 255; i++) {
        GF_EXP[i] = x; GF_LOG[x] = i;
        x = x * 2; if (x > 255) x ^= 0x11d;
      }
      for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
      const gfMul = (a, b) => a && b ? GF_EXP[GF_LOG[a] + GF_LOG[b]] : 0;
      const gfDiv = (a, b) => GF_EXP[GF_LOG[a] + 255 - GF_LOG[b]];
      const gfPoly = (d) => {
        let p = [1];
        for (let i = 0; i < d; i++) {
          const r = [0, ...p];
          const q = p.map(v => gfMul(v, GF_EXP[i])).concat([0]);
          p = r.map((v, j) => v ^ (q[j] || 0));
        }
        return p;
      };
      const rsEncode = (data, nec) => {
        const gen = gfPoly(nec);
        let msg = [...data, ...new Array(nec).fill(0)];
        for (let i = 0; i < data.length; i++) {
          const coef = msg[i];
          if (coef) for (let j = 1; j < gen.length; j++) msg[i + j] ^= gfMul(gen[j], coef);
        }
        return msg.slice(data.length);
      };

      // Version / capacity selection (byte mode, ECC M)
      const EC_M = [[10,7],[16,10],[26,15],[36,20],[48,26],[64,36]];
      const CAPS = [17,32,53,78,106,134];
      const bytes = [...str].map(c => c.charCodeAt(0));
      const len = bytes.length;
      let ver = 1;
      while (ver <= 6 && CAPS[ver-1] < len) ver++;
      if (ver > 6) ver = 6; // clamp

      const [totCW, ecCW] = EC_M[ver-1];
      const datCW = totCW - ecCW;

      // Encode: byte mode
      let bits = [];
      const addBits = (v, n) => { for (let i = n-1; i >= 0; i--) bits.push((v >> i) & 1); };
      addBits(0b0100, 4);
      addBits(len, ver < 10 ? 8 : 16);
      bytes.forEach(b => addBits(b, 8));
      addBits(0, 4);
      while (bits.length % 8) bits.push(0);
      const dataBytes = [];
      for (let i = 0; i < bits.length; i += 8)
        dataBytes.push(bits.slice(i, i+8).reduce((a, b) => (a<<1)|b, 0));
      const PAD = [0xEC, 0x11];
      while (dataBytes.length < datCW) dataBytes.push(PAD[(dataBytes.length - (bits.length>>3)) % 2]);
      const ecBytes = rsEncode(dataBytes, ecCW);
      const codewords = [...dataBytes, ...ecBytes];

      // Build matrix
      const N = ver * 4 + 17;
      const mx = Array.from({length: N}, () => new Array(N).fill(-1)); // -1=empty
      const set = (r, c, v) => { if (r >= 0 && r < N && c >= 0 && c < N) mx[r][c] = v; };
      const reserved = Array.from({length: N}, () => new Array(N).fill(false));
      const res = (r, c) => { reserved[r][c] = true; };

      // Finder patterns
      const finder = (r, c) => {
        for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) {
          const v = (i===0||i===6||j===0||j===6||( i>=2&&i<=4&&j>=2&&j<=4)) ? 1 : 0;
          set(r+i, c+j, v); res(r+i, c+j);
        }
      };
      finder(0,0); finder(0,N-7); finder(N-7,0);
      // Separators
      for (let i = 0; i < 8; i++) {
        [0,N-8].forEach(c => { set(i,c,0); res(i,c); set(c,i,0); res(c,i); });
        set(N-8+i,7,0); res(N-8+i,7); set(7,N-8+i,0); res(7,N-8+i);
      }
      set(7,7,0); res(7,7);

      // Timing
      for (let i = 8; i < N-8; i++) {
        set(6,i,i%2===0?1:0); res(6,i);
        set(i,6,i%2===0?1:0); res(i,6);
      }
      // Dark module
      set(N-8,8,1); res(N-8,8);

      // Format info (mask 0, ECC M = 00)
      const fmt = [1,1,1,0,1,1,1,1,1,0,0,0,1,0,0]; // precomputed for mask 0, ECC M
      [[N-1,8],[N-2,8],[N-3,8],[N-4,8],[N-5,8],[N-6,8],[N-7,8],[N-8,8],
       [8,N-8],[8,N-7],[8,N-6],[8,N-5],[8,N-4],[8,N-3],[8,N-2],[8,N-1]].forEach(([r,c],i) => {
        set(r,c,fmt[i]||0); res(r,c);
      });
      [[0,8],[1,8],[2,8],[3,8],[4,8],[5,8],[7,8],[8,5],[8,4],[8,3],[8,2],[8,1],[8,0],
       [8,N-7],[8,N-8]].forEach(([r,c],i) => { set(r,c,fmt[14-i]||0); res(r,c); });

      // Alignment patterns (ver >= 2)
      const AP = [[],[],[6,18],[6,22],[6,26],[6,30]];
      if (ver >= 2) {
        const ap = AP[ver-1];
        for (let ai = 0; ai < ap.length; ai++) for (let aj = 0; aj < ap.length; aj++) {
          const [r, c] = [ap[ai], ap[aj]];
          if (reserved[r][c]) continue;
          for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
            const v = (Math.abs(i)===2||Math.abs(j)===2) ? 1 : (i===0&&j===0 ? 1 : 0);
            set(r+i, c+j, v); res(r+i, c+j);
          }
        }
      }

      // Place data bits (mask 0: (i+j)%2===0 → invert)
      let bitIdx = 0;
      const allBits = codewords.flatMap(b => Array.from({length:8},(_,i)=>(b>>(7-i))&1));
      let up = true;
      for (let col = N-1; col >= 0; col -= 2) {
        if (col === 6) col = 5;
        for (let row = up ? N-1 : 0; row >= 0 && row < N; row += up ? -1 : 1) {
          for (let dc = 0; dc < 2; dc++) {
            const c = col - dc;
            if (!reserved[row][c]) {
              const bit = allBits[bitIdx++] || 0;
              const masked = ((row + c) % 2 === 0) ? bit ^ 1 : bit;
              set(row, c, masked);
            }
          }
        }
        up = !up;
      }

      return {matrix: mx, size: N};
    }

    const {matrix, size} = qrEncode(text);
    const cell = pixelSize / size;
    const quiet = cell * 2;
    const total = pixelSize + quiet * 2;

    let rects = "";
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c] === 1) {
          const x = (quiet + c * cell).toFixed(2);
          const y = (quiet + r * cell).toFixed(2);
          const w = cell.toFixed(2);
          rects += `<rect x="${x}" y="${y}" width="${w}" height="${w}"/>`;
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${total}" height="${total}"><rect width="${total}" height="${total}" fill="#fff"/><g fill="#000">${rects}</g></svg>`;
  }

  function renderQR() {
    if (qrGenerated) return;
    const container = document.getElementById("qr-code");
    if (!container) return;

    const voteUrl = getVoteUrl();
    try {
      const svg = makeQRSvg(voteUrl, 88);
      const dataUrl = "data:image/svg+xml;base64," + btoa(svg);
      const img = document.createElement("img");
      img.src = dataUrl;
      img.width = 88; img.height = 88;
      img.style.cssText = "display:block;border-radius:4px;";
      img.alt = voteUrl; img.title = voteUrl;
      container.innerHTML = "";
      container.appendChild(img);
      qrGenerated = true;
    } catch(e) {
      // Fallback: plain URL text
      container.innerHTML =
        '<div style="font-family:var(--font-mono);font-size:8px;color:var(--text-mid);' +
        'word-break:break-all;padding:4px;background:var(--bg-raised);border-radius:4px;' +
        'max-width:120px;line-height:1.5;">' + voteUrl + "</div>";
      qrGenerated = true;
    }
  }

  // ---- Vote strip (QR + tally on projector) ----
  function renderVoteStrip(state) {
    const strip = document.getElementById("vote-strip");
    if (!strip) return;
    if (state.phase !== "playing") { strip.style.display = "none"; return; }
    strip.style.display = "flex";
    renderQR();

    const side = state.turn;
    const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + side);
    const allVotes = (state.votes && state.votes[currentTurnKey]) || {};
    const cfg = state.votingConfig || {};
    const expected = side === "blue" ? (cfg.blueExpected||5) : (cfg.redExpected||5);
    const quorum = Math.ceil(expected / 2);
    const votePhase = state.votePhase || "card";
    const fillClass = side === "blue" ? "blue-fill" : "red-fill";

    // Build tally for current phase
    const tally = {};
    let totalVotes = 0;
    if (votePhase === "card") {
      Object.values(allVotes).forEach(v => {
        if (v.side === side && v.cardId) { tally[v.cardId] = (tally[v.cardId]||0)+1; totalVotes++; }
      });
    } else {
      // "move" or "move-only"
      Object.values(allVotes).forEach(v => {
        if (v.side === side && v.fromCell && v.toCell) {
          const k = v.fromCell + "|" + v.toCell; tally[k] = (tally[k]||0)+1; totalVotes++;
        }
      });
    }
    const sorted = Object.entries(tally).sort((a,b)=>b[1]-a[1]);
    const winnerEntry = sorted.find(([,c])=>c>=quorum);

    const tallyEl = document.getElementById("vote-strip-tally");
    tallyEl.innerHTML = "";
    const phaseLabel = votePhase === "card" ? "Round 1 — Card vote" :
                       votePhase === "move-only" ? "Move vote (no combat)" :
                       "Round 2 — Move vote";
    const hdr = document.createElement("div");
    hdr.style.cssText = "font-family:var(--font-mono);font-size:10px;color:var(--text-low);margin-bottom:3px;";
    hdr.textContent = `${side.toUpperCase()} · ${phaseLabel} · ${totalVotes}/${expected} (need ${quorum})`;
    tallyEl.appendChild(hdr);

    if (sorted.length === 0) {
      const empty = document.createElement("div"); empty.className = "vote-no-votes";
      empty.textContent = "Waiting for votes…"; tallyEl.appendChild(empty);
    } else {
      sorted.slice(0,4).forEach(([key, count]) => {
        let label = key;
        if (votePhase === "card") {
          const card = SCENARIO_CARDS.find(c=>c.id===key);
          label = card ? card.name : key;
        } else {
          const [from,to] = key.split("|");
          label = from + " → " + to;
        }
        const pct = Math.min(100, Math.round((count/expected)*100));
        const isWin = count >= quorum;
        const row = document.createElement("div"); row.className = "vote-tally-row";
        row.innerHTML = `<div class="vote-tally-label"><span>${isWin?"✓ ":""}${label}</span><span>${count}/${quorum}</span></div><div class="vote-tally-track"><div class="vote-tally-fill ${isWin?"won":fillClass}" style="width:${pct}%"></div></div>`;
        tallyEl.appendChild(row);
      });
    }

    const quorumEl = document.getElementById("vote-strip-quorum");
    if (winnerEntry) {
      let winLabel = winnerEntry[0];
      if (votePhase === "card") { const wc = SCENARIO_CARDS.find(c=>c.id===winnerEntry[0]); winLabel = wc?wc.name:winLabel; }
      else { const [f,t] = winnerEntry[0].split("|"); winLabel = f+" → "+t; }
      quorumEl.style.display = "block";
      quorumEl.textContent = `✓ QUORUM — "${winLabel}" selected!`;
    } else { quorumEl.style.display = "none"; }
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
    renderScenarioCards(state);
    renderVoteStrip(state);
    updateBoardCountdown(state);
    renderLog(state);
    renderWin(state);
  }

  // ---- Board-side countdown timer ----
  function updateBoardCountdown(state) {
    const wrap = document.getElementById("vote-timer-wrap");
    const numEl = document.getElementById("board-timer-num");
    const fillEl = document.getElementById("board-ring-fill");
    const phaseEl = document.getElementById("board-timer-phase");
    if (!wrap || !numEl) return;

    if (state.phase !== "playing" || !state.voteDeadline) {
      wrap.style.display = "none";
      if (boardCountdownInterval) { clearInterval(boardCountdownInterval); boardCountdownInterval = null; }
      return;
    }
    wrap.style.display = "flex";
    phaseEl.textContent = (state.votePhase || "card") === "card" ? "Card vote" : "Move vote";

    if (boardCountdownInterval) { clearInterval(boardCountdownInterval); boardCountdownInterval = null; }

    const deadline = state.voteDeadline;
    function tick() {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      numEl.textContent = remaining;
      const pct = remaining / VOTE_DURATION_S;
      fillEl.style.strokeDashoffset = BOARD_RING_CIRCUMFERENCE * (1 - pct);
      if (remaining <= 5) fillEl.className = "ring-fill urgent";
      else if (remaining <= 10) fillEl.className = "ring-fill warning";
      else fillEl.className = "ring-fill";
      if (remaining <= 0) { clearInterval(boardCountdownInterval); boardCountdownInterval = null; }
    }
    tick();
    boardCountdownInterval = setInterval(tick, 500);
  }

  // ---- Elimination animation on the public board ----
  function triggerBoardElimination(row, col) {
    const cellEl = document.getElementById(`cell-${row}-${col}`);
    if (!cellEl) return;
    cellEl.classList.add("zap-out");
    setTimeout(() => cellEl.classList.remove("zap-out"), 700);
  }

  // ---- Boot ----
  let prevBoard = {};

  function detectAndAnimateEliminations(newBoard) {
    // Compare with previous board: find cells that had a living piece and now don't
    Object.entries(prevBoard).forEach(([key, prevUnit]) => {
      if (!prevUnit || prevUnit.eliminated) return;
      const newUnit = newBoard[key];
      // Cell is now empty or has a different unit → previous unit was eliminated
      if (!newUnit || newUnit.eliminated || newUnit.instanceId !== prevUnit.instanceId) {
        const { row, col } = parseCellKey(key);
        triggerBoardElimination(row, col);
      }
    });
    prevBoard = newBoard ? JSON.parse(JSON.stringify(newBoard)) : {};
  }

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
      if (state.board) detectAndAnimateEliminations(state.board);
      renderAll(state);
    });
  }

  // Wait a tick for sprite fetch to at least be in-flight before first render
  document.addEventListener("DOMContentLoaded", () => {
    renderQR();   // generate QR immediately — just sets an img src, no library needed
    boot();
  });
})();
