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

    // --- Nature-based realism adjustment ---
    // Human (social) attackers targeting human defenders are in their element:
    // manipulation, phishing, and pretexting work best against people.
    const atkNature = attackerPieceDef?.nature || "human";
    const defNature = defenderPieceDef?.nature || "human";
    if (atkNature === "human" && defNature === "human") {
      attackerOdds += 8;   // social attacks favour the attacker against people
    } else if (atkNature === "human" && defNature === "system") {
      attackerOdds -= 8;   // a person alone struggles to defeat a hardened system head-on
    }
    // (technical vs human is blocked upstream and never reaches here)

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
   * Determine whether an attacker piece can legitimately engage a defender piece,
   * based on their nature (human vs system/technical).
   *
   * Rule of thumb:
   *  - A purely TECHNICAL attacker (Zero-Day, Ransomware, Recon Scanner) is code/tooling.
   *    Code exploits SYSTEMS, not people. It cannot "attack" a human defender.
   *  - A HUMAN attacker (Social Engineer, Phishing, APT, Insider, Botnet Master) can
   *    engage EITHER a human (manipulation, coercion) or a system (they operate tools).
   *  - Human DEFENDERS may still DETECT technical attackers (that's the SOC's job), but
   *    a technical attacker cannot initiate a clash against a human — it has no way to
   *    "beat" a person in direct combat.
   *
   * @param {string} attackerPieceId
   * @param {string} defenderPieceId
   * @returns {Object} { allowed: boolean, reason: string }
   */
  function canEngage(attackerPieceId, defenderPieceId) {
    const atk = findPieceDef(attackerPieceId);
    const def = findPieceDef(defenderPieceId);
    if (!atk || !def) return { allowed: true, reason: "" };

    const atkNature = atk.nature || "human";
    const defNature = def.nature || "human";

    // Technical attacker vs human defender → not allowed
    if (atkNature === "technical" && defNature === "human") {
      return {
        allowed: false,
        reason: `${atk.name} is a technical exploit — it can compromise systems, not people. A ${def.name} (human) can only be reached through social attacks (phishing, social engineering, insider access).`
      };
    }

    // Everything else is allowed:
    //  - human attacker vs anyone (they can manipulate people or wield tools)
    //  - technical attacker vs system/technical (code vs code/system)
    //  - system defenders vs anything
    return { allowed: true, reason: "" };
  }

  /**
   * Given an attacker, return the list of defender natures it can legitimately target.
   * Used to validate scenario cards and highlight valid destinations.
   */
  function validTargetNatures(attackerPieceId) {
    const atk = findPieceDef(attackerPieceId);
    const atkNature = atk?.nature || "human";
    if (atkNature === "technical") return ["system", "technical"];
    return ["human", "system", "technical"]; // humans can target anything
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
    findPieceDef,
    canEngage,
    validTargetNatures
  };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = GameEngine;
}
