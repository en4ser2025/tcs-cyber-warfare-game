/* ============================================================
   CYBER GRID :: STATE SHAPE
   ============================================================ */

function buildEmptyState() {
  return {
    gameId: "game_" + Date.now(),  // unique per new game — resets participant team selection
    phase: "setup",
    turn: "blue",
    turnNumber: 1,
    turnKey: "t1-blue",
    detectionMeter: 0,
    winner: null,
    winReason: null,
    board: {},
    eliminated: { blue: {}, red: {} },
    pendingClash: null,
    activeScenario: null,
    votes: {},
    votePhase: "move",        // 'move' first (Round 1), then 'card' if clash detected (Round 2)
    voteDeadline: null,       // Unix timestamp ms when current vote phase expires
    votingConfig: {
      blueExpected: 5,
      redExpected: 5,
      enabled: true
    },
    log: {}
  };
}

function buildSetupBank(side) {
  const roster = side === "blue" ? BLUE_PIECES : RED_PIECES;
  const bank = [];
  roster.forEach(p => {
    for (let i = 0; i < p.count; i++) {
      bank.push({ pieceId: p.id, side, instanceId: `${side}-${p.id}-${i + 1}` });
    }
  });
  return bank;
}

function cellKey(row, col) { return `${row},${col}`; }
function parseCellKey(key) { const [r, c] = key.split(",").map(Number); return { row: r, col: c }; }

function zoneForRow(row) {
  if (BLUE_SETUP_ROWS.includes(row)) return "blue";
  if (RED_SETUP_ROWS.includes(row)) return "red";
  return "dmz";
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildEmptyState, buildSetupBank, cellKey, parseCellKey, zoneForRow };
}
