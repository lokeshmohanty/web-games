#!/usr/bin/env node
/**
 * test-bubble-rush.mjs — the flight of a bubble, scoring, the host's judgement
 * of a tap, the round as the platform runs it, and bots, with no field drawn.
 *
 *   node bubble-rush/test-bubble-rush.mjs
 *
 * Every phone draws every bubble from the round clock, so a bubble must be
 * fixed when it spawns, and the same seed must spawn the same field. The host
 * is the only judge of a tap, so the judging is tested hard: a tap on empty
 * field, on a bubble already popped, from too far back in time. And the whole
 * round is plain JSON, so the heir's copy must carry on exactly as the host
 * would have.
 */
import { readFileSync } from "node:fs";

// The rules alone: no document, no platform.
new Function(readFileSync(new URL("./bubble-rush-rules.js", import.meta.url), "utf8"))();
const R = globalThis.bubbleRushRules;
const {
	ROUND_MS, COUNT_MS, FRENZY_MS, HZ, STUN_MS, STREAK_MS, LAG_MS, LEAD_MS, BOT_EVERY_MS, TAPS_PER_TICK,
	rngFrom, riseMs, bombChance, spawnInterval, makeBubble, pack, unpack, progress, position, alive, multiplier, popPoints,
	hitTest, teamScores, ranking, teamRanking, botPick, game,
} = R;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};
const clone = (v) => JSON.parse(JSON.stringify(v));
const dt = 1 / HZ;

/** A whole round's spawns, as the host makes them. */
function field(seed, mode, players = 2) {
	const rng = rngFrom(seed);
	const out = [];
	for (let t = 0, id = 1; t < ROUND_MS; t += spawnInterval(t, players)) out.push(makeBubble(rng, id++, t, mode));
	return out;
}

// ---------------------------------------------------------------------------
console.log("\nthe seed");

{
	const a = field(7, "ffa");
	check("the same seed spawns the same round", JSON.stringify(a) === JSON.stringify(field(7, "ffa")));
	check("another seed spawns another", JSON.stringify(a) !== JSON.stringify(field(8, "ffa")));
	const back = a.map((b) => unpack(pack(b)));
	check("a bubble survives the wire's packing unchanged", JSON.stringify(back) === JSON.stringify(a));
}

// ---------------------------------------------------------------------------
console.log("\na bubble's flight");

{
	const b = { id: 1, k: "n", s: 1, team: null, r: 0.05, pts: 20, born: 1000, dur: 4000, x0: 0.5, amp: 0.04, freq: 2, ph: 0 };
	check("not yet there before it is born", !alive(b, 999));
	check("there from birth to the top", alive(b, 1000) && alive(b, 3000) && alive(b, 5000));
	check("gone after", !alive(b, 5001));
	check("starts below the field", position(b, 1000).y > 1);
	check("ends above it", position(b, 5000).y < 0);
	check("rises steadily", position(b, 2000).y > position(b, 3000).y && position(b, 3000).y > position(b, 4000).y);
	const xs = Array.from({ length: 41 }, (_, i) => position(b, 1000 + i * 100).x);
	check("wobbles within its amplitude", xs.every((x) => Math.abs(x - 0.5) <= 0.04 + 1e-9) && Math.max(...xs) - Math.min(...xs) > 0.06);
	check("progress runs 0 → 1", progress(b, 1000) === 0 && progress(b, 5000) === 1);
}

{
	const all = field(3, "ffa", 4);
	check("every bubble starts on the field", all.every((b) => b.x0 - b.amp >= 0 && b.x0 + b.amp <= 1));
	const golden = all.filter((b) => b.k === "g");
	const plain = all.filter((b) => b.k === "n");
	check("golden ones rise faster than plain ones born alongside", golden.every((g) => g.dur < riseMs(g.born) * 0.7));
	check("small ones are quicker than big ones", plain.filter((b) => b.pts === 30).every((b) => b.dur < riseMs(b.born)));
}

// ---------------------------------------------------------------------------
console.log("\nthe ramp");

check("bubbles rise faster as the round goes on", riseMs(0) === 5200 && riseMs(ROUND_MS) === 3200);
check("bombs grow commoner", bombChance(0) === 0.08 && Math.abs(bombChance(ROUND_MS) - 0.16) < 1e-9);
check("spawns quicken", spawnInterval(40_000, 2) < spawnInterval(0, 2));
check("…with more players", spawnInterval(0, 8) < spawnInterval(0, 2));
check("…and again in the frenzy", spawnInterval(ROUND_MS - FRENZY_MS, 2) < spawnInterval(ROUND_MS - FRENZY_MS - 1, 2) * 0.75);
check("…but never past the floor", spawnInterval(ROUND_MS - 1, 8) >= 90);

{
	// Mixes over many rounds, so one unlucky seed cannot fail it.
	const all = Array.from({ length: 30 }, (_, i) => field(100 + i, "ffa")).flat();
	const share = (k) => all.filter((b) => b.k === k).length / all.length;
	check("about 5% golden", share("g") > 0.03 && share("g") < 0.07, share("g").toFixed(3));
	check("about 12% bombs", share("x") > 0.09 && share("x") < 0.15, share("x").toFixed(3));
	check("free-for-all colours nothing", all.every((b) => b.team === null));
	const teams = Array.from({ length: 10 }, (_, i) => field(200 + i, "teams")).flat();
	const plain = teams.filter((b) => b.k === "n");
	const a = plain.filter((b) => b.team === "A").length / plain.length;
	check("TEAMS colours plain bubbles about half and half", a > 0.45 && a < 0.55, a.toFixed(3));
	check("…and leaves golden and bombs neutral", teams.filter((b) => b.k !== "n").every((b) => b.team === null));
}

// ---------------------------------------------------------------------------
console.log("\npoints and places");

{
	check("the multiplier steps up every four pops", [0, 3, 4, 7, 8, 12].map(multiplier).join() === "1,1,2,2,3,4");
	check("…and stops at ×5", multiplier(16) === 5 && multiplier(400) === 5);
	const small = { k: "n", team: null, pts: 30 };
	const bomb = { k: "x", team: null, pts: -25 };
	check("a pop is its points times the multiplier", popPoints(small, "ffa", "A", 8).pts === 90);
	check("a bomb is −25, never multiplied", popPoints(bomb, "ffa", "A", 20).pts === -25 && popPoints(bomb, "ffa", "A", 20).kind === "bomb");
	const theirs = { k: "n", team: "B", pts: 30 };
	check("the other side's colour is denied for nothing", popPoints(theirs, "teams", "A", 8).pts === 0 && popPoints(theirs, "teams", "A", 8).kind === "deny");
	check("your own colour scores", popPoints(theirs, "teams", "B", 0).pts === 30);
	const scores = { a: 120, b: 80, c: 120, d: 0 };
	check("best first; equal scores share a place", JSON.stringify(ranking(scores, ["a", "b", "c", "d"])) === '[["a","c"],["b"],["d"]]');
	const ts = teamScores({ a: 90, b: 30, c: 70 }, ["a", "b"], ["c"]);
	check("a team scores its players' average", ts.A === 60 && ts.B === 70);
	check("an empty side scores nothing, not NaN", teamScores({ a: 5 }, ["a"], []).B === 0);
	check("the higher average wins", JSON.stringify(teamRanking({ a: 90, b: 30, c: 70 }, ["a", "b"], ["c"])) === '[["c"],["a","b"]]');
	check("a team tie is one place", teamRanking({ a: 50, c: 50 }, ["a"], ["c"]).length === 1);
}

