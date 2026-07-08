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
  const VOTE_DURATION_MS = 20000;  // 20-second countdown for each vote phase

  let state = null;             // last known shared game state
  let setupSide = "blue";       // which bank is showing during setup
  let setupSelectedPieceId = null;
  let cardFilterSide = "blue";
  let selectedCardId = null;
  let selectedCell = null;      // currently selected piece's cell during play
  let pendingMove = null;       // { fromCell, toCell, type: 'move'|'clash' }
  let bootStarted = false;
  let countdownInterval = null; // setInterval handle for local countdown tick

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
        state = buildEmptyState();
        FireState.set(state);
        return;
      }
      state = s;
      if (!state.board) state.board = {};
      renderEverything();
      checkQuorum();   // check on every state update
    });

    wireVotingPanel();
  }

  function wireVotingPanel() {
    document.getElementById("vote-config-save-btn").addEventListener("click", () => {
      const blueExp = parseInt(document.getElementById("vote-blue-expected").value, 10) || 5;
      const redExp  = parseInt(document.getElementById("vote-red-expected").value, 10) || 5;
      FireState.update({ votingConfig: { blueExpected: blueExp, redExpected: redExp, enabled: true } });
      logEvent("system", `Voter counts updated — Blue: ${blueExp}, Red: ${redExp}. Quorum = 50%+1 each side.`);
    });

    document.getElementById("vote-apply-btn").addEventListener("click", () => {
      const votePhase = state && state.votePhase || "card";
      if (votePhase === "move") {
        const moveTally = buildMoveTally(state.turn);
        const sorted = Object.entries(moveTally).sort((a, b) => b[1] - a[1]);
        if (sorted.length) applyWinningMove(sorted[0][0]);
      } else {
        applyWinningVote(true);
      }
    });

    document.getElementById("timer-reset-btn").addEventListener("click", () => {
      // Admin can restart the 20-second countdown at any time
      startVoteCountdown();
    });

    document.getElementById("vote-reset-btn").addEventListener("click", () => {
      if (!state) return;
      const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
      FireState.update({ votes: {} });
      logEvent("system", "Votes manually reset by admin.");
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
        "This clears the board and randomly re-deploys all pieces. Click Start Game when ready.",
        () => {
          state = buildEmptyState();
          selectedCell = null; setupSelectedPieceId = null;
          // randomSetup writes to Firebase — call after resetting local state
          randomSetup();
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
      state.turnKey = "t1-blue";
      state.votes = {};
      const deadline = Date.now() + VOTE_DURATION_MS;
      logEvent("system", "Setup complete. The simulation begins — Blue moves first.");
      FireState.update({ phase: "playing", turn: "blue", turnNumber: 1, turnKey: "t1-blue", votes: {}, votePhase: "card", voteDeadline: deadline });
      startCountdownFrom(deadline, "card");
    });

    document.getElementById("random-setup-btn").addEventListener("click", () => {
      if (state && state.phase !== "setup") {
        flashHint("Random setup is only available during the Setup phase. Click New Game first.");
        return;
      }
      randomSetup();
    });

    document.getElementById("end-turn-btn").addEventListener("click", () => {
      const next = state.turn === "blue" ? "red" : "blue";
      const nextTurnNumber = next === "blue" ? (state.turnNumber || 1) + 1 : state.turnNumber || 1;
      const nextTurnKey = "t" + nextTurnNumber + "-" + next;
      const deadline = Date.now() + VOTE_DURATION_MS;
      selectedCell = null; selectedCardId = null;
      FireState.update({ turn: next, turnNumber: nextTurnNumber, turnKey: nextTurnKey, activeScenario: null, votes: {}, votePhase: "card", voteDeadline: deadline });
      startCountdownFrom(deadline, "card");
    });
  }

  /**
   * Randomly place all Blue and Red pieces in their respective deployment zones.
   * Blue gets rows 5-7 (24 cells, exactly matching Blue's 24 pieces).
   * Red gets rows 0-2 (24 cells available, 20 pieces placed, 4 cells left empty at random).
   * Pieces are shuffled before placement so every run produces a unique layout.
   */
  function randomSetup() {
    function shuffle(arr) {
      const a = [...arr];
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    const board = {};

    // --- Build Blue instances and shuffle ---
    const blueInstances = [];
    BLUE_PIECES.forEach(p => {
      for (let i = 0; i < p.count; i++) {
        blueInstances.push({ side: "blue", pieceId: p.id, instanceId: `blue-${p.id}-${i+1}`, revealed: false, eliminated: false });
      }
    });
    const shuffledBlue = shuffle(blueInstances);

    // Blue cells: all 24 cells in rows 5-7, also shuffled so pieces land in random positions
    const blueCells = shuffle(
      [5, 6, 7].flatMap(row => Array.from({ length: 8 }, (_, col) => cellKey(row, col)))
    );
    shuffledBlue.forEach((piece, i) => { board[blueCells[i]] = piece; });

    // --- Build Red instances and shuffle ---
    const redInstances = [];
    RED_PIECES.forEach(p => {
      for (let i = 0; i < p.count; i++) {
        redInstances.push({ side: "red", pieceId: p.id, instanceId: `red-${p.id}-${i+1}`, revealed: false, eliminated: false });
      }
    });
    const shuffledRed = shuffle(redInstances);

    // Red cells: 24 available but only 20 pieces — pick 20 random cells from rows 0-2
    const redCells = shuffle(
      [0, 1, 2].flatMap(row => Array.from({ length: 8 }, (_, col) => cellKey(row, col)))
    ).slice(0, shuffledRed.length); // take only as many cells as there are pieces
    shuffledRed.forEach((piece, i) => { board[redCells[i]] = piece; });

    // Write fresh state with the populated board
    const newState = buildEmptyState();
    newState.board = board;
    state = newState;
    FireState.set(newState);
    logEvent("system", "Pieces randomly deployed. Review positions then click Start Game.");
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
        if (!hasLegalAdjacentMove(key)) {
          flashHint("Boxed in — every adjacent cell is occupied by a friendly piece. Pick a different piece.");
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

      // treat eliminated pieces as empty — the cell is open to move into
      if (!targetUnit || targetUnit.eliminated) {
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

  /** Returns true if the piece at `key` has at least one adjacent cell that's
   *  empty or holds an enemy piece (i.e. a legal move or clash exists). */
  function hasLegalAdjacentMove(key) {
    const { row, col } = parseCellKey(key);
    const unit = state.board[key];
    if (!unit) return false;
    const neighbors = [[row-1,col],[row+1,col],[row,col-1],[row,col+1]];
    return neighbors.some(([r, c]) => {
      if (r < 0 || r >= BOARD_SIZE || c < 0 || c >= BOARD_SIZE) return false;
      const occupant = state.board[cellKey(r, c)];
      // treat eliminated pieces as empty — they no longer occupy the cell
      if (!occupant || occupant.eliminated) return true;
      return occupant.side !== unit.side;
    });
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
    autoEndTurn();
  }

  /** End the current turn automatically after a move or clash completes.
   *  Skips if the game has already ended (win condition triggered this action). */
  function autoEndTurn() {
    if (!state || state.phase !== "playing") return;
    const next = state.turn === "blue" ? "red" : "blue";
    const nextTurnNumber = next === "blue" ? (state.turnNumber || 1) + 1 : state.turnNumber || 1;
    const nextTurnKey = "t" + nextTurnNumber + "-" + next;
    selectedCell = null;
    selectedCardId = null;
    setTimeout(() => {
      if (!state || state.phase !== "playing") return;
      const deadline = Date.now() + VOTE_DURATION_MS;
      FireState.update({ turn: next, turnNumber: nextTurnNumber, turnKey: nextTurnKey, activeScenario: null, votes: {}, votePhase: "card", voteDeadline: deadline });
      logEvent("system", `Turn ended automatically — now ${next.toUpperCase()}'s turn (#${nextTurnNumber}).`);
      startCountdownFrom(deadline, "card");
    }, 1200);
  }

  function pieceLabel(unit) {
    const def = GameEngine.findPieceDef(unit.pieceId);
    return unit.revealed ? (def?.name || unit.pieceId) : `Unidentified ${unit.side === "blue" ? "defender" : "threat actor"} unit`;
  }

  function checkSetupComplete() {
    const blueMissing = BLUE_PIECES.filter(p => placedCountFor("blue", p.id) !== p.count);
    const redMissing = RED_PIECES.filter(p => placedCountFor("red", p.id) !== p.count);
    const blueDone = blueMissing.length === 0;
    const redDone = redMissing.length === 0;
    document.getElementById("start-game-btn").disabled = !(blueDone && redDone);

    const totalNeeded = BLUE_PIECES.reduce((s, p) => s + p.count, 0) + RED_PIECES.reduce((s, p) => s + p.count, 0);
    const totalPlaced = BLUE_PIECES.reduce((s, p) => s + placedCountFor("blue", p.id), 0)
                       + RED_PIECES.reduce((s, p) => s + placedCountFor("red", p.id), 0);

    const pill = document.getElementById("setup-progress-pill");
    const text = document.getElementById("setup-progress-text");
    if (state.phase === "setup") {
      pill.style.display = "inline-flex";
      pill.className = "pill" + (blueDone && redDone ? " pill-green" : " pill-amber");
      if (blueDone && redDone) {
        text.textContent = `${totalPlaced}/${totalNeeded} placed — ready to start`;
      } else {
        const missingParts = [];
        if (!blueDone) missingParts.push("Blue: " + blueMissing.map(p => p.short + " " + placedCountFor("blue", p.id) + "/" + p.count).join(", "));
        if (!redDone) missingParts.push("Red: " + redMissing.map(p => p.short + " " + placedCountFor("red", p.id) + "/" + p.count).join(", "));
        text.textContent = `${totalPlaced}/${totalNeeded} placed — missing ${missingParts.join(" | ")}`;
      }
    } else {
      pill.style.display = "none";
    }
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
    renderTurnInstruction();
    renderVoteTally();
    syncVotingConfigUI();
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

      const isCurrentTurnSide = state.phase === "playing" && unit.side === state.turn;
      const isImmovableType = def && def.movable === false;
      if (isCurrentTurnSide && !isImmovableType && !hasLegalAdjacentMove(key)) {
        piece.className += " boxed-in";
        piece.title = "Boxed in — no legal move this turn";
      }

      piece.innerHTML = `<svg><use href="#icon-${def?.icon || "shield"}"></use></svg><span class="rank-badge">${def?.short || "?"}</span>`;
      cellEl.appendChild(piece);
    });

    if (selectedCell && state.board[selectedCell]) {
      const { row, col } = parseCellKey(selectedCell);
      document.getElementById(`admin-cell-${row}-${col}`)?.classList.add("selected");
      // highlight adjacent cells — treat eliminated pieces as empty (they're gone from the board)
      [[row-1,col],[row+1,col],[row,col-1],[row,col+1]].forEach(([r,c]) => {
        if (r<0||r>=BOARD_SIZE||c<0||c>=BOARD_SIZE) return;
        const k = cellKey(r,c);
        const targetCellEl = document.getElementById(`admin-cell-${r}-${c}`);
        if (!targetCellEl) return;
        const occ = board[k];
        const isEffectivelyEmpty = !occ || occ.eliminated;
        if (isEffectivelyEmpty) targetCellEl.classList.add("target-valid");
        else if (occ.side !== state.board[selectedCell].side) targetCellEl.classList.add("target-clash");
      });
    }

    renderTurnInstruction();
  }

  function renderRosterAdmin() {
    ["blue", "red"].forEach(side => {
      const roster = side === "blue" ? BLUE_PIECES : RED_PIECES;
      const container = document.getElementById(`${side}-roster-admin`);
      container.innerHTML = roster.map(p => {
        const elimCount = eliminatedCountFor(side, p.id);
        const left = p.count - elimCount;

        let style = "display:flex;justify-content:space-between;padding:2px 0;";
        let color = "";
        if (left === 0) {
          // all of this type gone — grey strikethrough
          style += "opacity:.3;text-decoration:line-through;";
          color = "color:var(--text-low);";
        } else if (elimCount > 0) {
          // some gone but not all — amber warning
          color = "color:var(--amber);";
        }

        return `<div style="${style}${color}"><span>${p.short} &middot; ${p.name}</span><span>${left}/${p.count}</span></div>`;
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

  function renderTurnInstruction() {
    const el = document.getElementById("turn-instruction");
    if (!el || !state) return;

    if (state.phase === "setup") {
      el.className = "turn-instruction";
      el.innerHTML = `<span class="step-num">i</span> Place every piece for both sides (see Setup panel), then click Start Game.`;
      return;
    }
    if (state.phase === "ended") {
      el.className = "turn-instruction step-ended";
      el.innerHTML = `<span class="step-num">&#10003;</span> Game over — click New Game to play again.`;
      return;
    }

    const turnSide = state.turn || "blue";
    const turnLabel = turnSide.toUpperCase();

    if (selectedCell && state.board[selectedCell]) {
      // Step 2 in progress: a piece is selected, waiting for a destination click.
      el.className = "turn-instruction step-move";
      el.innerHTML = `<span class="step-num">2</span> Piece selected — click a highlighted adjacent cell to move or engage.`;
      return;
    }

    if (selectedCardId && cardFilterSide === turnSide) {
      // Step 1 done: a card matching the current turn's side is armed.
      const card = SCENARIO_CARDS.find(c => c.id === selectedCardId);
      el.className = "turn-instruction step-move";
      el.innerHTML = `<span class="step-num">2</span> "${card ? card.name : "Card"}" selected for ${turnLabel} — now click that side's piece on the board, then a destination cell.`;
      return;
    }

    // Step 1: nothing armed yet for the side whose turn it is.
    el.className = "turn-instruction step-card";
    el.innerHTML = `<span class="step-num">1</span> ${turnLabel}'s turn — pick a ${turnLabel} scenario card on the right (or skip straight to the board for a plain move), then click a piece.`;
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
    renderTurnInstruction();
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
        renderTurnInstruction();
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
      // Animate the defender being eliminated at toKey before overwriting
      const { row: elimRow, col: elimCol } = parseCellKey(toKey);
      triggerEliminationAnimation(elimRow, elimCol);
      boardCopy[toKey] = fromUnit;     // attacker occupies the cell
      delete boardCopy[fromKey];
    } else {
      fromUnit.eliminated = true;
      bumpLocal(fromUnit.side, fromUnit.pieceId);
      // Animate the attacker being eliminated at fromKey
      const { row: elimRow, col: elimCol } = parseCellKey(fromKey);
      triggerEliminationAnimation(elimRow, elimCol);
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
    autoEndTurn();
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

  // ---------------- VOTING ----------------

  /** Sync the voter count input fields to match whatever's stored in state */
  function syncVotingConfigUI() {
    if (!state || !state.votingConfig) return;
    const cfg = state.votingConfig;
    const blueInput = document.getElementById("vote-blue-expected");
    const redInput  = document.getElementById("vote-red-expected");
    if (blueInput && document.activeElement !== blueInput) blueInput.value = cfg.blueExpected || 5;
    if (redInput  && document.activeElement !== redInput)  redInput.value  = cfg.redExpected  || 5;
  }

  /** Build a tally map {cardId: count} for the current turn and side */
  function buildTally(side) {
    if (!state) return {};
    const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
    const allVotes = (state.votes && state.votes[currentTurnKey]) || {};
    const tally = {};
    Object.values(allVotes).forEach(v => {
      if (v.side === side) tally[v.cardId] = (tally[v.cardId] || 0) + 1;
    });
    return tally;
  }

  function quorumFor(side) {
    const cfg = (state && state.votingConfig) || {};
    const expected = side === "blue" ? (cfg.blueExpected || 5) : (cfg.redExpected || 5);
    return Math.ceil(expected / 2);
  }

  function totalVotesFor(side) {
    if (!state) return 0;
    const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
    const allVotes = (state.votes && state.votes[currentTurnKey]) || {};
    return Object.values(allVotes).filter(v => v.side === side).length;
  }

  /** Render the live vote tally panel in the admin UI */
  function renderVoteTally() {
    const container = document.getElementById("vote-tally-container");
    const applyBtn  = document.getElementById("vote-apply-btn");
    if (!container) return;

    if (!state || state.phase !== "playing") {
      container.innerHTML = `<div class="helper-text" style="padding:0;color:var(--text-low);">Start the game to enable voting.</div>`;
      if (applyBtn) applyBtn.disabled = true;
      return;
    }

    const side = state.turn;
    const votePhase = state.votePhase || "card";
    const quorum = quorumFor(side);
    const cfg = state.votingConfig || {};
    const expected = side === "blue" ? (cfg.blueExpected || 5) : (cfg.redExpected || 5);
    container.innerHTML = "";

    // Phase label
    const phaseLabel = document.createElement("div");
    phaseLabel.style.cssText = "font-family:var(--font-mono);font-size:11px;color:var(--text-mid);margin-bottom:4px;";

    if (votePhase === "card") {
      const tally = buildTally(side);
      const totalVotes = totalVotesFor(side);
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      const winner = sorted.find(([, count]) => count >= quorum);
      phaseLabel.textContent = `Round 1 — Card vote: ${side.toUpperCase()} ${totalVotes}/${expected} (quorum: ${quorum})`;
      container.appendChild(phaseLabel);

      if (sorted.length === 0) {
        const empty = document.createElement("div"); empty.className = "helper-text"; empty.style.padding = "0";
        empty.textContent = "No card votes yet."; container.appendChild(empty);
      } else {
        sorted.forEach(([cardId, count]) => {
          const card = SCENARIO_CARDS.find(c => c.id === cardId);
          const pct = Math.min(100, Math.round((count / expected) * 100));
          const isWin = count >= quorum;
          const colorVar = isWin ? "var(--green)" : (side === "blue" ? "var(--blue-core)" : "var(--red-core)");
          const row = document.createElement("div"); row.style.cssText = "display:flex;flex-direction:column;gap:2px;";
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-mid);"><span>${isWin ? "✓ " : ""}${card ? card.name : cardId}</span><span>${count}/${quorum}</span></div><div style="height:6px;border-radius:99px;background:var(--bg-raised);overflow:hidden;"><div style="height:100%;border-radius:99px;width:${pct}%;background:${colorVar};transition:width 0.4s ease;"></div></div>`;
          container.appendChild(row);
        });
      }
      if (applyBtn) applyBtn.disabled = !winner && sorted.length === 0;

    } else {
      // Move vote phase
      const moveTally = buildMoveTally(side);
      const moveSorted = Object.entries(moveTally).sort((a, b) => b[1] - a[1]);
      const moveWinner = moveSorted.find(([, count]) => count >= quorum);
      const totalMoveVotes = Object.values(moveTally).reduce((s, c) => s + c, 0);
      phaseLabel.textContent = `Round 2 — Move vote: ${side.toUpperCase()} ${totalMoveVotes}/${expected} (quorum: ${quorum})`;
      container.appendChild(phaseLabel);

      if (moveSorted.length === 0) {
        const empty = document.createElement("div"); empty.className = "helper-text"; empty.style.padding = "0";
        empty.textContent = "Waiting for move votes on phones…"; container.appendChild(empty);
      } else {
        moveSorted.slice(0, 5).forEach(([moveKey, count]) => {
          const [from, to] = moveKey.split("|");
          const unit = state.board && state.board[from];
          const def = unit ? GameEngine.findPieceDef(unit.pieceId) : null;
          const label = def ? `${def.short} ${from}→${to}` : `${from}→${to}`;
          const pct = Math.min(100, Math.round((count / expected) * 100));
          const isWin = count >= quorum;
          const colorVar = isWin ? "var(--green)" : (side === "blue" ? "var(--blue-core)" : "var(--red-core)");
          const row = document.createElement("div"); row.style.cssText = "display:flex;flex-direction:column;gap:2px;";
          row.innerHTML = `<div style="display:flex;justify-content:space-between;font-family:var(--font-mono);font-size:10px;color:var(--text-mid);"><span>${isWin ? "✓ " : ""}${label}</span><span>${count}/${quorum}</span></div><div style="height:6px;border-radius:99px;background:var(--bg-raised);overflow:hidden;"><div style="height:100%;border-radius:99px;width:${pct}%;background:${colorVar};transition:width 0.4s ease;"></div></div>`;
          container.appendChild(row);
        });
      }
      if (applyBtn) applyBtn.disabled = !moveWinner;
    }
  }

  /** Check if quorum has been reached for whichever votePhase we're in */
  let lastAutoAppliedTurnKey = null;
  let lastAutoAppliedMoveKey = null;

  function checkQuorum() {
    if (!state || state.phase !== "playing") return;
    const votePhase = state.votePhase || "card";

    if (votePhase === "card") {
      const side = state.turn;
      const tally = buildTally(side);
      const quorum = quorumFor(side);
      const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
      const winner = Object.entries(tally).find(([, count]) => count >= quorum);

      if (winner && currentTurnKey !== lastAutoAppliedTurnKey) {
        lastAutoAppliedTurnKey = currentTurnKey;
        applyWinningCard(false, winner[0]);
      }
    } else if (votePhase === "move") {
      checkMoveQuorum();
    }
  }

  /** Phase 1 quorum: card selected — flip votePhase to 'move' for special cards
   *  or arm the card and open move voting for engage/move cards */
  function applyWinningCard(manualOverride, overrideCardId) {
    if (!state || state.phase !== "playing") return;
    const side = state.turn;

    let cardId = overrideCardId;
    if (!cardId) {
      const tally = buildTally(side);
      const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]);
      if (!sorted.length) return;
      cardId = sorted[0][0];
    }

    const card = SCENARIO_CARDS.find(c => c.id === cardId);
    if (!card) return;

    const source = manualOverride ? "Admin applied" : "Quorum reached — auto-applied";
    logEvent(side, `${source}: "${card.name}" selected for ${side.toUpperCase()}.`);
    FireState.update({ activeScenario: { side, cardId } });

    if (card.type === "special") {
      handleSpecialCard(card);
      selectedCardId = null;
      renderCardList();
      renderTurnInstruction();
      renderVoteTally();
      autoEndTurn();
    } else {
      // Arm card in admin UI and open move-vote phase
      cardFilterToggle(side);
      selectedCardId = cardId;
      renderCardList();
      renderTurnInstruction();
      // Flip to move-voting phase — clears card votes, opens move round on phones
      const moveDeadline = Date.now() + VOTE_DURATION_MS;
      FireState.update({ votePhase: "move", votes: {}, voteDeadline: moveDeadline });
      logEvent(side, `Move vote now open — participants choose piece and destination on their phones.`);
      flashHint(`"${card.name}" armed — move vote open on phones. Or click a piece on the board directly.`);
      startCountdownFrom(moveDeadline, "move");
      renderVoteTally();
    }
  }

  /** Kept for backwards-compat: manual Apply Winning Card button */
  function applyWinningVote(manualOverride, overrideCardId) {
    applyWinningCard(manualOverride, overrideCardId);
  }

  /** Phase 2 quorum: move selected — execute it on the board */
  function checkMoveQuorum() {
    if (!state || state.phase !== "playing") return;
    const side = state.turn;
    const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
    const moveTally = buildMoveTally(side);
    const quorum = quorumFor(side);
    const moveKey = currentTurnKey + "-move";

    const winner = Object.entries(moveTally).find(([, count]) => count >= quorum);
    if (winner && moveKey !== lastAutoAppliedMoveKey) {
      lastAutoAppliedMoveKey = moveKey;
      applyWinningMove(winner[0]);
    }
  }

  /** Build tally for move votes: key is "fromCell|toCell" */
  function buildMoveTally(side) {
    if (!state) return {};
    const currentTurnKey = state.turnKey || ("t" + (state.turnNumber||1) + "-" + (state.turn||"blue"));
    const allVotes = (state.votes && state.votes[currentTurnKey]) || {};
    const tally = {};
    Object.values(allVotes).forEach(v => {
      if (v.side === side && v.fromCell && v.toCell) {
        const k = v.fromCell + "|" + v.toCell;
        tally[k] = (tally[k] || 0) + 1;
      }
    });
    return tally;
  }

  /** Execute the winning move from the move-vote phase */
  function applyWinningMove(moveKey) {
    const [fromCell, toCell] = moveKey.split("|");
    if (!fromCell || !toCell) return;
    if (!state.board[fromCell]) return;

    const fromUnit = state.board[fromCell];
    const toUnit = state.board[toCell];

    logEvent(fromUnit.side, `Move vote quorum: ${pieceLabel(fromUnit)} moves from ${fromCell} to ${toCell}.`);

    if (!toUnit || toUnit.eliminated) {
      // Simple move
      pendingMove = { fromCell, toCell, type: "move" };
      completeSimpleMove();
    } else if (toUnit.side !== fromUnit.side) {
      // Clash — open resolve panel for admin to adjudicate
      selectedCell = fromCell;
      pendingMove = { fromCell, toCell, type: "clash" };
      openResolvePanel();
      flashHint(`Move-voted clash: ${pieceLabel(fromUnit)} vs ${pieceLabel(toUnit)}. Resolve the clash.`);
    } else {
      logEvent("system", `Voted move ${fromCell}→${toCell} invalid (friendly piece there). Admin to resolve.`);
    }
  }
  // ---------------- COUNTDOWN TIMER ----------------

  function startVoteCountdown() {
    // Restart the countdown from now + 20s and write to Firebase
    const deadline = Date.now() + VOTE_DURATION_MS;
    const votePhase = state && state.votePhase || "card";
    FireState.update({ voteDeadline: deadline });
    startCountdownFrom(deadline, votePhase);
  }

  function startCountdownFrom(deadline, phase) {
    // Clear any existing interval
    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }

    const wrap = document.getElementById("admin-timer-wrap");
    const numEl = document.getElementById("admin-timer-num");
    const fillEl = document.getElementById("admin-ring-fill");
    const phaseEl = document.getElementById("admin-timer-phase");
    if (!wrap || !numEl) return;

    wrap.style.display = "flex";
    phaseEl.textContent = phase === "card" ? "Card vote" : "Move vote";

    const TOTAL = VOTE_DURATION_MS / 1000;
    const CIRCUMFERENCE = 97; // 2π × 15.5 (admin ring radius)

    function tick() {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      numEl.textContent = remaining;

      const pct = remaining / TOTAL;
      fillEl.style.strokeDashoffset = CIRCUMFERENCE * (1 - pct);

      // Colour coding
      if (remaining <= 5) { fillEl.className = "ring-fill urgent"; }
      else if (remaining <= 10) { fillEl.className = "ring-fill warning"; }
      else { fillEl.className = "ring-fill"; }

      if (remaining <= 0) {
        clearInterval(countdownInterval); countdownInterval = null;
        wrap.style.display = "none";
        onCountdownExpired(phase);
      }
    }

    tick();
    countdownInterval = setInterval(tick, 500);
  }

  function onCountdownExpired(phase) {
    if (!state || state.phase !== "playing") return;
    logEvent("system", `Vote timer expired — auto-applying majority ${phase} vote.`);
    if (phase === "card") {
      const tally = buildTally(state.turn);
      const sorted = Object.entries(tally).sort((a,b) => b[1]-a[1]);
      if (sorted.length) {
        applyWinningCard(true, sorted[0][0]);
      } else {
        // No votes at all — start move phase without a card (plain move)
        const deadline = Date.now() + VOTE_DURATION_MS;
        FireState.update({ votePhase: "move", votes: {}, voteDeadline: deadline });
        startCountdownFrom(deadline, "move");
        logEvent("system", "No card votes received — move vote now open.");
      }
    } else {
      const moveTally = buildMoveTally(state.turn);
      const sorted = Object.entries(moveTally).sort((a,b) => b[1]-a[1]);
      if (sorted.length) {
        applyWinningMove(sorted[0][0]);
      } else {
        logEvent("system", "No move votes received — admin please move a piece manually.");
      }
    }
  }

  // ---------------- ELIMINATION ANIMATION ----------------

  /** Trigger the zap-out animation on a board cell, then re-render after it finishes */
  function triggerEliminationAnimation(row, col) {
    const cellId = `admin-cell-${row}-${col}`;
    const cellEl = document.getElementById(cellId);
    if (!cellEl) return;
    cellEl.classList.add("zap-out");
    setTimeout(() => {
      cellEl.classList.remove("zap-out");
      renderAdminBoard();
    }, 700);
  }

})();
