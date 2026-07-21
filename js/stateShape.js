/* ============================================================
   CYBER GRID :: STATE SHAPE
   ============================================================ */

function buildEmptyState(mode) {
  return {
    gameId: "game_" + Date.now(),  // unique per new game — resets participant team selection
    mode: mode || (typeof DEFAULT_MODE !== "undefined" ? DEFAULT_MODE : "it"),  // 'it' | 'ot' — locked at game start
    phase: "setup",
    turn: "blue",
    turnNumber: 1,
    turnKey: "t1-blue",
    detectionMeter: 0,
    // OT mode (Stage 4): second meter + safety mechanics. Ignored in IT mode.
    processSafety: 0,          // 0..100 — rises as Red drives the process unsafe; 100 = physical-damage loss
    safeStateTripped: false,   // Blue invoked the SIS to halt the process (caps safety, costs availability)
    maintenanceTokens: 2,      // scarce patch/harden budget for OT (tune in playtest)
    // Assessment tracking (Stage 5) — accumulates decision-quality signals during play
    stats: {
      redStealthCards: 0,       // times Red played a detection-reducing / deferred stealth card
      redNoisyActions: 0,       // Red engages that raised detection meaningfully
      blueDetectionGains: 0,    // total detection Blue drove up through pressure
      timerExpiries: { blue: 0, red: 0 },  // votes that ran out instead of being decided
      clashesInitiated: { blue: 0, red: 0 },
      safeStateTripTurn: null,  // turnNumber when Blue tripped (null = never)
      peakProcessSafety: 0,     // highest process-safety reached (OT)
      maintenanceUsed: 0,       // maintenance windows spent (OT)
      turnsPlayed: 0
    },
    winner: null,
    winReason: null,
    board: {},
    eliminated: { blue: {}, red: {} },
    pendingClash: null,
    activeScenario: null,
    votes: {},
    votePhase: "move",        // 'move' first (Round 1), then 'card' if clash detected (Round 2)
    voteDeadline: null,       // Unix timestamp ms when current vote phase expires
    suppressNextDetection: null,  // side ('red'/'blue') whose next action is silent (Living off the Land)
    halveNextDetection: null,     // side whose next action draws half detection (Timestomp/Blend)
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
