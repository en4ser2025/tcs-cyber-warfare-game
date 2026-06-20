/* ============================================================
   CYBER GRID :: GAME ENGINE
   Pure logic functions for combat resolution and win conditions.
   No DOM access here — admin.js and board.js call into this.
   ============================================================ */

const GameEngine = (function () {

  /**
   * Resolve a clash between an attacking piece and a defending piece.
   * @param {Object} attacker   { pieceId, side, rank, scenarioCardId }
   * @param {Object} defender   { pieceId, side, rank, scenarioCardId }
   * @param {Object} opts       { roll: number 0-100 (optional, auto-rolled if absent) }
   * @returns {Object} resolution result
   */
  function resolveClash(attacker, defender, opts = {}) {
    const atkCard = SCENARIO_CARDS.find(c => c.id === attacker.scenarioCardId) || null;
    const defCard = SCENARIO_CARDS.find(c => c.id === defender.scenarioCardId) || null;

    // --- Special-case: Zero-Day Exploit auto-beats Firewall ---
    const attackerPieceDef = findPieceDef(attacker.pieceId);
    const defenderPieceDef = findPieceDef(defender.pieceId);

    if (attackerPieceDef?.special === "firewall-killer" && defenderPieceDef?.id === "fw") {
      return finalize("attacker", "Zero-day bypasses the firewall outright.", attacker, defender, atkCard, defCard, 100);
    }

    // --- Special-case: Honeypot trap always identifies the attacker ---
    let forcedReveal = false;
    if (defCard?.id === "b_deploy_honeypot" || defenderPieceDef?.id === "honeypot") {
      forcedReveal = true;
    }

    // --- Base odds from rank difference ---
    // Equal rank = 50/50. Each rank step = +12% to the higher-rank side.
    const rankDiff = attacker.rank - defender.rank; // positive favors attacker
    let attackerOdds = 50 + (rankDiff * 12);

    // --- Apply scenario card modifiers ---
    attackerOdds += atkCard ? atkCard.modifier : 0;
    attackerOdds -= defCard ? defCard.modifier : 0;

    // Clamp to a sane range — even the best play shouldn't be a 100% lock
    // (keeps the game from feeling pre-determined), and even the worst
    // shouldn't be a flat-zero auto-loss.
    attackerOdds = Math.max(5, Math.min(95, attackerOdds));

    const roll = typeof opts.roll === "number" ? opts.roll : Math.floor(Math.random() * 100) + 1;
    const attackerWins = roll <= attackerOdds;

    const outcome = attackerWins ? "attacker" : "defender";
    const summary = attackerWins
      ? `${attackerPieceDef?.name || "Attacker"} prevails (${attackerOdds}% odds, rolled ${roll}).`
      : `${defenderPieceDef?.name || "Defender"} holds the line (${attackerOdds}% attacker odds, rolled ${roll}).`;

    return finalize(outcome, summary, attacker, defender, atkCard, defCard, attackerOdds, roll, forcedReveal);
  }

  function finalize(outcome, summary, attacker, defender, atkCard, defCard, attackerOdds, roll, forcedReveal) {
    return {
      outcome,                 // 'attacker' | 'defender'
      summary,
      attackerOdds,
      roll: roll ?? null,
      attackerCard: atkCard,
      defenderCard: defCard,
      revealAttacker: forcedReveal || outcome === "attacker" || true, // clashes always reveal both in this ruleset
      revealDefender: true,
      detectionGain: computeDetectionGain(attacker, defender, atkCard, outcome, forcedReveal)
    };
  }

  /**
   * How much the detection meter rises after this clash.
   * Loud failed attacks and forced honeypot reveals raise it most.
   */
  function computeDetectionGain(attacker, defender, atkCard, outcome, forcedReveal) {
    let base = atkCard ? atkCard.detectionRisk : 10;
    if (outcome === "defender") base += 5;       // failed attacks are noisier
    if (forcedReveal) base += 15;                 // honeypot catches are very noisy
    return Math.max(0, base);
  }

  /**
   * Resolve a non-combat "special" scenario play (recon, threat hunt, etc).
   * Returns guidance text for the admin; does not move pieces.
   */
  function resolveSpecial(cardId) {
    const card = SCENARIO_CARDS.find(c => c.id === cardId);
    if (!card) return null;
    return {
      card,
      detectionGain: card.detectionRisk || 0
    };
  }

  function findPieceDef(pieceId) {
    return [...BLUE_PIECES, ...RED_PIECES].find(p => p.id === pieceId) || null;
  }

  /**
   * Check win conditions given full game state.
   * @param {Object} state - { detectionMeter, serverBreached, board, blueRemaining, redRemaining }
   * @returns {Object|null} { winner: 'blue'|'red', reason } or null if game continues
   */
  function checkWinConditions(state) {
    if (state.detectionMeter >= DETECTION_MAX) {
      return { winner: "blue", reason: "SOC detection threshold reached — the intrusion was caught in progress." };
    }
    if (state.serverBreached) {
      return { winner: "red", reason: "The Critical Server was breached and taken offline undetected." };
    }
    if (state.redRemaining === 0) {
      return { winner: "blue", reason: "All attacking units have been neutralized." };
    }
    // Blue loses automatically only if the server itself is eliminated (handled by serverBreached)
    // If Blue has zero MOVABLE pieces left (server can't move), Red effectively wins by attrition:
    if (state.blueMovableRemaining === 0) {
      return { winner: "red", reason: "All defending units have been neutralized — the server stands undefended." };
    }
    return null;
  }

  return {
    resolveClash,
    resolveSpecial,
    checkWinConditions,
    findPieceDef
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = GameEngine;
}
