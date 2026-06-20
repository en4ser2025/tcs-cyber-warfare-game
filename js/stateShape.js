/* ============================================================
   CYBER GRID :: STATE SHAPE
   The single source of truth for what a "game state" object
   looks like in Firebase at /games/{GAME_ID}.

   {
     phase: 'setup' | 'playing' | 'ended',
     turn: 'blue' | 'red',
     turnNumber: 1,
     detectionMeter: 0-100,
     winner: null | 'blue' | 'red',
     winReason: null | string,
     board: {
       "r,c": {
         side: 'blue'|'red',
         pieceId: 'fw'|'analyst'|...,
         instanceId: 'blue-fw-1',
         revealed: boolean,        // true once identity is publicly known
         eliminated: false
       }, ...
     },
     pendingClash: null | {
       fromCell, toCell, attackerInstanceId, defenderInstanceId,
       attackerCardId, defenderCardId, resolution: {...} | null
     },
     activeScenario: null | { side, cardId, cellRef, note },  // shown on public board banner
     log: { pushId: { ts, side, text, type } }
   }
   ============================================================ */

function buildEmptyState() {
  return {
    phase: "setup",
    turn: "blue",
    turnNumber: 1,
    detectionMeter: 0,
    winner: null,
    winReason: null,
    board: {},
    eliminated: { blue: {}, red: {} },
    pendingClash: null,
    activeScenario: null,
    log: {}
  };
}

/** Returns the list of {pieceId, side} instances a side must place during setup. */
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
