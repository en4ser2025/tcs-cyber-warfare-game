/* =====================================================================
   CRITICAL INFRASTRUCTURE SIMULATION BOARD :: ASSESSMENT ENGINE (Stage 5)
   Decision-quality-weighted scoring for both teams. Produces a band grade
   (Strong / Proficient / Developing / At-risk) plus numeric category
   breakdowns with plain-English rationale, for the on-screen debrief and
   the exportable report. Self-contained, no dependencies.
   ===================================================================== */
const Assessment = (function () {

  // Map a 0..100 numeric score to a band.
  function band(score) {
    if (score >= 80) return "Strong";
    if (score >= 60) return "Proficient";
    if (score >= 40) return "Developing";
    return "At-risk";
  }

  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

  // A category result: { key, label, score, band, rationale }
  function cat(key, label, score, rationale) {
    const s = clamp(score);
    return { key, label, score: s, band: band(s), rationale };
  }

  /**
   * Score a completed game.
   * @param {Object} state - final game state (mode, winner, winReason, winSeverity,
   *   detectionMeter, processSafety, safeStateTripped, maintenanceTokens, stats, turnNumber)
   * @returns {Object} { mode, winner, blue: {...}, red: {...} }
   */
  function scoreGame(state) {
    const isOT = state.mode === "ot";
    const stats = state.stats || {};
    const winner = state.winner || null;
    const winSeverity = state.winSeverity || null;
    const detection = state.detectionMeter || 0;
    const process = state.processSafety || 0;
    const tripped = !!state.safeStateTripped;
    const turnsPlayed = stats.turnsPlayed || state.turnNumber || 1;

    // ---------- BLUE (defenders) ----------
    const blueCats = [];

    // Detection discipline (Blue drives detection UP through pressure)
    {
      const gain = stats.blueDetectionGains || 0;
      // Reward Blue for pushing detection up; scale so ~detection meter value maps to a score
      let s = Math.min(100, detection + Math.min(30, gain / 3));
      blueCats.push(cat("detection_pressure", "Detection Pressure",
        s,
        detection >= 70 ? "Applied strong, sustained pressure — the intrusion was close to being caught."
        : detection >= 40 ? "Applied moderate pressure on the attacker's footprint."
        : "Let the attacker operate too quietly — little pressure was applied to force noisy mistakes."));
    }

    // Decisiveness (few timer expiries = decisive)
    {
      const expiries = (stats.timerExpiries && stats.timerExpiries.blue) || 0;
      const s = 100 - Math.min(100, expiries * 20);
      blueCats.push(cat("decisiveness", "Decisiveness",
        s,
        expiries === 0 ? "Every decision was made within the vote window — consistently decisive."
        : expiries <= 2 ? "Mostly decisive, with a few votes running out of time."
        : "Frequently let the clock run out instead of committing to a decision."));
    }

    if (isOT) {
      // Safe-state timing — the signature OT judgement
      {
        let s, why;
        const damage = (winner === "red" && winSeverity === "critical");
        if (damage) {
          s = 5; why = "Catastrophic: the process suffered physical damage — a safe-state trip was needed and never came (or came too late).";
        } else if (!tripped) {
          if (process >= 70) { s = 45; why = "Survived without tripping, but let the process run dangerously close to the limit — a risky gamble."; }
          else { s = 80; why = "Held the process safely without needing to trip — availability was preserved and safety maintained."; }
        } else {
          const tripTurn = stats.safeStateTripTurn || turnsPlayed;
          const peak = stats.peakProcessSafety || process;
          if (peak < 40) { s = 45; why = "Tripped very early, sacrificing availability before the threat justified it."; }
          else if (peak <= 85) { s = 92; why = "Tripped at the right moment — safety secured with availability sacrificed only when genuinely warranted."; }
          else { s = 70; why = "Tripped late, under real pressure — safety was secured but only narrowly."; }
        }
        blueCats.push(cat("safe_state_timing", "Safe-State Timing", s, why));
      }
      // Maintenance-window husbandry
      {
        const used = stats.maintenanceUsed || 0;
        const left = (typeof state.maintenanceTokens === "number") ? state.maintenanceTokens : 2;
        let s, why;
        if (used === 0) { s = 55; why = "Never used a maintenance window — either well-defended already, or missed chances to harden."; }
        else if (left >= 0 && used <= 2) { s = 85; why = "Spent scarce maintenance windows deliberately, on moments that warranted them."; }
        else { s = 60; why = "Used maintenance windows, but without clear prioritisation."; }
        blueCats.push(cat("maintenance_husbandry", "Maintenance Husbandry", s, why));
      }
    }

    // Outcome (a contributing factor, not the whole score)
    {
      let s, why;
      if (winner === "blue") { s = 85; why = "Successfully defended the objective."; }
      else if (winner === "red" && winSeverity === "critical") { s = 10; why = "Worst-case loss — the objective was lost with catastrophic consequence."; }
      else if (winner === "red") { s = 35; why = "The objective was ultimately compromised."; }
      else { s = 60; why = "Game did not reach a decisive conclusion."; }
      blueCats.push(cat("outcome", "Outcome", s, why));
    }

    // ---------- RED (attackers) ----------
    const redCats = [];

    // Stealth discipline (managing footprint)
    {
      const stealth = stats.redStealthCards || 0;
      const noisy = stats.redNoisyActions || 0;
      // Reward stealth usage and penalise a high final detection meter
      let s = 50 + stealth * 12 - Math.max(0, detection - 50) / 2 - noisy * 3;
      redCats.push(cat("stealth_discipline", "Stealth Discipline",
        s,
        detection < 40 ? "Operated with strong footprint discipline — stayed well below the detection threshold."
        : detection < 70 ? "Managed footprint reasonably, but drew noticeable attention."
        : "Operated far too loudly — detection ran high and nearly gave the game away."));
    }

    // Tempo / decisiveness
    {
      const expiries = (stats.timerExpiries && stats.timerExpiries.red) || 0;
      const s = 100 - Math.min(100, expiries * 20);
      redCats.push(cat("tempo", "Tempo",
        s,
        expiries === 0 ? "Pressed the attack decisively on every turn."
        : expiries <= 2 ? "Kept up pressure, with occasional hesitation."
        : "Repeatedly stalled, ceding initiative to the defenders."));
    }

    if (isOT) {
      // Process pressure — how close Red drove the process
      {
        const peak = stats.peakProcessSafety || process;
        let s = peak; // higher peak = more effective process manipulation
        redCats.push(cat("process_pressure", "Process Pressure",
          s,
          peak >= 85 ? "Drove the process to the brink — a genuinely dangerous, well-executed campaign."
          : peak >= 50 ? "Applied real pressure to the physical process."
          : "Never seriously threatened the process — the physical attack lacked bite."));
      }
    }

    // Outcome
    {
      let s, why;
      if (winner === "red" && winSeverity === "critical") { s = 100; why = "Achieved the maximum objective — a physical-damage outcome."; }
      else if (winner === "red") { s = 85; why = "Successfully compromised the objective."; }
      else if (winner === "blue") { s = 25; why = "The intrusion was stopped before it succeeded."; }
      else { s = 55; why = "Game did not reach a decisive conclusion."; }
      redCats.push(cat("outcome", "Outcome", s, why));
    }

    // ---------- Aggregate ----------
    function aggregate(cats) {
      const avg = cats.reduce((sum, c) => sum + c.score, 0) / (cats.length || 1);
      return clamp(avg);
    }
    const blueOverall = aggregate(blueCats);
    const redOverall = aggregate(redCats);

    return {
      mode: state.mode || "it",
      winner,
      winReason: state.winReason || null,
      winSeverity,
      turnsPlayed,
      blue: { overall: blueOverall, band: band(blueOverall), categories: blueCats },
      red:  { overall: redOverall,  band: band(redOverall),  categories: redCats }
    };
  }

  /**
   * Build a self-contained HTML report (no external dependencies) for download.
   * @param {Object} state - final game state
   * @param {Object} [result] - optional precomputed scoreGame result
   * @returns {string} full HTML document
   */
  function buildReportHTML(state, result) {
    result = result || scoreGame(state);
    const modeLabel = result.mode === "ot" ? "OT / ICS Exercise" : "IT / ICT Exercise";
    const when = new Date().toLocaleString();
    const bandCol = (b) => b === "Strong" ? "#1a8f5e" : b === "Proficient" ? "#2b7fb8"
                        : b === "Developing" ? "#b7791f" : "#c0392b";

    function catRows(cats) {
      return cats.map(c => `
        <tr>
          <td class="cat">${esc(c.label)}</td>
          <td class="score" style="color:${bandCol(c.band)}"><strong>${c.score}</strong> <span class="band">${c.band}</span></td>
          <td class="rationale">${esc(c.rationale)}</td>
        </tr>`).join("");
    }

    function teamSection(label, colour, data) {
      return `
        <section class="team">
          <div class="team-head" style="border-color:${colour}">
            <h2>${esc(label)}</h2>
            <div class="overall" style="color:${bandCol(data.band)}">${data.band} &middot; ${data.overall}/100</div>
          </div>
          <table>
            <thead><tr><th>Category</th><th>Score</th><th>Assessment</th></tr></thead>
            <tbody>${catRows(data.categories)}</tbody>
          </table>
        </section>`;
    }

    // Simple move-log extract (chronological)
    let logRows = "";
    if (state.log) {
      const entries = Object.values(state.log)
        .filter(e => e && e.text)
        .sort((a,b) => (a.ts||0) - (b.ts||0));
      logRows = entries.map(e => `<li><span class="ts">${e.time || ""}</span> ${esc(e.text)}</li>`).join("");
    }

    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Exercise Report — ${esc(modeLabel)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color:#1c2530; margin:0; background:#f4f6f9; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 28px 60px; }
  header.top { border-bottom: 3px solid #1f3864; padding-bottom: 16px; margin-bottom: 24px; }
  header.top h1 { margin: 0 0 4px; color:#1f3864; font-size: 24px; letter-spacing: 0.02em; }
  header.top .sub { color:#5a6675; font-size: 14px; }
  .meta { display:flex; flex-wrap:wrap; gap: 18px; margin: 14px 0 26px; font-size: 13px; color:#425064; }
  .meta b { color:#1c2530; }
  .outcome { background:#fff; border:1px solid #d8e0ea; border-left:5px solid #1f3864; border-radius:8px; padding:14px 18px; margin-bottom:26px; }
  .outcome .r { font-size: 14px; color:#333; }
  .outcome .w { font-weight:800; font-size: 15px; margin-bottom: 4px; }
  .critical { border-left-color:#c0392b; }
  section.team { background:#fff; border:1px solid #d8e0ea; border-radius:8px; margin-bottom: 22px; overflow:hidden; }
  .team-head { display:flex; justify-content:space-between; align-items:baseline; padding:14px 18px; border-bottom:3px solid #1f3864; }
  .team-head h2 { margin:0; font-size:17px; color:#1c2530; }
  .overall { font-weight:800; font-size:16px; }
  table { width:100%; border-collapse:collapse; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:0.05em; color:#7a8798; padding:10px 18px; background:#f8fafc; border-bottom:1px solid #e4e9f0; }
  td { padding:11px 18px; font-size:13px; border-bottom:1px solid #eef2f6; vertical-align:top; }
  td.cat { font-weight:700; width:180px; color:#2a3542; }
  td.score { width:120px; white-space:nowrap; }
  td.score .band { font-size:11px; font-weight:700; }
  td.rationale { color:#425064; line-height:1.45; }
  .logwrap { background:#fff; border:1px solid #d8e0ea; border-radius:8px; padding:14px 18px; }
  .logwrap h3 { margin:0 0 10px; font-size:14px; color:#1f3864; }
  ul.log { list-style:none; margin:0; padding:0; max-height:340px; overflow:auto; font-size:12px; color:#3a4756; }
  ul.log li { padding:4px 0; border-bottom:1px solid #f0f3f7; line-height:1.4; }
  ul.log .ts { color:#9aa7b5; font-variant-numeric:tabular-nums; margin-right:6px; }
  footer { margin-top:30px; text-align:center; color:#9aa7b5; font-size:11px; }
  @media print {
    @page { size: A4; margin: 14mm 12mm; }
    body { background:#fff; }
    .wrap { max-width:none; padding: 0; }
    section.team, .outcome, .logwrap { break-inside: avoid; page-break-inside: avoid; }
    header.top { break-after: avoid; }
    ul.log { max-height: none; overflow: visible; }
  }
</style></head>
<body><div class="wrap">
  <header class="top">
    <h1>Critical Infrastructure Simulation — Exercise Report</h1>
    <div class="sub">${esc(modeLabel)}</div>
  </header>
  <div class="meta">
    <span><b>Generated:</b> ${esc(when)}</span>
    <span><b>Turns played:</b> ${result.turnsPlayed}</span>
    <span><b>Final detection:</b> ${state.detectionMeter || 0}%</span>
    ${result.mode === "ot" ? `<span><b>Peak process safety:</b> ${(state.stats && state.stats.peakProcessSafety) || state.processSafety || 0}%</span>` : ""}
    ${result.mode === "ot" ? `<span><b>Safe-state trip:</b> ${state.safeStateTripped ? "Yes" : "No"}</span>` : ""}
  </div>
  <div class="outcome ${result.winSeverity === "critical" ? "critical" : ""}">
    <div class="w">${result.winner ? (result.winner === "blue" ? "Defenders (Blue) prevailed" : "Attackers (Red) prevailed") : "No decisive outcome"}</div>
    <div class="r">${esc(result.winReason || "")}</div>
  </div>
  ${teamSection("Defenders (Blue)", "#2b7fb8", result.blue)}
  ${teamSection("Attackers (Red)", "#c0392b", result.red)}
  <div class="logwrap">
    <h3>Session Log</h3>
    <ul class="log">${logRows || "<li>No log entries recorded.</li>"}</ul>
  </div>
  <footer>Critical Infrastructure Simulation Board &middot; Assessment Report &middot; Decision-quality weighted scoring</footer>
</div></body></html>`;
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  return { scoreGame, band, buildReportHTML };
})();

if (typeof module !== "undefined" && module.exports) {
  module.exports = Assessment;
}
