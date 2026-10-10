/*
 * Snake Draft Copilot - draft engine (no dependencies).
 * Works in the browser (window.DraftEngine) and in Node (require).
 *
 * Ideas it encodes:
 *  - Value over replacement: points above the last starter-level player at that position.
 *  - Roster need: fill starters first, then FLEX, then bench. K and D/ST wait for the last two picks.
 *  - "Will he last?": ADP-based chance a player is still there at your next pick, so you can
 *    take the player who will be gone and wait on the one who will not.
 *  - Bye-week stacking and injury status lower a player's score.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.DraftEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const POSITIONS = ["QB", "RB", "WR", "TE", "K", "DST"];
  const FLEX_POS = ["RB", "WR", "TE"];
  const INJURY_FACTOR = { "": 1, Q: 0.92, D: 0.88, DTD: 0.9, O: 0.6, OUT: 0.6, IR: 0.3, SUSP: 0.5 };

  const DEFAULT_LEAGUE = {
    teams: 10,
    slot: 1,
    rounds: 16,
    starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, DST: 1 },
    currentWeek: null,
  };

  // ---------- small helpers ----------
  function normalizeName(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[.'’`-]/g, "")
      .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, "")
      .replace(/[^a-z0-9 ]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function normalizePos(p) {
    const s = String(p || "").toUpperCase().replace(/[^A-Z]/g, "");
    if (s === "DST" || s === "DEF" || s === "D") return "DST";
    if (s === "PK") return "K";
    return s;
  }

  // Standard normal CDF (Abramowitz-Stegun approximation).
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp((-z * z) / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }

  // ---------- CSV parsing ----------
  // Accepts headers in any order. Recognised (case-insensitive): name/player, pos/position,
  // team, bye, adp, proj/projection/points, status/injury.
  function parseCsv(text) {
    const lines = String(text || "").split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) return [];
    const split = (line) => {
      const out = [];
      let cur = "", q = false;
      for (const ch of line) {
        if (ch === '"') q = !q;
        else if (ch === "," && !q) { out.push(cur); cur = ""; }
        else cur += ch;
      }
      out.push(cur);
      return out.map((c) => c.trim());
    };
    const head = split(lines[0]).map((h) => h.toLowerCase());
    const idx = (names) => head.findIndex((h) => names.includes(h));
    const col = {
      name: idx(["name", "player"]),
      pos: idx(["pos", "position"]),
      team: idx(["team"]),
      bye: idx(["bye", "bye week"]),
      adp: idx(["adp"]),
      proj: idx(["proj", "projection", "points", "proj pts"]),
      status: idx(["status", "injury"]),
    };
    if (col.name < 0 || col.pos < 0 || col.proj < 0) {
      throw new Error("CSV needs at least name, pos and proj columns.");
    }
    const players = [];
    for (const line of lines.slice(1)) {
      const c = split(line);
      const name = c[col.name];
      if (!name) continue;
      const num = (i) => (i >= 0 && c[i] !== "" && !isNaN(+c[i]) ? +c[i] : null);
      players.push({
        name,
        pos: normalizePos(c[col.pos]),
        team: col.team >= 0 ? c[col.team] : "",
        bye: num(col.bye),
        adp: num(col.adp),
        proj: num(col.proj) || 0,
        status: col.status >= 0 ? String(c[col.status] || "").toUpperCase() : "",
      });
    }
    return players;
  }

  // ---------- draft math ----------
  function myPicks(league) {
    const { teams, slot, rounds } = league;
    const picks = [];
    for (let r = 1; r <= rounds; r++) picks.push((r - 1) * teams + (r % 2 ? slot : teams - slot + 1));
    return picks;
  }

  function nextPicks(league, currentPick) {
    return myPicks(league).filter((p) => p >= currentPick);
  }

  // Chance a player is still on the board at overall pick `pick`.
  function chanceAvailable(player, pick) {
    if (player.adp == null) return 0.5;
    const sd = Math.max(3, player.adp * 0.22);
    return 1 - normCdf((pick - player.adp) / sd);
  }

  // Baseline per position: projected points of roughly the last player at that position who
  // gets drafted in a league like yours ("waiver level"). Value = points above that baseline.
  function draftableCount(pos, league) {
    const s = league.starters;
    const startersTotal = Object.values(s).reduce((a, b) => a + b, 0);
    const bench = Math.max(0, league.rounds - startersTotal);
    if (pos === "QB" || pos === "TE") return league.teams * (s[pos] || 1) * 1.5;
    if (pos === "K" || pos === "DST") return league.teams * (s[pos] || 1);
    // RB and WR split the FLEX spot and most bench spots between them.
    return league.teams * ((s[pos] || 0) + (s.FLEX || 0) / 2 + (bench * 0.8) / 2);
  }

  function replacementLevels(players, league) {
    const levels = {};
    for (const pos of POSITIONS) {
      const pool = players.filter((p) => p.pos === pos).map((p) => p.proj).sort((a, b) => b - a);
      const i = Math.max(0, Math.round(draftableCount(pos, league)) - 1);
      levels[pos] = pool.length ? pool[Math.min(i, pool.length - 1)] : 0;
    }
    return levels;
  }

  function rosterCounts(roster) {
    const c = {};
    for (const p of roster) c[p.pos] = (c[p.pos] || 0) + 1;
    return c;
  }

  function needFactor(player, roster, league, picksLeft) {
    const s = league.starters;
    const c = rosterCounts(roster);
    const have = c[player.pos] || 0;
    if (player.pos === "K" || player.pos === "DST") {
      if (have >= (s[player.pos] || 1)) return { f: 0.02, why: "already have one" };
      return picksLeft <= 2 ? { f: 50, why: "last picks: take one now" } : { f: 0.02, why: "wait for your last 2 picks" };
    }
    if (have < (s[player.pos] || 0)) return { f: 1, why: "fills a starting " + player.pos + " spot" };
    if (FLEX_POS.includes(player.pos)) {
      const extra = FLEX_POS.reduce((n, p) => n + Math.max(0, (c[p] || 0) - (s[p] || 0)), 0);
      if (extra < (s.FLEX || 0)) return { f: 0.85, why: "fills your FLEX spot" };
    }
    if (player.pos === "QB" || player.pos === "TE") {
      return have >= 2 ? { f: 0.03, why: "you already have two" } : { f: 0.3, why: "backup " + player.pos };
    }
    // Bench RB/WR: worth less the more you already stack at that position.
    const extraAtPos = have - (s[player.pos] || 0);
    return { f: Math.max(0.2, 0.6 - 0.08 * extraAtPos), why: "bench depth" };
  }

  function byePenalty(player, roster) {
    if (player.bye == null) return { f: 1, note: "" };
    const same = roster.filter((r) => r.bye === player.bye && r.pos !== "K" && r.pos !== "DST").length;
    if (!same) return { f: 1, note: "" };
    return { f: Math.max(0.8, 1 - 0.05 * same), note: "bye " + player.bye + " matches " + same + " of your players" };
  }

  /*
   * Score every available player for your next pick.
   * state = { players, takenNames:Set, mineNames:Set, currentPick }
   */
  function evaluate(state, league) {
    league = Object.assign({}, DEFAULT_LEAGUE, league);
    const { players, takenNames, mineNames } = state;
    const currentPick = state.currentPick || takenNames.size + mineNames.size + 1;
    const roster = players.filter((p) => mineNames.has(p.name));
    const available = players.filter((p) => !takenNames.has(p.name) && !mineNames.has(p.name));
    const repl = replacementLevels(players, league);
    const upcoming = nextPicks(league, currentPick);
    const yourPick = upcoming[0];
    const after = upcoming[1];
    const picksLeft = upcoming.length;

    const rows = available.map((p) => {
      const need = needFactor(p, roster, league, picksLeft);
      const vor = p.proj - repl[p.pos];
      const base = Math.max(vor, 0) + p.proj * 0.02; // small tie-breaker on raw points
      const inj = INJURY_FACTOR[p.status] != null ? INJURY_FACTOR[p.status] : 1;
      const bye = byePenalty(p, roster);
      const score = base * need.f * inj * bye.f;
      const lastsToNext = after ? chanceAvailable(p, after) : 0;
      const notes = [need.why];
      if (p.status) notes.push("injury: " + p.status);
      if (bye.note) notes.push(bye.note);
      if (league.currentWeek && p.bye === league.currentWeek) notes.push("on bye this week");
      return { player: p, score, vor, lastsToNext, notes };
    });
    rows.sort((a, b) => b.score - a.score);

    // "Take now": among players within 12% of the best score, prefer the one least likely to last.
    let pick = rows[0] || null;
    if (pick && after) {
      const close = rows.filter((r) => r.score >= rows[0].score * 0.88);
      pick = close.reduce((best, r) => (r.lastsToNext < best.lastsToNext ? r : best), close[0]);
    }
    const canWait = rows
      .filter((r) => r !== pick && r.score >= (pick ? pick.score * 0.75 : 0) && r.lastsToNext >= 0.6)
      .slice(0, 3);

    return { currentPick, yourPick, nextAfter: after, picksLeft, roster, ranked: rows, pick, canWait };
  }

  // Ordered list you can paste into the ESPN (or any) queue.
  function buildQueue(state, league, size) {
    const ev = evaluate(state, league);
    const n = size || 15;
    return ev.ranked.slice(0, n).map((r, i) => i + 1 + ". " + r.player.name + " (" + r.player.pos + ")");
  }

  // Find which known players are named in any pasted text (draft board, chat, etc.).
  function matchNames(text, players) {
    const hay = " " + normalizeName(text) + " ";
    const found = [];
    for (const p of players) {
      const n = normalizeName(p.name);
      if (n && hay.includes(" " + n + " ")) found.push(p.name);
    }
    return found;
  }

  return {
    DEFAULT_LEAGUE,
    normalizeName,
    parseCsv,
    myPicks,
    nextPicks,
    chanceAvailable,
    replacementLevels,
    evaluate,
    buildQueue,
    matchNames,
  };
});