// ---------------------------------------------------------------------------
// The round, as the platform runs it. The host is "host"; `start` opens a
// round in `mode` with `seats` and plays the countdown out. `place` swaps the
// field for hand-made bubbles (through restore, as an heir would get them)
// and stops spawning, so a test knows exactly what is under a finger.

const person = (id, team = "A") => ({ id, name: id, team, bot: false });
const robot = (id, team = "A") => ({ id, name: id, team, bot: true });

function start(seats, mode = null, seed = 1) {
	const g = game({ isHost: (id) => id === "host" });
	g.init({ seats, opts: {}, seed, match: 0 });
	g.apply({ action: { mode: mode ?? "ffa" }, by: "host" });
	g.apply({ action: { start: true }, by: "host" });
	for (let i = 0; i < 200 && g.view({ seat: null }).phase !== "play"; i++) g.tick({ inputs: {}, dt });
	return g;
}
/** A still bubble (no wobble) centred at x, at height y, at the round's time now. */
function still(g, id, x, y, kind = "n", team = null) {
	const t = g.snapshot().t;
	const size = kind === "g" ? R.GOLDEN : kind === "x" ? R.BOMB : R.SIZES[0];
	const dur = 4000;
	const p = (1.08 - y) / 1.16; // where in its flight it is at height y
	return { id, k: kind, s: kind === "n" ? 0 : null, team, r: size.r, pts: size.pts, born: Math.round(t - p * dur), dur, x0: x, amp: 0, freq: 1, ph: 0 };
}
function place(g, bubbles) {
	const s = clone(g.snapshot());
	s.bubbles = bubbles;
	s.spawnAt = ROUND_MS; // nothing else comes
	g.restore({ snapshot: s });
}
// Taps also carry an honest field size (362 × 724, a 390 × 844 phone's).
// The rules ignore it (the field is 1 : 2 everywhere); it is there so these
// tests can be run against the rules before the review of 2026-11-15, which
// read it, to show each new test fails on them.
const FIELD = { w: 362, h: 724 };
/** A tap on bubble `b` as a phone drawing round time `t` would send it. */
function tapOn(g, b, t = g.snapshot().t) {
	const p = position(b, t);
	return { tap: { x: p.x, y: p.y, t, ...FIELD } };
}
const tapAt = (x, y, t) => ({ tap: { x, y, t, ...FIELD } });

console.log("\nscoring, the streak and what breaks it");

{
	const g = start([person("host"), person("p2")]);
	let v = g.view({ seat: "host" });
	check("START plays a 3-2-1 and the round is on", v.phase === "play" && v.t >= 0 && v.t < 200, JSON.stringify({ phase: v.phase, t: v.t }));
	const row = Array.from({ length: 10 }, (_, i) => still(g, 100 + i, 0.1 + i * 0.08, 0.5));
	place(g, row);
	const got = [];
	for (let i = 0; i < 9; i++) {
		const before = g.view({ seat: null }).scores.host ?? 0;
		check(`pop ${i + 1} is accepted`, g.apply({ action: tapOn(g, row[i]), by: "host" }) == null);
		got.push((g.view({ seat: null }).scores.host ?? 0) - before);
		g.tick({ inputs: {}, dt });
	}
	check("small bubbles score 30, ×2 from the 5th pop, ×3 from the 9th", got.join() === "30,30,30,30,60,60,60,60,90", got.join());
	const s = g.snapshot();
	check("the streak counts the pops", s.streaks.host === 9);
	check("…and the event says what it was worth", s.events.at(-1).pts === 90 && s.events.at(-1).mult === 3 && s.events.at(-1).by === "host");

	// A miss breaks it.
	check("a tap on empty field is no refusal: it is a miss", g.apply({ action: tapAt(0.5, 0.05, s.t), by: "host" }) == null);
	check("…it scores nothing and breaks the streak", g.snapshot().streaks.host === 0 && g.view({ seat: null }).scores.host === 450);
	const before = g.view({ seat: null }).scores.host;
	g.apply({ action: tapOn(g, row[9]), by: "host" });
	check("the next pop starts again at ×1", g.view({ seat: null }).scores.host - before === 30);
}

{
	// A pause between pops breaks it too.
	const g = start([person("host")]);
	const a = still(g, 1, 0.3, 0.5);
	const b = still(g, 2, 0.6, 0.5);
	place(g, [a, b]);
	for (let i = 0; i < 4; i++) {
		const s = clone(g.snapshot());
		s.bubbles.push(still(g, 10 + i, 0.2 + i * 0.1, 0.3));
		g.restore({ snapshot: s });
		g.apply({ action: tapOn(g, g.snapshot().bubbles.at(-1)), by: "host" });
	}
	check("four pops: the streak is 4", g.snapshot().streaks.host === 4);
	for (let i = 0; i < Math.ceil(STREAK_MS / 100) + 1; i++) g.tick({ inputs: {}, dt });
	const s = g.snapshot();
	place(g, [still(g, 3, 0.5, 0.5)]);
	const was = g.view({ seat: null }).scores.host;
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "host" });
	check(`a pop after more than ${STREAK_MS} ms is back at ×1`, g.view({ seat: null }).scores.host - was === 30 && g.snapshot().streaks.host === 1, `${g.view({ seat: null }).scores.host - was}`);
	check("the view's streak is a live one: the phone works out the break itself", Array.isArray(g.view({ seat: "host" }).st.host) && s.lastPop.host < s.t - STREAK_MS);
}

console.log("\nbombs and the stun");

