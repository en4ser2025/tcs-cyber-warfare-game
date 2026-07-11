/* ============================================================
   CYBER GRID :: GAME DATA
   Piece rosters, ranks, and the scenario card library.
   Shared by index.html (board) and admin.html (control panel)
   via a plain <script> include (no build step / bundler needed).
   ============================================================ */

// ----------------------------------------------------------------
// PIECE RANKS
// Higher number = higher rank. Classic Stratego-style hierarchy,
// re-skinned as a cyber org chart. Rank sets the BASE odds in a
// confrontation; the scenario card played then modifies that
// base via its `modifier`, and the admin makes the final call.
// ----------------------------------------------------------------

const RANK = {
  INTEL:     1,  // Scout-equivalent: fast, weak, great at recon
  ANALYST:   2,
  SYSADMIN:  3,
  ENGINEER:  4,
  RESPONDER: 5,
  SOC_LEAD:  6,
  CISO:      7,
  FIREWALL:  8,  // Bomb-equivalent (defenders only): kills most attackers, dies to EXPLOIT
  HONEYPOT:  9,  // Special trap piece (defenders only)
  SERVER:    0   // The Flag-equivalent objective (defenders only) — capture = game over
};

// ----------------------------------------------------------------
// DEFENDER (BLUE) ROSTER
// ----------------------------------------------------------------
const BLUE_PIECES = [
  {
    id: "srv", name: "Critical Server", short: "SRV", rank: RANK.SERVER,
    count: 1, nature: "system", icon: "server", isObjective: true, movable: false,
    flavor: "The objective. If breached and not detected in time, the grid goes dark."
  },
  {
    id: "fw", name: "Firewall", short: "FW", rank: RANK.FIREWALL,
    count: 2, nature: "system", icon: "firewall", movable: true,
    flavor: "Stops nearly everything cold. Only a zero-day EXPLOIT gets through."
  },
  {
    id: "honeypot", name: "Honeypot", short: "HP", rank: RANK.HONEYPOT,
    count: 2, nature: "system", icon: "honeypot", movable: true, special: "trap",
    flavor: "Looks weak. Lures attackers in, then quietly identifies and traps them."
  },
  {
    id: "ciso", name: "CISO", short: "CISO", rank: RANK.CISO,
    count: 1, nature: "human", icon: "ciso", movable: true,
    flavor: "Top brass. Out-ranks almost every threat actor."
  },
  {
    id: "soc", name: "SOC Lead", short: "SOC", rank: RANK.SOC_LEAD,
    count: 2, nature: "human", icon: "soc", movable: true,
    flavor: "Runs the security operations center. Sharp eyes, sharp instincts."
  },
  {
    id: "responder", name: "Incident Responder", short: "IR", rank: RANK.RESPONDER,
    count: 3, nature: "human", icon: "responder", movable: true,
    flavor: "First on scene when something breaks."
  },
  {
    id: "engineer", name: "Security Engineer", short: "ENG", rank: RANK.ENGINEER,
    count: 3, nature: "human", icon: "engineer", movable: true,
    flavor: "Builds and hardens the defenses."
  },
  {
    id: "sysadmin", name: "Sysadmin", short: "SYS", rank: RANK.SYSADMIN,
    count: 3, nature: "human", icon: "sysadmin", movable: true,
    flavor: "Keeps the lights on. Patches, backups, access control."
  },
  {
    id: "analyst", name: "SOC Analyst", short: "AN", rank: RANK.ANALYST,
    count: 4, nature: "human", icon: "analyst", movable: true,
    flavor: "Tier-1 eyes on glass. Numerous, but easily overrun."
  },
  {
    id: "intel", name: "Threat Intel", short: "TI", rank: RANK.INTEL,
    count: 3, nature: "human", icon: "intel", movable: true, special: "recon",
    flavor: "Fast and weak, but can safely peek at an adjacent unrevealed piece."
  }
];

