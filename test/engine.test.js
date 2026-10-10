const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../engine.js");

const csv = fs.readFileSync(path.join(__dirname, "..", "data", "sample-players.csv"), "utf8");
const players = E.parseCsv(csv);
const league = { teams: 10, slot: 1, rounds: 16 };
const state = (taken = [], mine = []) => ({ players, takenNames: new Set(taken), mineNames: new Set(mine) });
const P = (name, pos, extra = {}) => Object.assign({ name, pos, team: "T", bye: null, adp: null, proj: 100, status: "" }, extra);

test("parses the sample CSV", () => {
  assert.ok(players.length > 150);
  assert.ok(players.every((p) => p.name && p.pos && typeof p.proj === "number"));
});

test("CSV with headers in a different order and quoted names", () => {
  const out = E.parseCsv('Proj,Player,Position\n201.5,"Doe, Jane",wr\n99,Sam Roe,DEF');
  assert.deepStrictEqual(out.map((p) => [p.name, p.pos, p.proj]), [["Doe, Jane", "WR", 201.5], ["Sam Roe", "DST", 99]]);
});

test("CSV without required columns throws a clear error", () => {
  assert.throws(() => E.parseCsv("name,team\nA,B"), /name, pos and proj/);
});

test("snake pick numbers for first and middle slots", () => {
  assert.deepStrictEqual(E.myPicks({ teams: 10, slot: 1, rounds: 4 }), [1, 20, 21, 40]);
  assert.deepStrictEqual(E.myPicks({ teams: 10, slot: 3, rounds: 3 }), [3, 18, 23]);
});

test("chance available falls as the pick passes a player's ADP", () => {
  const p = { adp: 40 };
  assert.ok(E.chanceAvailable(p, 20) > 0.9);
  assert.ok(E.chanceAvailable(p, 60) < 0.1);
  assert.ok(Math.abs(E.chanceAvailable(p, 40) - 0.5) < 0.02);
});

test("first overall pick is a top running back or receiver", () => {
  const ev = E.evaluate(state(), league);
  assert.strictEqual(ev.yourPick, 1);
  assert.ok(["RB", "WR"].includes(ev.pick.player.pos));
});

test("never suggests a kicker or defense before the last two picks", () => {
  const ev = E.evaluate(state(), league);
  const top = ev.ranked.slice(0, 40).map((r) => r.player.pos);
  assert.ok(!top.includes("K") && !top.includes("DST"));
});

test("suggests a kicker or defense in the last two picks", () => {
  const mini = [P("K1", "K", { proj: 130 }), P("D1", "DST", { proj: 120 }), P("R1", "RB", { proj: 90 }), P("R2", "RB", { proj: 80 })];
  const ev = E.evaluate({ players: mini, takenNames: new Set(), mineNames: new Set(), currentPick: 20 }, { teams: 10, slot: 1, rounds: 3 });
  assert.ok(["K", "DST"].includes(ev.pick.player.pos));
});

test("prefers the player who will be gone over a similar one who will last", () => {
  const mini = [
    P("Lasts", "WR", { proj: 200, adp: 120 }),
    P("Gone", "WR", { proj: 196, adp: 25 }),
    P("Filler1", "WR", { proj: 60 }), P("Filler2", "WR", { proj: 55 }),
  ];
  const ev = E.evaluate({ players: mini, takenNames: new Set(), mineNames: new Set(), currentPick: 20 }, league);
  assert.strictEqual(ev.pick.player.name, "Gone");
  assert.ok(ev.canWait.some((r) => r.player.name === "Lasts"));
});

test("injured players are marked down", () => {
  const mini = [P("Healthy", "WR", { proj: 200 }), P("Hurt", "WR", { proj: 205, status: "O" }), P("F", "WR", { proj: 50 })];
  const ev = E.evaluate({ players: mini, takenNames: new Set(), mineNames: new Set() }, league);
  assert.strictEqual(ev.ranked[0].player.name, "Healthy");
});

test("bye-week stacking lowers a close call", () => {
  const mini = [
    P("Mine1", "RB", { bye: 9 }), P("Mine2", "WR", { bye: 9 }),
    P("SameBye", "WR", { proj: 200, bye: 9 }), P("OtherBye", "WR", { proj: 196, bye: 6 }), P("F", "WR", { proj: 40 }),
  ];
  const ev = E.evaluate({ players: mini, takenNames: new Set(), mineNames: new Set(["Mine1", "Mine2"]) }, league);
  assert.strictEqual(ev.ranked[0].player.name, "OtherBye");
});

test("after filling QB, more quarterbacks drop down the list", () => {
  const qb = players.find((p) => p.pos === "QB");
  const ev = E.evaluate(state([], [qb.name]), league);
  const firstQbIndex = ev.ranked.findIndex((r) => r.player.pos === "QB");
  assert.ok(firstQbIndex > 15);
});

test("matchNames finds drafted players in pasted text, ignoring suffixes and punctuation", () => {
  const list = [P("Jane Doe Jr.", "WR"), P("Sam O'Neil", "RB"), P("Al Ray", "TE")];
  const found = E.matchNames("Last pick: jane doe, WR\nSam ONeil - RB (bye 7)", list);
  assert.deepStrictEqual(found.sort(), ["Jane Doe Jr.", "Sam O'Neil"]);
});

test("queue builder returns a numbered list of available players", () => {
  const q = E.buildQueue(state([players[0].name]), league, 10);
  assert.strictEqual(q.length, 10);
  assert.match(q[0], /^1\. .+ \((RB|WR|TE|QB)\)$/);
  assert.ok(!q.join(" ").includes(players[0].name + " ("));
});

test("full simulated drafts from every slot produce a balanced roster", () => {
  for (let slot = 1; slot <= 10; slot++) {
    const lg = { teams: 10, slot, rounds: 16 };
    const mine = new Set(E.myPicks(lg));
    const taken = new Set(), me = new Set();
    for (let pick = 1; pick <= 160; pick++) {
      if (mine.has(pick)) {
        me.add(E.evaluate({ players, takenNames: taken, mineNames: me, currentPick: pick }, lg).pick.player.name);
      } else {
        const next = players.filter((p) => !taken.has(p.name) && !me.has(p.name)).sort((a, b) => a.adp - b.adp)[0];
        taken.add(next.name);
      }
    }
    const c = {};
    for (const n of me) { const p = players.find((x) => x.name === n); c[p.pos] = (c[p.pos] || 0) + 1; }
    assert.strictEqual(me.size, 16, "slot " + slot);
    assert.ok(c.QB >= 1 && c.QB <= 2, "QB count slot " + slot);
    assert.ok(c.TE >= 1 && c.TE <= 2, "TE count slot " + slot);
    assert.ok(c.RB >= 3 && c.WR >= 3, "RB/WR depth slot " + slot);
    assert.strictEqual(c.K, 1, "K slot " + slot);
    assert.strictEqual(c.DST, 1, "DST slot " + slot);
  }
});