{
	const g = start([person("host"), robot("bot_1")]);
	const bomb = still(g, 1, 0.5, 0.5, "x");
	const target = still(g, 2, 0.2, 0.9);
	const others = [3, 4, 5, 6].map((id, i) => still(g, id, 0.15 + i * 0.2, 0.7));
	place(g, [bomb, target, ...others]);
	for (const b of others.slice(0, 3)) {
		g.apply({ action: tapOn(g, b), by: "host" });
		g.tick({ inputs: {}, dt });
	}
	const before = g.view({ seat: null }).scores.host;
	check("a bomb is popped like anything else", g.apply({ action: tapOn(g, bomb), by: "host" }) == null);
	check("…it costs 25", g.view({ seat: null }).scores.host - before === -25, `${g.view({ seat: null }).scores.host - before}`);
	check("…it breaks the streak", g.snapshot().streaks.host === 0);
	const v = g.view({ seat: "host" });
	check(`…and stuns for ${STUN_MS} ms (the view says how long is left)`, v.stun.host === STUN_MS, JSON.stringify(v.stun));
	check("a stunned player's tap is refused", g.apply({ action: tapOn(g, target), by: "host" }) === "stunned");
	check("…and the bubble is still there", g.snapshot().bubbles.some((b) => b.id === target.id));
	for (let i = 0; i < STUN_MS / 100; i++) g.tick({ inputs: {}, dt });
	const woke = g.apply({ action: tapOn(g, target), by: "host" });
	check("the stun wears off on the round clock", woke == null && !("host" in g.view({ seat: null }).stun), `${woke} ${JSON.stringify(g.view({ seat: null }).stun)}`);
	// A stunned bot does not tap either.
	const s = clone(g.snapshot());
	s.stun.bot_1 = s.t + STUN_MS;
	s.botDue.bot_1 = 0;
	g.restore({ snapshot: s });
	check("a stunned bot holds its tap", g.bot({ seat: "bot_1" }) === null);
}

console.log("\nteams: your colour scores, theirs is denied");

{
	const seats = [person("host", "A"), person("a2", "A"), person("b1", "B")];
	const g = start(seats, "teams");
	check("TEAMS was picked", g.view({ seat: null }).mode === "teams");
	const mineA = still(g, 1, 0.2, 0.5, "n", "A");
	const theirsB = still(g, 2, 0.5, 0.5, "n", "B");
	const gold = still(g, 3, 0.8, 0.5, "g");
	place(g, [mineA, theirsB, gold]);
	g.apply({ action: tapOn(g, mineA), by: "host" });
	check("your side's colour scores", g.view({ seat: null }).scores.host === 30);
	g.apply({ action: tapOn(g, theirsB), by: "host" });
	check("theirs scores nothing for you…", g.view({ seat: null }).scores.host === 30);
	check("…but it is gone, so they cannot have it", !g.snapshot().bubbles.some((b) => b.id === theirsB.id));
	check("…and it says DENIED (kind deny) on every phone", g.snapshot().events.at(-1).kind === "deny");
	check("…and a denial keeps your streak going", g.snapshot().streaks.host === 2);
	g.apply({ action: tapOn(g, gold), by: "b1" });
	check("golden belongs to nobody: anyone scores it", g.view({ seat: null }).scores.b1 === 50);
	// A's average is (30 + 0) / 2 = 15; B's is 50: B wins.
	const s = clone(g.snapshot());
	s.t = ROUND_MS - 50;
	s.spawnAt = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("teams: kind 'teams', the higher average first, each side one place", r?.kind === "teams" && JSON.stringify(r.ranking) === '[["b1"],["host","a2"]]', JSON.stringify(r));
	check("…with each player's own score", r.scores.host === 30 && r.scores.a2 === 0 && r.scores.b1 === 50);
	check("…and the averages behind DETAILS", r.details.some((d) => d.label === "Team A average" && d.value === "15 (2)") && r.details.some((d) => d.label === "Team B average" && d.value === "50 (1)"), JSON.stringify(r.details));
	check("a winning side gets the derived title (YOU WIN / X & Y WIN)", !("title" in r));
}

{
	// The mode: the host's, and only possible with both sides.
	const g = game({ isHost: (id) => id === "host" });
	g.init({ seats: [person("host", "A"), person("p2", "A")], opts: {}, seed: 1, match: 0 });
	check("one side only: free-for-all", g.view({ seat: null }).mode === "ffa" && !g.view({ seat: null }).teamsOk);
	check("…and TEAMS is refused", typeof g.apply({ action: { mode: "teams" }, by: "host" }) === "string");
	g.init({ seats: [person("host", "A"), person("p2", "B")], opts: {}, seed: 1, match: 1 });
	check("both sides: no mode until the host picks (the game asks every round)", g.view({ seat: null }).mode === null && g.view({ seat: null }).teamsOk);
	check("…and START waits for the pick", g.apply({ action: { start: true }, by: "host" }) === "pick FREE-FOR-ALL or TEAMS first" && g.view({ seat: null }).phase === "setup");
	check("a guest cannot pick the mode", g.apply({ action: { mode: "ffa" }, by: "p2" }) === "the host picks");
	check("…nor start", g.apply({ action: { start: true }, by: "p2" }) === "the host picks" && g.view({ seat: null }).phase === "setup");
	g.apply({ action: { mode: "ffa" }, by: "host" });
	check("the host's pick is the round's mode", g.view({ seat: null }).mode === "ffa");
	g.init({ seats: [person("host", "A"), person("p2", "B")], opts: {}, seed: 1, match: 2 });
	check("…and the next round asks again", g.view({ seat: null }).mode === null);
	// Sides moved in the party while the host sets up: TEAMS follows at once.
	const sides = { host: "A", p2: "A" };
	const live = game({ isHost: (id) => id === "host", sideOf: (id) => sides[id] });
	live.init({ seats: [person("host", "A"), person("p2", "A")], opts: {}, seed: 1, match: 0 });
	check("moving a player to Team B during setup…", live.view({ seat: null }).mode === "ffa");
	sides.p2 = "B";
	live.tick({ inputs: {}, dt });
	check("…makes TEAMS possible, and the host is asked to pick", live.view({ seat: null }).teamsOk && live.view({ seat: null }).mode === null);
	live.apply({ action: { mode: "teams" }, by: "host" });
	sides.p2 = "A";
	live.tick({ inputs: {}, dt });
	check("a side emptied after TEAMS was picked: FREE-FOR-ALL, as nothing else can be played", live.view({ seat: null }).mode === "ffa");
	sides.p2 = "B";
	live.tick({ inputs: {}, dt });
	check("…and filled again: back to the host's TEAMS", live.view({ seat: null }).mode === "teams");
	live.apply({ action: { start: true }, by: "host" });
	sides.p2 = "A";
	live.tick({ inputs: {}, dt });
	check("…but once started, the sides are fixed for the round", live.view({ seat: null }).mode === "teams" && live.snapshot().seats[1].team === "B");
	check("taps before START are refused", typeof g.apply({ action: tapAt(0.5, 0.5, 0), by: "host" }) === "string");
	check("no time passes while the host sets up", (g.tick({ inputs: {}, dt }), g.view({ seat: null }).t === -COUNT_MS));
}

console.log("\nthe host judges every tap");