// ----------------------------------------------------------------
// ATTACKER (RED) ROSTER
// ----------------------------------------------------------------
const RED_PIECES = [
  {
    id: "exploit", name: "Zero-Day Exploit", short: "0DAY", rank: RANK.FIREWALL + 1,
    count: 1, nature: "technical", icon: "exploit", movable: true, special: "firewall-killer",
    flavor: "The only thing in the game that beats a Firewall outright."
  },
  {
    id: "apt", name: "APT Operator", short: "APT", rank: RANK.CISO,
    count: 1, nature: "human", icon: "apt", movable: true,
    flavor: "Advanced Persistent Threat. Patient, skilled, dangerous to everyone but the top brass."
  },
  {
    id: "botmaster", name: "Botnet Master", short: "BOT", rank: RANK.SOC_LEAD,
    count: 2, nature: "human", icon: "botmaster", movable: true,
    flavor: "Commands distributed swarms. Hard to pin down."
  },
  {
    id: "ransomware", name: "Ransomware Op", short: "RW", rank: RANK.RESPONDER,
    count: 3, nature: "technical", icon: "ransomware", movable: true,
    flavor: "Encrypts, then negotiates. Brutal but not untouchable."
  },
  {
    id: "insider", name: "Insider Threat", short: "INS", rank: RANK.ENGINEER,
    count: 2, nature: "human", icon: "insider", movable: true, special: "disguise",
    flavor: "Already has legitimate access. Hard to distinguish from staff."
  },
  {
    id: "socialeng", name: "Social Engineer", short: "SE", rank: RANK.SYSADMIN,
    count: 3, nature: "human", icon: "socialeng", movable: true,
    flavor: "Talks their way past people, not firewalls."
  },
  {
    id: "phisher", name: "Phishing Crew", short: "PH", rank: RANK.ANALYST,
    count: 4, nature: "human", icon: "phisher", movable: true,
    flavor: "Casts a wide net. Numerous and disposable."
  },
  {
    id: "scanner", name: "Recon Scanner", short: "SCN", rank: RANK.INTEL,
    count: 4, nature: "technical", icon: "scanner", movable: true, special: "recon",
    flavor: "Fast, weak, built for mapping the attack surface before committing forces."
  }
];

