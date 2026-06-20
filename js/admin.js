/* ============================================================
   CYBER GRID :: ADMIN LOGIC
   ============================================================ */

(function () {
  // ---------------- PIN GATE ----------------
  const pinGate = document.getElementById("pin-gate");
  const adminApp = document.getElementById("admin-app");
  const pinInput = document.getElementById("pin-input");
  const pinError = document.getElementById("pin-error");

  function tryUnlock() {
    if (pinInput.value === ADMIN_PIN) {
      pinGate.style.display = "none";
      adminApp.style.display = "flex";
      bootAdmin();
    } else {
      pinError.textContent = "Incorrect PIN.";
      pinInput.value = "";
      pinInput.focus();
    }
  }
  document.getElementById("pin-submit").addEventListener("click", tryUnlock);
  pinInput.addEventListener("keydown", e => { if (e.key === "Enter") tryUnlock(); });
  document.getElementById("lock-btn").addEventListener("click", () => {
    adminApp.style.display = "none";
    pinGate.style.display = "flex";
    pinInput.value = "";
    pinInput.focus();
  });

  // ---------------- ADMIN APP STATE (local + mirrored from Firebase) ----------------
  let state = null;             // last known shared game state
  let setupSide = "blue";       // which bank is showing during setup
  let setupSelectedPieceId = null;
  let cardFilterSide = "blue";
  let selectedCardId = null;
  let selectedCell = null;      // currently selected piece's cell during play
  let pendingMove = null;       // { fromCell, toCell, type: 'move'|'clash' }
  let bootStarted = false;

  fetch("assets/icons/sprite.svg")
    .then(r => r.text())
    .then(svg => { document.getElementById("sprite-mount").innerHTML = svg; })
    .catch(err => console.error("sprite load failed", err));

  function bootAdmin() {
    if (bootStarted) return;
    bootStarted = true;
    buildAdminBoardSkeleton();
    setupSideToggle("blue");
    cardFilterToggle("blue");
    wireToolbar();
    wireDetectionControls();
    wireResolvePanel();

    FireState.subscribe((s, err) => {
      if (err) {
        setConn(false);
        console.error(err);
        return;
      }
      setConn(true);
      if (!s) {
        // empty room — initialize fresh state automatically
        state = buildEmptyState();
        FireState.set(state);
        return;
      }
      state = s;
      if (!state.board) state.board = {};
      renderEverything();
    });
  }

  function setConn(online) {
    const dot = document.getElementById("conn-dot");
    const text = document.getElementById("conn-text");
    dot.className = "conn-dot " + (online ? "online" : "offline");
    text.textContent = online ? "live" : "disconnected / not configured";
  }

  // ---------------- TOOLBAR ----------------
  function wireToolbar() {
    document.getElementById("new-game-btn").addEventListener("click", () => {
      confirmAction(
        "Start a brand new game?",
        "This clears the board, log, and detection meter. Both teams will need to re-deploy.",
        () => {
          state = buildEmptyState();
          FireState.set(state);
          selectedCell = null; setupSelectedPieceId = null;
        }
      );
    });

    document.getElementById("reset-game-btn").addEventListener("click", () => {
      confirmAction(
        "Reset the board?",
        "This clears all placed pieces but keeps you in setup phase.",
        () => {
          state.board = {};
          state.phase = "setup";
          state.winner = null; state.winReason = null;
          state.detectionMeter = 0;
          FireState.set(state);
        }
      );
    });

    document.getElementById("start-game-btn").addEventListener("click", () => {
      state.phase = "playing";
      state.turn = "blue";
      state.turnNumber = 1;
      logEvent("system", "Setup complete. The simulation begins — Blue moves first.");
      FireState.update({ phase: "playing", turn: "blue", turnNumber: 1 });
    });

    document.getElementById("end-turn-btn").addEventListener("click", () => {
      const next = state.turn === "blue" ? "red" : "blue";
      const nextTurnNumber = next === "blue" ? (state.turnNumber || 1) + 1 : state.turnNumber || 1;
      selectedCell = null; selectedCardId = null;
      FireState.update({ turn: next, turnNumber: nextTurnNumber, activeScenario: null });
    });
  }

  function confirmAction(title, body, onConfirm) {
    const modal = document.getElementById("confirm-modal");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-body").textContent = body;
    modal.style.display = "flex";
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    function cleanup() { modal.style.display = "none"; okBtn.removeEventListener("click", onOk); cancelBtn.removeEventListener("click", onCancel); }
    function onOk() { cleanup(); onConfirm(); }
    function onCancel() { cleanup(); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
  }

  // ---------------- SETUP: PIECE BANK ----------------
  function setupSideToggle(side) {
    setupSide = side;
    setupSelectedPieceId = null;
    document.getElementById("setup-side-blue").classList.toggle("btn-ghost", side !== "blue");
    document.getElementById("setup-side-red").classList.toggle("btn-ghost", side !== "red");
    renderSetupBank();
  }
  document.getElementById("setup-side-blue").addEventListener("click", () => setupSideToggle("blue"));
  document.getElementById("setup-side-red").addEventListener("click", () => setupSideToggle("red"));
  document.getElementById("setup-clear-selection").addEventListener("click", () => {
    setupSelectedPieceId = null;
    renderSetupBank();
  });

  function placedCountFor(side, pieceId) {
    if (!state || !state.board) return 0;
    return Object.values(state.board).filter(u => u && u.side === side && u.pieceId === pieceId && !u.eliminated).length;
  }

  function renderSetupBank() {
    const roster = setupSide === "blue" ? BLUE_PIECES : RED_PIECES;
    const bank = document.getElementById("setup-bank");
    bank.innerHTML = "";
    roster.forEach(p => {
      const used = placedCountFor(setupSide, p.id);
      const left = p.count - used;
      const btn = document.createElement("div");
      btn.className = "setup-piece-btn" + (setupSelectedPieceId === p.id ? " selected" : "");
      btn.style.opacity = left <= 0 ? 0.35 : 1;
      btn.innerHTML = `<svg><use href="#icon-${p.icon}"></use></svg><span>${p.short}</span><span class="left">${left}/${p.count}</span>`;
      btn.addEventListener("click", () => {
        if (left <= 0) return;
        // Keep the piece selected on repeat clicks so the facilitator can place
        // several of the same type in a row without re-selecting each time.
        setupSelectedPieceId = p.id;
        renderSetupBank();
      });
      bank.appendChild(btn);
    });
  }

  // ---------------- ADMIN BOARD ----------------
  function buildAdminBoardSkeleton() {
    const boardEl = document.getElementById("admin-board");
    boardEl.innerHTML = "";
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const cell = document.createElement("div");
        cell.className = "admin-cell";
        cell.dataset.row = row; cell.dataset.col = col;
        cell.id = `admin-cell-${row}-${col}`;
        const coord = document.createElement("div");
        coord.className = "cell-coord-admin";
        coord.textContent = cellKey(row, col);
        cell.appendChild(coord);
        cell.addEventListener("click", () => onCellClick(row, col));
        boardEl.appendChild(cell);
      }
    }
  }

  function onCellClick(row, col) {
    if (!state) return;
    const key = cellKey(row, col);

    // ----- SETUP PHASE: place pieces -----
    if (state.phase === "setup") {
      if (!setupSelectedPieceId) return;
      const zone = zoneForRow(row);
      if (zone !== setupSide) {
        flashHint(`${setupSide === "blue" ? "Blue" : "Red"} can only deploy in their own rows.`);
        return;
      }
      if (state.board[key]) {
        flashHint("That cell is already occupied.");
        return;
      }
      const usedCount = placedCountFor(setupSide, setupSelectedPieceId);
      const instanceId = `${setupSide}-${setupSelectedPieceId}-${usedCount + 1}`;
      state.board[key] = {
        side: setupSide,
        pieceId: setupSelectedPieceId,
        instanceId,
        revealed: false,
        eliminated: false
      };
      FireState.update({ board: state.board });
      renderSetupBank();
      checkSetupComplete();
      return;
    }

    // ----- PLAYING PHASE: select / move / clash -----
    if (state.phase === "playing") {
      const unit = state.board[key];

      if (!selectedCell) {
        // selecting a piece to move — must belong to current turn's side
        if (!unit) return;
        if (unit.side !== state.turn) {
          flashHint(`It's ${state.turn.toUpperCase()}'s turn.`);
          return;
        }
        const def = GameEngine.findPieceDef(unit.pieceId);
        if (def && def.movable === false) {
          flashHint("This piece cannot move.");
          return;
        }
        selectedCell = key;
        renderAdminBoard();
        return;
      }

      // a piece is already selected
      if (key === selectedCell) {
        selectedCell = null;
        renderAdminBoard();
        return;
      }

      const fromUnit = state.board[selectedCell];
      const targetUnit = state.board[key];

      if (!isAdjacent(selectedCell, key)) {
        flashHint("Pieces move one square (orthogonal) per turn.");
        return;
      }

      if (!targetUnit) {
        // simple move
        pendingMove = { fromCell: selectedCell, toCell: key, type: "move" };
        completeSimpleMove();
        return;
      }

      if (targetUnit.side === fromUnit.side) {
        flashHint("Can't move onto your own piece.");
        return;
      }

      // clash setup — open the resolve panel
      pendingMove = { fromCell: selectedCell, toCell: key, type: "clash" };
      openResolvePanel();
    }
  }

  function isAdjacent(keyA, keyB) {
    const a = parseCellKey(keyA), b = parseCellKey(keyB);
    const dr = Math.abs(a.row - b.row), dc = Math.abs(a.col - b.col);
    return (dr + dc) === 1;
  }

  function completeSimpleMove() {
    const { fromCell, toCell } = pendingMove;
    const unit = state.board[fromCell];
    const boardCopy = { ...state.board };
    boardCopy[toCell] = unit;
    delete boardCopy[fromCell];
    state.board = boardCopy;
    logEvent(unit.side, `${pieceLabel(unit)} advances to ${toCell}.`);
    FireState.update({ board: boardCopy });
    selectedCell = null;
    pendingMove = null;
    renderAdminBoard();
  }

  function pieceLabel(unit) {
    const def = GameEngine.findPieceDef(unit.pieceId);
    return unit.revealed ? (def?.name || unit.pieceId) : `Unidentified ${unit.side === "blue" ? "defender" : "threat actor"} unit`;
  }

  function checkSetupComplete() {
    const blueDone = BLUE_PIECES.every(p => placedCountFor("blue", p.id) === p.count);
    const redDone = RED_PIECES.every(p => placedCountFor("red", p.id) === p.count);
    document.getElementById("start-game-btn").disabled = !(blueDone && redDone);
  }

  function flashHint(msg) {
    const hint = document.getElementById("board-hint");
    const old = hint.textContent;
    hint.textContent = msg;
    hint.style.color = "var(--amber)";
    setTimeout(() => { hint.textContent = old; hint.style.color = ""; }, 2200);
  }

  // ---------------- RENDERING ----------------
  function renderEverything() {
    renderAdminBoard();
    renderRosterAdmin();
    renderDetection();
    renderCardList();
    renderAdminLog();
    renderPhaseUI();
  }

  function renderAdminBoard() {
    document.querySelectorAll(".admin-cell").forEach(c => {
      c.classList.remove("selected", "target-valid", "target-clash");
      const existing = c.querySelector(".admin-piece");
      if (existing) existing.remove();
    });

    const board = (state && state.board) || {};
    Object.entries(board).forEach(([key, unit]) => {
      if (!unit || unit.eliminated) return;
      const { row, col } = parseCellKey(key);
      const cellEl = document.getElementById(`admin-cell-${row}-${col}`);
      if (!cellEl) return;
      const def = GameEngine.findPieceDef(unit.pieceId);
      const piece = document.createElement("div");
      piece.className = `admin-piece ${unit.side}`;
      piece.innerHTML = `<svg><use href="#icon-${def?.icon || "shield"}"></use></svg><span class="rank-badge">${def?.short || "?"}</span>`;
      cellEl.appendChild(piece);
    });

    if (selectedCell && state.board[selectedCell]) {
      const { row, col } = parseCellKey(selectedCell);
      document.getElementById(`admin-cell-${row}-${col}`)?.classList.add("selected");
      // highlight adjacent cells
      [[row-1,col],[row+1,col],[row,col-1],[row,col+1]].forEach(([r,c]) => {
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) return;
        const k = cellKey(r,c);
        const targetCellEl = document.getElementById(`admin-cell-${r}-${c}`);
        if (!targetCellEl) return;
        const occ = board[k];
        if (!occ) targetCellEl.classList.add("target-valid");
        else if (occ.side !== state.board[selectedCell].side) targetCellEl.classList.add("target-clash");
      });
    }
  }

  function renderRosterAdmin() {
    ["blue", "red"].forEach(side => {
      const roster = side === "blue" ? BLUE_PIECES : RED_PIECES;
      const container = document.getElementById(`${side}-roster-admin`);
      container.innerHTML = roster.map(p => {
        const left = p.count - eliminatedCountFor(side, p.id);
        return `<div style="display:flex;justify-content:space-between;padding:2px 0;${left===0?"opacity:.35;text-decoration:line-through;":""}"><span>${p.short} &middot; ${p.name}</span><span>${left}/${p.count}</span></div>`;
      }).join("");
    });
  }

  function eliminatedCountFor(side, pieceId) {
    if (!state) return 0;
    if (state.phase === "setup") return 0;
    return (state.eliminated && state.eliminated[side] && state.eliminated[side][pieceId]) || 0;
  }

  function bumpEliminated(side, pieceId) {
    state.eliminated = state.eliminated || { blue: {}, red: {} };
    state.eliminated[side] = state.eliminated[side] || {};
    state.eliminated[side][pieceId] = (state.eliminated[side][pieceId] || 0) + 1;
  }

  function renderDetection() {
    const pct = Math.max(0, Math.min(100, (state && state.detectionMeter) || 0));
    document.getElementById("detection-fill").style.width = pct + "%";
    document.getElementById("detection-pct").textContent = pct + "%";
  }

  function renderPhaseUI() {
    document.getElementById("phase-text").textContent = (state.phase || "setup").toUpperCase();
    document.getElementById("end-turn-btn").disabled = state.phase !== "playing";
    document.getElementById("start-game-btn").style.display = state.phase === "setup" ? "inline-block" : "none";
    document.getElementById("setup-panel").style.opacity = state.phase === "setup" ? 1 : 0.4;
    document.getElementById("setup-panel").style.pointerEvents = state.phase === "setup" ? "auto" : "none";
    if (state.phase === "setup") checkSetupComplete();
  }

  function renderAdminLog() {
    const log = (state && state.log) || {};
    const container = document.getElementById("admin-log");
    const entries = Object.values(log).sort((a, b) => (a.ts||0) - (b.ts||0)).slice(-80);
    container.innerHTML = entries.map(e => {
      const time = new Date(e.ts || Date.now()).toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
      return `<div class="entry">${time} &middot; ${escapeHtml(e.text || "")}</div>`;
    }).join("");
  }

  function escapeHtml(str) {
    const d = document.createElement("div"); d.textContent = str; return d.innerHTML;
  }

  function logEvent(side, text) {
    FireState.pushLog({ side, text, type: "event" });
  }

  // ---------------- SCENARIO CARDS ----------------
  function cardFilterToggle(side) {
    cardFilterSide = side;
    selectedCardId = null;
    document.getElementById("card-filter-blue").classList.toggle("btn-ghost", side !== "blue");
    document.getElementById("card-filter-red").classList.toggle("btn-ghost", side !== "red");
    renderCardList();
  }
  document.getElementById("card-filter-blue").addEventListener("click", () => cardFilterToggle("blue"));
  document.getElementById("card-filter-red").addEventListener("click", () => cardFilterToggle("red"));

  function renderCardList() {
    const list = document.getElementById("card-list");
    const cards = SCENARIO_CARDS.filter(c => c.side === cardFilterSide);
    list.innerHTML = "";
    cards.forEach(card => {
      const el = document.createElement("div");
      el.className = "scenario-card" + (selectedCardId === card.id ? " selected" : "");
      const dots = Array.from({length:5}, (_,i) => `<span class="${i < card.difficulty ? "on" : ""}"></span>`).join("");
      el.innerHTML = `
        <div class="name"><span>${card.name}</span><span class="difficulty-dots">${dots}</span></div>
        <div class="meta">${card.type.toUpperCase()} &middot; modifier ${card.modifier >= 0 ? "+" : ""}${card.modifier} &middot; detection +${card.detectionRisk}</div>
        <div class="desc">${card.description}</div>
        <div class="admin-note">${card.adminNotes}</div>
      `;
      el.addEventListener("click", () => {
        selectedCardId = (selectedCardId === card.id) ? null : card.id;
        renderCardList();
        if (selectedCardId && card.type === "special") {
          handleSpecialCard(card);
        }
        if (pendingMove && pendingMove.type === "clash") updateResolvePanel();
      });
      list.appendChild(el);
    });
  }

  function handleSpecialCard(card) {
    // Non-combat cards: apply their effect immediately and log it.
    const res = GameEngine.resolveSpecial(card.id);
    if (!res) return;
    const newDetection = Math.min(DETECTION_MAX, (state.detectionMeter || 0) + res.detectionGain);
    logEvent(cardFilterSide, `${cardFilterSide.toUpperCase()} plays "${card.name}" — ${card.description}`);
    FireState.update({
      detectionMeter: newDetection,
      activeScenario: { side: cardFilterSide, cardId: card.id }
    });
    checkAndApplyWin(newDetection, state.board, false);
    selectedCardId = null;
  }

  // ---------------- CLASH RESOLUTION ----------------
  function openResolvePanel() {
    document.getElementById("roll-input").value = "";
    document.getElementById("resolve-panel").style.display = "flex";
    updateResolvePanel();
  }
  function closeResolvePanel() {
    document.getElementById("resolve-panel").style.display = "none";
    pendingMove = null;
    selectedCell = null;
    renderAdminBoard();
  }

  function wireResolvePanel() {
    document.getElementById("cancel-clash-btn").addEventListener("click", closeResolvePanel);
    document.getElementById("roll-random-btn").addEventListener("click", () => {
      document.getElementById("roll-input").value = Math.floor(Math.random()*100)+1;
      updateOddsPreview();
    });
    document.getElementById("roll-input").addEventListener("input", updateOddsPreview);
    document.getElementById("resolve-btn").addEventListener("click", applyResolution);
  }

  function currentClashCards() {
    const fromUnit = state.board[pendingMove.fromCell];
    const toUnit = state.board[pendingMove.toCell];
    const attackerCard = (selectedCardId && cardFilterSide === fromUnit.side) ? selectedCardId : null;
    return { fromUnit, toUnit, attackerCard };
  }

  function updateResolvePanel() {
    if (!pendingMove || pendingMove.type !== "clash") return;
    const { fromUnit, toUnit } = currentClashCards();
    const atkDef = GameEngine.findPieceDef(fromUnit.pieceId);
    const defDef = GameEngine.findPieceDef(toUnit.pieceId);
    document.getElementById("clash-summary").innerHTML = `
      <span style="color:var(--${fromUnit.side==='blue'?'blue':'red'}-core)">${atkDef?.name}</span>
      <span>vs</span>
      <span style="color:var(--${toUnit.side==='blue'?'blue':'red'}-core)">${defDef?.name}</span>
    `;
    if (!document.getElementById("roll-input").value) {
      document.getElementById("roll-input").value = Math.floor(Math.random()*100)+1;
    }
    updateOddsPreview();
  }

  function updateOddsPreview() {
    const { fromUnit, toUnit } = currentClashCards();
    const roll = parseInt(document.getElementById("roll-input").value, 10) || 50;
    const result = GameEngine.resolveClash(
      { pieceId: fromUnit.pieceId, side: fromUnit.side, rank: GameEngine.findPieceDef(fromUnit.pieceId).rank, scenarioCardId: (selectedCardId && cardFilterSide===fromUnit.side) ? selectedCardId : null },
      { pieceId: toUnit.pieceId, side: toUnit.side, rank: GameEngine.findPieceDef(toUnit.pieceId).rank, scenarioCardId: (selectedCardId && cardFilterSide===toUnit.side) ? selectedCardId : null },
      { roll }
    );
    document.getElementById("odds-num").textContent = result.attackerOdds + "%";
    document.getElementById("odds-num").style.color = result.attackerOdds >= 50 ? "var(--red-core)" : "var(--blue-core)";
  }

  function applyResolution() {
    const { fromUnit, toUnit } = currentClashCards();
    const attackerCardId = (selectedCardId && cardFilterSide === fromUnit.side) ? selectedCardId : null;
    const defenderCardId = (selectedCardId && cardFilterSide === toUnit.side) ? selectedCardId : null;
    const roll = parseInt(document.getElementById("roll-input").value, 10) || Math.floor(Math.random()*100)+1;

    const atkDef = GameEngine.findPieceDef(fromUnit.pieceId);
    const defDef = GameEngine.findPieceDef(toUnit.pieceId);

    const result = GameEngine.resolveClash(
      { pieceId: fromUnit.pieceId, side: fromUnit.side, rank: atkDef.rank, scenarioCardId: attackerCardId },
      { pieceId: toUnit.pieceId, side: toUnit.side, rank: defDef.rank, scenarioCardId: defenderCardId },
      { roll }
    );

    // Reveal both pieces publicly
    fromUnit.revealed = true;
    toUnit.revealed = true;

    let serverBreached = false;
    const fromKey = pendingMove.fromCell, toKey = pendingMove.toCell;

    // Work on local copies so an interleaved Firebase subscription update
    // (triggered synchronously by pushLog's notify, in the local-mock case)
    // can't clobber this in-progress transaction before we persist it.
    const boardCopy = { ...state.board };
    const eliminatedCopy = {
      blue: { ...((state.eliminated && state.eliminated.blue) || {}) },
      red: { ...((state.eliminated && state.eliminated.red) || {}) }
    };

    function bumpLocal(side, pieceId) {
      eliminatedCopy[side][pieceId] = (eliminatedCopy[side][pieceId] || 0) + 1;
    }

    if (result.outcome === "attacker") {
      if (defDef.isObjective) {
        serverBreached = true;
      }
      toUnit.eliminated = true;
      bumpLocal(toUnit.side, toUnit.pieceId);
      boardCopy[toKey] = fromUnit;     // attacker occupies the cell
      delete boardCopy[fromKey];
    } else {
      fromUnit.eliminated = true;
      bumpLocal(fromUnit.side, fromUnit.pieceId);
      delete boardCopy[fromKey];        // attacker is eliminated, defender holds
      boardCopy[toKey] = toUnit;
    }

    const newDetection = Math.min(DETECTION_MAX, (state.detectionMeter || 0) + result.detectionGain);

    // Keep our local working copy in sync immediately so subsequent reads
    // in this same tick (e.g. checkAndApplyWin below) see the new data,
    // even if a subscribe callback hasn't round-tripped yet.
    state.board = boardCopy;
    state.eliminated = eliminatedCopy;

    logEvent("system",
      `${atkDef.name} (${fromUnit.side.toUpperCase()}) engaged ${defDef.name} (${toUnit.side.toUpperCase()}) at ${toKey}: ${result.summary}`);

    FireState.update({
      board: boardCopy,
      eliminated: eliminatedCopy,
      detectionMeter: newDetection,
      activeScenario: attackerCardId ? { side: fromUnit.side, cardId: attackerCardId } : (defenderCardId ? { side: toUnit.side, cardId: defenderCardId } : null)
    });

    checkAndApplyWin(newDetection, boardCopy, serverBreached);

    selectedCardId = null;
    closeResolvePanel();
  }

  function checkAndApplyWin(detectionMeter, board, serverBreachedFlag) {
    if (!state || state.phase !== "playing") return; // never evaluate win conditions outside an active game
    const blueMovableRemaining = BLUE_PIECES
      .filter(p => p.movable !== false)
      .reduce((sum, p) => sum + countAlive("blue", p.id, board), 0);
    const redRemaining = RED_PIECES.reduce((sum, p) => sum + countAlive("red", p.id, board), 0);

    const win = GameEngine.checkWinConditions({
      detectionMeter,
      serverBreached: !!serverBreachedFlag,
      blueMovableRemaining,
      redRemaining
    });

    if (win) {
      logEvent("system", `GAME OVER — ${win.winner.toUpperCase()} WINS: ${win.reason}`);
      FireState.update({ phase: "ended", winner: win.winner, winReason: win.reason });
    }
  }

  function countAlive(side, pieceId, board) {
    return Object.values(board).filter(u => u && u.side === side && u.pieceId === pieceId && !u.eliminated).length;
  }

  // ---------------- DETECTION MANUAL CONTROLS ----------------
  function wireDetectionControls() {
    document.getElementById("detection-add-btn").addEventListener("click", () => {
      const amt = parseInt(document.getElementById("detection-adjust").value, 10) || 0;
      const newVal = Math.min(DETECTION_MAX, (state.detectionMeter || 0) + amt);
      logEvent("system", `Admin manually raised detection meter by ${amt}.`);
      FireState.update({ detectionMeter: newVal });
      checkAndApplyWin(newVal, state.board, false);
    });
    document.getElementById("detection-sub-btn").addEventListener("click", () => {
      const amt = parseInt(document.getElementById("detection-adjust").value, 10) || 0;
      const newVal = Math.max(0, (state.detectionMeter || 0) - amt);
      logEvent("system", `Admin manually lowered detection meter by ${amt}.`);
      FireState.update({ detectionMeter: newVal });
    });
  }

})();