{
	const g = start([person("host"), person("p2"), person("watcher")]);
	const b = still(g, 7, 0.5, 0.5);
	const far = still(g, 8, 0.15, 0.15);
	place(g, [b, far]);
	const t = g.snapshot().t;
	check("a tap names no bubble: one that does is not a tap", typeof g.apply({ action: { tap: { id: 7 } }, by: "p2" }) === "string");
	check("a tap on empty space pops nothing", g.apply({ action: tapAt(0.85, 0.85, t), by: "p2" }) == null && g.snapshot().bubbles.length === 2 && !g.view({ seat: null }).scores.p2);
	check("…and counts as a miss", g.snapshot().stats.misses.p2 === 1);
	// Just outside the bubble and its slack: still a miss. Distances are in
	// field widths, the field being 1 : 2 on every phone.
	const r = b.r + R.SLACK;
	check("a finger just past the bubble's edge and the slack is a miss", (g.apply({ action: tapAt(0.5 + r + 0.005, 0.5, t), by: "p2" }), g.snapshot().bubbles.length === 2));
	check("…and just inside it is a pop", g.apply({ action: tapAt(0.5 + r - 0.005, 0.5, t), by: "p2" }) == null && g.view({ seat: null }).scores.p2 === 30);
	check("a tap on the bubble someone popped a moment ago is refused, without penalty", g.apply({ action: tapAt(0.5, 0.5, t), by: "host" }) === "someone popped it first" && !g.snapshot().stats.misses.host);
	check("a watcher's tap counts for nothing", (g.apply({ action: tapOn(g, far), by: "spectator" }), g.snapshot().bubbles.length === 1));
	check("garbage is refused", typeof g.apply({ action: { tap: { x: "a", y: 1, t } }, by: "p2" }) === "string" && typeof g.apply({ action: tapAt(5, 5, t), by: "p2" }) === "string");
}

{
	// Latency: a phone draws a beat behind the host. The bubble is judged
	// where that phone drew it, but only within LAG_MS of the host's clock.
	const g = start([person("host"), person("p2")]);
	for (let i = 0; i < 20; i++) g.tick({ inputs: {}, dt });
	const b = still(g, 1, 0.5, 0.6);
	place(g, [b]);
	const t = g.snapshot().t;
	const then = t - 300; // where p2 saw it, 300 ms ago
	const old = position(b, then);
	check("the bubble has moved on since (a tap where it was would miss it now)", !hitTest([b], old.x, old.y, t));
	check("a tap where the phone drew it 300 ms ago pops it", g.apply({ action: tapAt(old.x, old.y, then), by: "p2" }) == null && g.view({ seat: null }).scores.p2 === 30);
	const c = still(g, 2, 0.5, 0.6);
	place(g, [c]);
	const long = t - 900; // further back than the window allows
	const ghost = position(c, long);
	const said = g.apply({ action: tapAt(ghost.x, ghost.y, long), by: "p2" });
	check("a phone cannot claim a time further back than the window", said == null && g.snapshot().bubbles.length === 1 && g.snapshot().stats.misses.p2 === 1, `${said} ${JSON.stringify(ghost)} ${g.snapshot().bubbles.length} ${g.snapshot().stats.misses.p2}`);
	check(`…the window is ${LAG_MS} ms`, LAG_MS >= 300 && LAG_MS <= 800);
	// A flood within one tick is capped.
	g.tick({ inputs: {}, dt });
	const many = Array.from({ length: TAPS_PER_TICK + 2 }, () => g.apply({ action: tapAt(0.9, 0.1, t), by: "p2" }));
	check(`at most ${TAPS_PER_TICK} taps a tick each`, many.filter((x) => x === "too fast").length === 2, JSON.stringify(many));
}

console.log("\nno bubble before its time (review, 2026-11-15)");

{
	// The views carry bubbles 400 ms before they are born. A guest that taps
	// where one will be, claiming a time ahead of the host, must get nothing:
	// snipe.mjs popped 201 of 201 this way, golden ones included.
	const g = start([person("host"), person("p2"), person("p3")]);
	for (let i = 0; i < 50; i++) g.tick({ inputs: {}, dt });
	let tried = 0;
	let popped = 0;
	for (let k = 0; k < 200; k++) {
		const s = g.snapshot();
		for (const b of s.bubbles.filter((b) => b.born > s.t && b.born <= s.t + 150).slice(0, 3)) {
			tried++;
			const when = s.t + 150;
			const p = position(b, when);
			g.apply({ action: tapAt(p.x, Math.min(1.1, p.y), when), by: "p2" });
			if (!g.snapshot().bubbles.some((x) => x.id === b.id)) popped++;
		}
		g.tick({ inputs: {}, dt });
	}
	check(`a bubble not yet born on the host cannot be popped (${popped} of ${tried})`, tried > 50 && popped === 0);
}

{
	const g = start([person("host"), person("p2")]);
	for (let i = 0; i < 10; i++) g.tick({ inputs: {}, dt });
	const t = g.snapshot().t;
	// Born a moment ago, its centre still below the bottom edge: not on the field.
	const low = { id: 1, k: "g", s: null, team: null, r: R.GOLDEN.r, pts: 50, born: t - 40, dur: 3000, x0: 0.5, amp: 0, freq: 1, ph: 0 };
	place(g, [low]);
	const at = position(low, t);
	check("a bubble still below the field cannot be hit", at.y > 1 && typeof g.apply({ action: tapAt(0.5, Math.min(1.1, at.y), t), by: "p2" }) === "string" && g.snapshot().bubbles.length === 1);
	check("…nor reached from the bottom edge", g.apply({ action: tapAt(0.5, 1, t), by: "p2" }) == null && g.snapshot().bubbles.length === 1);
	check("a tap below the field is refused", g.apply({ action: tapAt(0.5, 1 + R.EDGE + 0.01, t), by: "p2" }) === "not on the field");
}

{
	// Ahead of the host's clock: only the host's own seat, whose phone carries
	// the clock on between ticks (bubble-rush.js EXTRA_MS, 250 ms).
	check("the host's seat may be ahead by at least the phone's 250 ms", R.AHEAD_MS >= 250);
	const g = start([person("host"), person("p2")]);
	for (let i = 0; i < 10; i++) g.tick({ inputs: {}, dt });
	const b = still(g, 1, 0.5, 0.6);
	place(g, [b]);
	const t = g.snapshot().t;
	const later = t + 240;
	const p = position(b, later);
	g.apply({ action: tapAt(p.x, p.y, later), by: "p2" });
	check("a guest's tap is judged at most one tick ahead of the host's clock (240 ms ahead misses here)", g.snapshot().bubbles.length === 1 && g.snapshot().stats.misses.p2 === 1);
	check("the host's own tap 240 ms ahead, centred where its phone drew it, pops it", g.apply({ action: tapAt(p.x, p.y, later), by: "host" }) == null && g.view({ seat: null }).scores.host === 30);
}