// ----------------------------------------------------------------
// SCENARIO CARD LIBRARY
// Each card has:
//   side: 'blue' | 'red' | 'both'   which team may play it
//   type: 'move' | 'engage' | 'special'
//   difficulty: 1 (easy) - 5 (hard)  -> informs base success %
//   modifier: applied to the rank-vs-rank base odds in a clash
//   detectionRisk: how much playing this raises the Red detection meter
//   description: shown to players on the public board (flavor copy)
//   adminNotes: guidance for the admin when adjudicating
// ----------------------------------------------------------------
const SCENARIO_CARDS = [
  // ---- RED (Attacker) scenario cards ----
  {
    id: "r_phish_campaign", side: "red", type: "engage", name: "Phishing Campaign",
    difficulty: 2, modifier: +5, detectionRisk: 10,
    description: "Send a crafted phishing wave to gain a foothold on the target segment.",
    adminNotes: "Base roll + modifier. Low detection cost if it fails quietly."
  },
  {
    id: "r_lateral_move", side: "red", type: "move", name: "Lateral Movement",
    difficulty: 2, modifier: 0, detectionRisk: 15,
    description: "Pivot from a compromised host to an adjacent segment.",
    adminNotes: "Standard move. Detection risk scales if Blue has Threat Intel nearby."
  },
  {
    id: "r_privesc", side: "red", type: "engage", name: "Privilege Escalation",
    difficulty: 3, modifier: +10, detectionRisk: 20,
    description: "Escalate access rights to overpower a stronger defender.",
    adminNotes: "Good vs equal/slightly-higher rank defenders. Noisy if it fails."
  },
  {
    id: "r_ddos", side: "red", type: "engage", name: "DDoS Smokescreen",
    difficulty: 1, modifier: -10, detectionRisk: 5,
    description: "Flood traffic to distract the SOC while another unit advances.",
    adminNotes: "Weak in direct combat but very low detection cost — use as a decoy play."
  },
  {
    id: "r_zeroday", side: "red", type: "engage", name: "Deploy Zero-Day",
    difficulty: 5, modifier: +30, detectionRisk: 35,
    description: "Burn a zero-day exploit. Devastating, but expensive and loud.",
    adminNotes: "Only the Exploit piece should realistically play this. High detection on success or fail."
  },
  {
    id: "r_socialeng", side: "red", type: "engage", name: "Social Engineering Pretext",
    difficulty: 2, modifier: +8, detectionRisk: 8,
    description: "Impersonate IT support to manipulate a staff member into compliance.",
    adminNotes: "Quiet if successful; only mild noise if it fails."
  },
  {
    id: "r_insider_access", side: "red", type: "special", name: "Insider Access",
    difficulty: 3, modifier: +15, detectionRisk: 5,
    description: "Use already-legitimate credentials to slip past a checkpoint unchallenged.",
    adminNotes: "Very low detection risk — this is the Insider Threat piece's signature play."
  },
  {
    id: "r_ransomware_deploy", side: "red", type: "engage", name: "Deploy Ransomware",
    difficulty: 4, modifier: +12, detectionRisk: 25,
    description: "Encrypt assets on the target node to force it offline.",
    adminNotes: "Strong but loud. Good finishing move once close to the Server."
  },
  {
    id: "r_recon_scan", side: "red", type: "special", name: "Recon Sweep",
    difficulty: 1, modifier: 0, detectionRisk: 3,
    description: "Passively probe an adjacent square to learn what's guarding it, without engaging.",
    adminNotes: "No combat. Admin privately tells the Red admin-side the rank tier (not identity) of the adjacent piece."
  },
  {
    id: "r_breach_server", side: "red", type: "engage", name: "Breach the Server",
    difficulty: 4, modifier: +15, detectionRisk: 40,
    description: "The final play — attempt to take down the Critical Server directly.",
    adminNotes: "Only valid when adjacent to the Server piece. Success with detection meter below threshold = RED WINS. Success with detection meter maxed = breach is caught in progress, BLUE WINS."
  },

  // ---- BLUE (Defender) scenario cards ----
  {
    id: "b_patch_harden", side: "blue", type: "engage", name: "Patch & Harden",
    difficulty: 2, modifier: +10, detectionRisk: 0,
    description: "Rapidly patch the targeted system and reinforce its defenses before contact.",
    adminNotes: "Good defensive boost when Blue suspects an imminent attack on this square."
  },
  {
    id: "b_threat_hunt", side: "blue", type: "special", name: "Threat Hunt",
    difficulty: 2, modifier: 0, detectionRisk: 0,
    description: "Proactively investigate a suspicious adjacent square.",
    adminNotes: "No combat. Admin privately reveals the rank tier of an adjacent unrevealed Red piece to the Blue admin-side."
  },
  {
    id: "b_isolate_segment", side: "blue", type: "engage", name: "Isolate Segment",
    difficulty: 3, modifier: +15, detectionRisk: 0,
    description: "Quarantine the network segment to cut off an advancing threat.",
    adminNotes: "Strong vs lateral movement plays. Effectively boosts the defending piece's odds."
  },
  {
    id: "b_incident_response", side: "blue", type: "engage", name: "Incident Response",
    difficulty: 3, modifier: +10, detectionRisk: 0,
    description: "Mobilize the IR team to actively repel the intrusion in progress.",
    adminNotes: "Use when defending a square under direct attack this turn."
  },
  {
    id: "b_deploy_honeypot", side: "blue", type: "special", name: "Bait the Trap",
    difficulty: 2, modifier: +20, detectionRisk: 0,
    description: "Activate a Honeypot's lure — any attacker engaging it is automatically identified.",
    adminNotes: "Only relevant when the Honeypot piece is the defender in the clash. Forces an attacker reveal regardless of outcome."
  },
  {
    id: "b_lockdown", side: "blue", type: "engage", name: "Emergency Lockdown",
    difficulty: 4, modifier: +20, detectionRisk: 0,
    description: "Hard lockdown of the segment — risky to operations, very effective defensively.",
    adminNotes: "Best emergency play when an attacker is one square from the Server."
  },
  {
    id: "b_raise_alert", side: "blue", type: "special", name: "Raise SOC Alert Level",
    difficulty: 1, modifier: 0, detectionRisk: 0,
    description: "Escalate the org-wide alert posture, raising the detection meter floor for this turn.",
    adminNotes: "No combat. Admin increases the detection meter by a flat amount (suggest +10)."
  },
  {
    id: "b_forensics", side: "blue", type: "special", name: "Digital Forensics",
    difficulty: 3, modifier: 0, detectionRisk: 0,
    description: "Examine a piece that was just involved in a clash to confirm its true identity.",
    adminNotes: "No combat. Use after any engagement — admin reveals the involved Red piece's identity publicly."
  },
  {
    id: "b_backup_restore", side: "blue", type: "special", name: "Backup & Restore",
    difficulty: 2, modifier: 0, detectionRisk: 0,
    description: "If a defending piece was just lost, restore a fallback unit to an adjacent friendly square.",
    adminNotes: "Use sparingly — recommend max once per game. Admin places a previously-eliminated low-rank Blue piece back on the board."
  },
  {
    id: "b_counter_intel", side: "blue", type: "engage", name: "Counter-Intelligence",
    difficulty: 3, modifier: +12, detectionRisk: 0,
    description: "Feed false information to confuse an advancing threat actor's targeting.",
    adminNotes: "Good vs Recon Scanner or Insider Threat plays specifically."
  }
];

// ----------------------------------------------------------------
// BOARD CONSTANTS
// ----------------------------------------------------------------
const BOARD_SIZE = 8;

// Row indices (0 = Red's back row .. 7 = Blue's back row)
const BLUE_SETUP_ROWS = [5, 6, 7];   // Blue deploys in these rows
const RED_SETUP_ROWS  = [0, 1, 2];   // Red deploys in these rows
const NEUTRAL_ROWS    = [3, 4];      // No-man's land / DMZ

// Detection meter: when it reaches DETECTION_MAX, SOC catches the
// intrusion in progress -> Blue wins immediately regardless of position.
const DETECTION_MAX = 100;

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    RANK, BLUE_PIECES, RED_PIECES, SCENARIO_CARDS,
    BOARD_SIZE, BLUE_SETUP_ROWS, RED_SETUP_ROWS, NEUTRAL_ROWS, DETECTION_MAX
  };
}