{
	// A guest's phone runs its clock on between views while the host's moves
	// once a tick, so its honest tap is ahead of the host's clock by up to a
	// tick less the round trip. Judged at the host's clock instead, a tap on a
	// quick golden bubble late in the round missed one time in six (re-review,
	// 2026-11-15, repro4). Each phone below taps a random point of the bubble
	// as drawn, RTT 20 ms, the tap landing at a random moment of the tick.
	const g = start([person("host"), person("p2")]);
	const base = clone(g.snapshot());
	const rng = rngFrom(77);
	let hits = 0;
	const N = 600;
	for (let i = 0; i < N; i++) {
		const t = 55_000;
		const dur = Math.round(riseMs(t) * R.GOLDEN.speed);
		const b = { id: 1, k: "g", s: null, team: null, r: R.GOLDEN.r, pts: 50, born: t - dur * (0.2 + 0.6 * rng()), dur, x0: 0.5, amp: 0.02 + rng() * 0.04, freq: 1 + rng() * 1.5, ph: rng() * 6.28 };
		const ahead = Math.max(0, rng() * 100 - 20);
		const p = position(b, t + ahead);
		const a = rng() * Math.PI * 2;
		const d = Math.sqrt(rng()) * b.r;
		g.restore({ snapshot: { ...clone(base), t, bubbles: [b], gone: [], spawnAt: ROUND_MS, lastT: {} } });
		g.apply({ action: tapAt(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d * R.FIELD_ASPECT, t + ahead), by: "p2" });
		if (!g.snapshot().bubbles.length) hits++;
	}
	check(`a guest's honest tap on a golden bubble in the frenzy lands (${hits} of ${N}, RTT 20 ms)`, hits === N);
}

{
	// The host's phone runs up to 250 ms ahead: a bubble born after the host's
	// last tick, already on its screen, is its to pop; a guest claiming the
	// same time is held to one tick and cannot reach it.
	const g = start([person("host"), person("p2")]);
	for (let i = 0; i < 400; i++) g.tick({ inputs: {}, dt });
	const t = g.snapshot().t;
	const dur = Math.round(riseMs(t) * R.GOLDEN.speed);
	const b = { id: 1, k: "g", s: null, team: null, r: R.GOLDEN.r, pts: 50, born: t + 100, dur, x0: 0.5, amp: 0, freq: 1, ph: 0 };
	place(g, [b]);
	const p = position(b, t + 250);
	g.apply({ action: tapAt(p.x, p.y, t + 250), by: "p2" });
	check("a guest cannot reach a bubble born after the host's clock by claiming 250 ms ahead", g.snapshot().bubbles.length === 1);
	check("…the host's own phone, drawing it 250 ms ahead and surfaced, pops it", g.apply({ action: tapAt(p.x, p.y, t + 250), by: "host" }) == null && g.view({ seat: null }).scores.host === 50);
}

{
	// A player's taps never go back in time: no sweeping the window for the
	// moment a bubble was under the finger.
	const g = start([person("host"), person("p2")]);
	for (let i = 0; i < 20; i++) g.tick({ inputs: {}, dt });
	const b = still(g, 1, 0.5, 0.6);
	place(g, [b]);
	const t = g.snapshot().t;
	g.apply({ action: tapAt(0.1, 0.1, t), by: "p2" });
	const before = position(b, t - 300);
	g.apply({ action: tapAt(before.x, before.y, t - 300), by: "p2" });
	check("after a tap at t, a tap claiming t − 300 ms is judged at t", g.snapshot().bubbles.length === 1 && g.snapshot().stats.misses.p2 === 2);
}

{
	// Two players on the same bubble in one tick, a neighbour within reach of
	// the second: the second is refused, not handed the neighbour.
	const g = start([person("host"), person("p2"), person("p3")]);
	const one = still(g, 1, 0.5, 0.5);
	const two = still(g, 2, 0.56, 0.5);
	place(g, [one, two]);
	const t = g.snapshot().t;
	g.apply({ action: tapAt(0.5, 0.5, t), by: "p2" });
	check("the same spot a moment later: someone popped it first, the neighbour stays", g.apply({ action: tapAt(0.5, 0.5, t), by: "p3" }) === "someone popped it first" && g.snapshot().bubbles.length === 1 && !g.view({ seat: null }).scores.p3);
}

console.log("\none field, whatever the phone says about its screen");

{
	// The field is 1 : 2 on every phone, so a phone has nothing to claim. The
	// review's repro: claiming 240×240 on a 362×650 field doubled how far
	// below a bubble a tap still popped it.
	const reach = R.SIZES[0].r + R.SLACK;
	const claims = [{ w: 240, h: 240 }, { w: 240, h: 4000 }, { w: 4000, h: 240 }, { w: NaN, h: Infinity }, { w: -5, h: -5 }, { w: 1e300, h: 1e300 }, {}];
	const results = claims.map((claim) => {
		const g = start([person("host"), person("p2")]);
		const b = still(g, 1, 0.5, 0.5);
		place(g, [b]);
		const t = g.snapshot().t;
		const out = (g.apply({ action: { tap: { x: 0.5, y: 0.5 + (reach + 0.01) * R.FIELD_ASPECT, t, ...claim } }, by: "p2" }), g.snapshot().bubbles.length === 1);
		const inside = g.apply({ action: { tap: { x: 0.5, y: 0.5 + (reach - 0.01) * R.FIELD_ASPECT, t, ...claim } }, by: "p2" }) == null && g.snapshot().bubbles.length === 0;
		return out && inside;
	});
	check("a claimed screen size (any shape, NaN, negative, huge) changes nothing: just past the reach misses, just inside pops", results.every(Boolean), JSON.stringify(results));
	const b = { id: 1, k: "n", s: 0, team: null, r: R.SIZES[0].r, pts: 30, born: 0, dur: 4000, x0: 0.5, amp: 0, freq: 1, ph: 0 };
	const c = position(b, 2000);
	const d = reach - 0.002;
	check("…and the reach is the same across as down, in field widths", !!hitTest([b], c.x + d, c.y, 2000) && !!hitTest([b], c.x, c.y + d * R.FIELD_ASPECT, 2000) && !hitTest([b], c.x, c.y + (reach + 0.002) * R.FIELD_ASPECT, 2000));
}

{
	const g = start([person("host"), person("p2")]);
	const t = g.snapshot().t;
	const said = [{ x: NaN, y: 0.5, t }, { x: 0.5, y: 0.5, t: Infinity }, { x: 0.5, y: 0.5, t: -Infinity }, { x: 0.5, y: 0.5, t: null }, { x: "0.5", y: 0.5, t }, { x: 0.5, y: [0.5], t }].map((tap) => g.apply({ action: { tap }, by: "p2" }));
	check("NaN, Infinity, null or strings for x, y or t are not a tap", said.every((r) => r === "not a tap"), JSON.stringify(said));
	check("…and count as nothing, not a miss", !g.snapshot().stats.misses.p2);
}

{
	// Each judged tap is acknowledged to its phone, which keeps a bubble it
	// popped on its own hidden until then.
	const g = start([person("host"), person("p2")]);
	place(g, [still(g, 1, 0.5, 0.5)]);
	const t = g.snapshot().t;
	g.apply({ action: { tap: { x: 0.9, y: 0.1, t, n: 5 } }, by: "p2" });
	const v = g.view({ seat: "p2" });
	check("the tap's number comes back in that phone's view, with its misses", v.ack === 5 && v.mine?.misses === 1 && g.view({ seat: "host" }).ack === 0, JSON.stringify({ ack: v.ack, mine: v.mine }));
}

console.log("\nresults: alone, leavers, emptied sides");

{
	// Alone, one bomb: the arcade's server refuses a negative score.
	const g = start([person("host")]);
	place(g, [still(g, 1, 0.5, 0.5, "x")]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "host" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("alone and below zero: the score reported is 0, the title says what it was", r?.kind === "coop" && r.scores.host === 0 && r.title === "-25 POINTS", JSON.stringify(r && { scores: r.scores, title: r.title }));
}

{
	// Begun with someone else: never a solo run, whoever is left.
	const g = start([person("host"), person("p2")]);
	g.leave({ seat: "p2" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("a round begun by two is free-for-all even when one leaves (not a solo run)", r?.kind === "ffa" && JSON.stringify(r.ranking) === '[["host"]]', JSON.stringify(r && { kind: r.kind, ranking: r.ranking }));
}

{
	// Teams: a leaver's score still counts for their side, so quitting cannot
	// raise a side's average; they are out of the places.
	const g = start([person("host", "A"), person("a2", "A"), person("b1", "B"), person("b2", "B")], "teams");
	const bubbles = [1, 2, 3, 4, 5, 6, 7].map((id, i) => still(g, id, 0.08 + i * 0.13, 0.5));
	place(g, bubbles);
	for (const b of bubbles.slice(0, 4)) {
		g.apply({ action: tapOn(g, b), by: "a2" });
		g.tick({ inputs: {}, dt });
	}
	g.apply({ action: tapOn(g, bubbles[4]), by: "b1" });
	g.apply({ action: tapOn(g, bubbles[5]), by: "b2" });
	check("a2 scored 120 for A, b1 and b2 30 each for B", g.view({ seat: null }).scores.a2 === 120 && g.view({ seat: null }).scores.b1 === 30);
	g.leave({ seat: "a2" });
	check("a2 leaves: A's average stays (0 + 120) / 2 = 60", g.view({ seat: null }).avg?.A === 60, JSON.stringify(g.view({ seat: null }).avg));
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("…A still wins, 60 to 30; the leaver is out of the places", r?.kind === "teams" && JSON.stringify(r.ranking) === '[["host"],["b1","b2"]]', JSON.stringify(r && r.ranking));
}

{
	// A whole side gone: still a teams result, and the title says who won.
	const g = start([person("host", "A"), person("b1", "B")], "teams");
	place(g, [still(g, 1, 0.5, 0.5)]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "b1" });
	g.leave({ seat: "b1" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("Team B emptied but ahead: kind 'teams', titled TEAM B WINS, B's place kept empty first", r?.kind === "teams" && r.title === "TEAM B WINS" && JSON.stringify(r.ranking) === '[[],["host"]]' && r.details[0].value === "Teams", JSON.stringify(r && { kind: r.kind, title: r.title, ranking: r.ranking }));
}

{
	// And the other way: the side that empties was behind.
	const g = start([person("host", "A"), person("b1", "B")], "teams");
	place(g, [still(g, 1, 0.5, 0.5)]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "host" });
	g.leave({ seat: "b1" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("Team B emptied and behind: TEAM A WINS, B's place kept empty last", r?.kind === "teams" && r.title === "TEAM A WINS" && JSON.stringify(r.ranking) === '[["host"],[]]', JSON.stringify(r && { title: r.title, ranking: r.ranking }));
}

{
	// An exact tie in a 1-against-1 where one of them left: a draw, not a win
	// for the one still here (the leaver stays in the shared place).
	const g = start([person("host", "A"), person("b1", "B")], "teams");
	place(g, [still(g, 1, 0.3, 0.5), still(g, 2, 0.7, 0.5)]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "host" });
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "b1" });
	g.leave({ seat: "b1" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("a teams tie with a leaver: one shared place, the leaver in it (a draw)", r?.kind === "teams" && r.title === "A TIE" && JSON.stringify(r.ranking) === '[["host","b1"]]' && r.scores.b1 === 30, JSON.stringify(r && { title: r.title, ranking: r.ranking, scores: r.scores }));
}

{
	const show = (a, b) => (typeof R.averages === "function" ? R.averages(a, b).join(" ") : "none");
	check("team averages: whole numbers, one decimal when they would look equal but are not", show(15, 15.4) === "15.0 15.4" && show(15, 16) === "15 16" && show(20, 20) === "20 20", `${show(15, 15.4)} | ${show(15, 16)} | ${show(20, 20)}`);
}

console.log("\nthe round ends");

{
	const g = start([person("host"), robot("bot_1"), robot("bot_2")]);
	const inputs = {};
	let ticks = 0;
	while (g.view({ seat: null }).phase === "play" && ticks < 2000) {
		for (const id of ["bot_1", "bot_2"]) {
			const b = g.bot({ seat: id });
			if (b) inputs[id] = b;
		}
		g.tick({ inputs: { ...inputs }, dt });
		ticks++;
	}
	const v = g.view({ seat: "host" });
	check(`a round is ${ROUND_MS / 1000} s of ticks`, v.phase === "over" && ticks === ROUND_MS / 100, `${ticks} ticks`);
	check("the bots scored", (v.scores.bot_1 ?? 0) > 0 && (v.scores.bot_2 ?? 0) > 0, JSON.stringify(v.scores));
	const r = g.result();
	check("free-for-all: kind 'ffa', best first, everyone placed", r?.kind === "ffa" && r.ranking.flat().length === 3 && (r.scores[r.ranking[0][0]] ?? 0) >= (r.scores[r.ranking.at(-1)[0]] ?? 0), JSON.stringify(r?.ranking));
	check("the end card's details: best streak and bubbles popped", r.details.some((d) => d.label === "Best streak") && r.details.find((d) => d.label === "Bubbles popped")?.value === g.snapshot().pops, JSON.stringify(r.details));
	check("at most 8 detail rows, short ones", r.details.length <= 8 && r.details.every((d) => d.label.length <= 32 && String(d.value).length <= 40));
	check("a tap after the bell is refused", typeof g.apply({ action: tapAt(0.5, 0.5, ROUND_MS), by: "host" }) === "string");
	check("bots stop with the bell", g.bot({ seat: "bot_1" }) === null);
	check("ticks after the bell change nothing", (g.tick({ inputs: {}, dt }), g.view({ seat: "host" }).t === ROUND_MS));
	g.init({ seats: [person("host"), robot("bot_1"), robot("bot_2")], opts: {}, seed: 2, match: 1 });
	check("PLAY AGAIN: the next round opens on the mode choice, scores cleared", g.view({ seat: null }).phase === "setup" && Object.keys(g.view({ seat: null }).scores).length === 0 && g.result() === null);
}

{
	// Alone: played, with the score as the title.
	const g = start([person("host")]);
	place(g, [still(g, 1, 0.5, 0.5, "g")]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "host" });
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	const r = g.result();
	check("alone: kind 'coop' with the score, titled in points", r?.kind === "coop" && r.scores.host === 50 && r.title === "50 POINTS", JSON.stringify(r));
}

{
	// A player who leaves is out: their score no longer counts.
	const g = start([person("host"), person("p2")]);
	place(g, [still(g, 1, 0.5, 0.5)]);
	g.apply({ action: tapOn(g, g.snapshot().bubbles[0]), by: "p2" });
	check("a player who left the party is out of the round", g.leave({ seat: "p2" }) === true && g.view({ seat: "p2" }).you === null);
	check("…their taps are refused", g.apply({ action: tapAt(0.5, 0.5, g.snapshot().t), by: "p2" }) === "you are watching");
	const s = clone(g.snapshot());
	s.t = ROUND_MS;
	g.restore({ snapshot: s });
	g.tick({ inputs: {}, dt });
	check("…and they are left out of the places", JSON.stringify(g.result().ranking) === '[["host"]]', JSON.stringify(g.result()));
}

console.log("\nsnapshot and restore");

{
	// The heir restores the copy and carries on: exactly what the host would
	// have done, tick for tick, bot for bot, tap for tap.
	const seats = [person("host", "A"), robot("bot_1", "B"), robot("bot_2", "A"), person("p2", "B")];
	const host = start(seats, "teams", 99);
	const step = (g, inputs) => {
		for (const id of ["bot_1", "bot_2"]) {
			const b = g.bot({ seat: id });
			if (b) inputs[id] = b;
		}
		g.tick({ inputs: { ...inputs }, dt });
	};
	const hi = {};
	for (let i = 0; i < 150; i++) step(host, hi);
	const copy = clone(host.snapshot());
	const heir = game({ isHost: (id) => id === "p2" });
	heir.restore({ snapshot: copy });
	check("the copy is plain JSON and restores to the same view", JSON.stringify(heir.view({ seat: "p2" })) === JSON.stringify(host.view({ seat: "p2" })));
	const ei = {}; // the platform clears inputs when the heir starts
	let same = true;
	let firstDiff = -1;
	for (let i = 0; i < 300; i++) {
		// A person taps the same thing on both.
		if (i % 7 === 0) {
			const b = host.snapshot().bubbles.find((x) => alive(x, host.snapshot().t));
			if (b) {
				const a = tapOn(host, b);
				const r1 = host.apply({ action: a, by: "p2" });
				const r2 = heir.apply({ action: clone(a), by: "p2" });
				if (r1 !== r2) same = false;
			}
		}
		step(host, hi);
		step(heir, ei);
		if (same && JSON.stringify(host.view({ seat: "host" })) !== JSON.stringify(heir.view({ seat: "host" }))) {
			same = false;
			firstDiff = i;
		}
	}
	check("…and carries on tick for tick, bot for bot, tap for tap", same, `first difference at tick ${firstDiff}`);
	check("…mid-round, not restarted", heir.view({ seat: null }).phase === "play" && heir.view({ seat: null }).t > 30_000);
	check("…with the scores so far", Object.values(heir.view({ seat: null }).scores).some((v) => v > 0));
	check("the heir's own host picks the next mode", (heir.init({ seats, opts: {}, seed: 3, match: 1 }), heir.apply({ action: { mode: "ffa" }, by: "p2" }) == null));
	// A finished round's copy is finished.
	const done = start([person("host"), robot("bot_1")]);
	const s = clone(done.snapshot());
	s.t = ROUND_MS;
	done.restore({ snapshot: s });
	done.tick({ inputs: {}, dt });
	const after = game();
	after.restore({ snapshot: clone(done.snapshot()) });
	check("a decided round restores decided, with the same result", JSON.stringify(after.result()) === JSON.stringify(done.result()) && after.result() !== null);
}

{
	// The heir's copy is up to a second old: the host ran on, a pop happened
	// after it, and the old host's last view was ahead of the copy. The heir
	// carries on from the copy (that pop is lost, as docs say), its bots
	// start from empty inputs, and a phone still drawing the old host's later
	// time is judged at the heir's clock, never ahead of it.
	const seats = [person("host"), robot("bot_1"), person("p2")];
	const host = start(seats, null, 7);
	const hi = {};
	const step = (g, inputs) => {
		const b = g.bot({ seat: "bot_1" });
		if (b) inputs.bot_1 = b;
		g.tick({ inputs: { ...inputs }, dt });
	};
	for (let i = 0; i < 100; i++) step(host, hi);
	const copy = clone(host.snapshot());
	for (let i = 0; i < 8; i++) step(host, hi);
	const ahead = host.snapshot().t;
	const heir = game({ isHost: (id) => id === "p2" });
	heir.restore({ snapshot: copy });
	check("an older copy restores at its own time, mid-round", heir.view({ seat: null }).t === Math.round(copy.t) && heir.view({ seat: null }).phase === "play" && ahead - copy.t === 800);
	const s = clone(heir.snapshot());
	const b = still({ snapshot: () => s }, 999, 0.5, 0.6);
	s.bubbles.push(b);
	heir.restore({ snapshot: s });
	const drawn = position(b, ahead);
	heir.apply({ action: tapAt(drawn.x, drawn.y, ahead), by: "host" }); // the old host is a guest now
	check("a phone drawing the old host's later time is judged at the heir's clock (a miss here)", heir.snapshot().bubbles.some((x) => x.id === 999) && heir.snapshot().stats.misses.host === 1);
	const ei = {};
	for (let i = 0; i < 700 && heir.result() === null; i++) step(heir, ei);
	check("…and the heir plays the round out from empty inputs, its bot still popping", heir.result() !== null && (heir.snapshot().stats.popped.bot_1 ?? 0) > (copy.stats.popped.bot_1 ?? 0) + 20);
}

console.log("\nbots");

{
	const at = (k, team, pts, born = 0) => ({ id: `${k}${team}${pts}${born}`, k, team, r: 0.05, pts, born, dur: 4000, x0: 0.5, amp: 0, freq: 1, ph: 0 });
	const many = (n, pick) => Array.from({ length: n }, (_, i) => pick(rngFrom(i + 1)));
	check("sees nothing it has not had time to react to", botPick([at("n", null, 30, 900)], 1000, "A", "ffa", rngFrom(1)) === null);
	const field1 = [at("n", null, 10), at("n", null, 30), at("x", null, -25), at("n", null, 20)];
	const picks = many(500, (rng) => botPick(field1, 1000, "A", "ffa", rng));
	const bombs = picks.filter((p) => p?.id === field1[2].id).length / picks.length;
	const misses = picks.filter((p) => p?.miss).length / picks.length;
	check("mostly leaves bombs alone", bombs < 0.1, bombs.toFixed(3));
	check("…but not always", bombs > 0);
	check("misses now and then, but seldom", misses > 0.005 && misses < 0.05, misses.toFixed(3));
	check("otherwise goes for the most valuable bubble", picks.filter((p) => p?.id === field1[1].id).length / picks.length > 0.75);
	const withGold = [...field1, at("g", null, 50)];
	check("golden first", many(200, (rng) => botPick(withGold, 1000, "A", "ffa", rng)).filter((p) => p?.id === withGold[4].id).length > 150);
	const teamField = [at("n", "A", 10), at("n", "B", 30)];
	const tp = many(500, (rng) => botPick(teamField, 1000, "A", "teams", rng));
	const own = tp.filter((p) => p?.id === teamField[0].id).length / tp.length;
	const deny = tp.filter((p) => p?.id === teamField[1].id).length / tp.length;
	check("in TEAMS, takes its own colour over a richer one of theirs", own > 0.5, own.toFixed(3));
	check("…and sometimes takes theirs away", deny > 0.15 && deny < 0.45, deny.toFixed(3));
	// Supply against demand: two players see more bubbles than a bot can take.
	const supply = field(9, "ffa", 2).filter((b) => b.k !== "x").length / (ROUND_MS / 1000);
	const botRate = 1000 / ((BOT_EVERY_MS[0] + BOT_EVERY_MS[1]) / 2);
	check("a bot takes well under half of what two players are offered", botRate < supply / 2, `bot ${botRate.toFixed(2)}/s of ${supply.toFixed(2)}/s`);
	check(`bubbles are spawned ${LEAD_MS} ms before they are born, so every phone has them before they surface`, (() => {
		const g = start([person("host"), robot("bot_1"), robot("bot_2"), robot("bot_3")]);
		return g.snapshot().bubbles.some((b) => b.born > g.snapshot().t) && !g.view({ seat: null }).bubbles.every((b) => b[3] <= g.snapshot().t);
	})());
}

/**
 * A competent player, scripted: 500 ms to react to a bubble, a tap every
 * 0.65–1 s, the richest bubble on the field (golden first), and a person's
 * slips — 6% of taps on empty field, 2% on a bomb. The yardstick the bots
 * are tuned against (Lokesh, 2026-11-15: a competent player should win
 * about half the time against one).
 */
function competentRound(seed) {
	const g = game({ isHost: (id) => id === "host" });
	g.init({ seats: [person("host"), robot("bot_1")], opts: {}, seed: seed * 7919, match: 0 });
	g.apply({ action: { start: true }, by: "host" });
	const rng = rngFrom(seed);
	const inputs = {};
	let due = 0;
	while (g.result() === null) {
		const s = g.snapshot();
		if (s.phase === "play" && s.t >= due) {
			const all = s.bubbles.filter((b) => b.born <= s.t && s.t - b.born >= 500 && alive(b, s.t) && (R.surfaced ?? (() => true))(b, s.t) && progress(b, s.t) < 0.95);
			const fine = all.filter((b) => b.k !== "x").sort((a, b) => (b.k === "g") - (a.k === "g") || b.pts - a.pts || progress(b, s.t) - progress(a, s.t));
			const roll = rng();
			const target = roll < 0.02 ? all.find((b) => b.k === "x") : fine[0];
			if (roll >= 0.02 && roll < 0.08) g.apply({ action: tapAt(0.5, 0.02, s.t), by: "host" });
			else if (target) g.apply({ action: tapOn(g, target), by: "host" });
			if (target) due = s.t + 650 + rng() * 350;
		}
		const b = g.bot({ seat: "bot_1" });
		if (b) inputs.bot_1 = b;
		g.tick({ inputs: { ...inputs }, dt });
	}
	return g.snapshot().scores;
}

{
	const N = 120;
	let wins = 0;
	for (let seed = 1; seed <= N; seed++) {
		const sc = competentRound(seed);
		if ((sc.host ?? 0) > (sc.bot_1 ?? 0)) wins++;
	}
	check(`a competent player beats one bot about half the time (${wins} of ${N})`, wins >= 0.35 * N && wins <= 0.65 * N);
}

{
	// The bot lapses: gaps between its taps longer than a streak lasts, and
	// streaks broken by them, not only by misses and bombs.
	const g = game();
	g.init({ seats: [robot("bot_1")], opts: {}, seed: 4242, match: 0 });
	g.apply({ action: { start: true }, by: "host" });
	const inputs = {};
	let last = null;
	let lapses = 0;
	let taps = 0;
	while (g.result() === null) {
		const b = g.bot({ seat: "bot_1" });
		if (b) {
			inputs.bot_1 = b;
			const t = g.snapshot().t;
			if (last !== null && t - last > STREAK_MS) lapses++;
			last = t;
			taps++;
		}
		g.tick({ inputs: { ...inputs }, dt });
	}
	check(`a bot now and then pauses longer than a streak lasts (${lapses} lapses in ${taps} taps)`, lapses >= 2 && lapses / taps < 0.2);
}

{
	// Bots on every seat, 1 to 8 of them, many rounds: every round ends, the
	// bots really play (and seldom touch a bomb), and the result is sound.
	let rounds = 0;
	let ended = 0;
	let played = 0;
	let bombRate = 0;
	let taps = 0;
	const t0 = Date.now();
	for (let n = 1; n <= 8; n++) {
		for (let rep = 0; rep < 4; rep++) {
			const teams = rep % 2 === 1 && n >= 2;
			const seats = Array.from({ length: n }, (_, i) => robot(`bot_${i + 1}`, teams && i % 2 ? "B" : "A"));
			const g = game();
			g.init({ seats, opts: {}, seed: 1000 * n + rep, match: rep });
			if (teams) g.apply({ action: { mode: "teams" }, by: "host" });
			g.apply({ action: { start: true }, by: "host" });
			const inputs = {};
			let ticks = 0;
			while (g.result() === null && ticks < 1000) {
				for (const p of seats) {
					const b = g.bot({ seat: p.id });
					if (b) inputs[p.id] = b;
				}
				g.tick({ inputs: { ...inputs }, dt });
				ticks++;
			}
			rounds++;
			const r = g.result();
			if (r && r.ranking.flat().length === n && r.kind === (teams ? "teams" : "ffa")) ended++;
			const st = g.snapshot().stats;
			const pops = Object.values(st.popped).reduce((a, b) => a + b, 0);
			const bombs = Object.values(st.bombs).reduce((a, b) => a + b, 0);
			if (seats.every((p) => (st.popped[p.id] ?? 0) > 20)) played++;
			taps += pops + bombs;
			bombRate += bombs;
		}
	}
	check(`bots-only rounds at 1–8 seats all end with a sound result (${ended}/${rounds})`, ended === rounds);
	check(`…every bot popped plenty in every round (${played}/${rounds})`, played === rounds);
	check("…and bombs are a slip, not a habit", bombRate / taps < 0.1, (bombRate / taps).toFixed(3));
	check("…and 32 whole rounds take under 5 s to simulate", Date.now() - t0 < 5000, `${Date.now() - t0} ms`);
}

console.log(failures ? `\n${failures} failing\n` : "\nall passing\n");
process.exit(failures ? 1 : 0);
