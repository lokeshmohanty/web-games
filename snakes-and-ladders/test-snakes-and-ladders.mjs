#!/usr/bin/env node
/**
 * test-snakes-and-ladders.mjs — fair boards, the exact roll to 100, snakes
 * and ladders taken, turns and who rolls first, and bots finishing games.
 *
 *   node snakes-and-ladders/test-snakes-and-ladders.mjs
 *
 * Plays the managed rules the platform runs on the host (SDK v2).
 */
import { readFileSync } from "node:fs";

new Function(readFileSync(new URL("./snakes-and-ladders-rules.js", import.meta.url), "utf8"))();
const { SIZE, MIN_ROLLS, MAX_ROLLS, SECONDS_PER_TURN, MIN_SPAN, MAX_LADDER, MAX_SNAKE, rng, rowOf, colOf, step, unfair, placesOf, climb, measure, layout, game } = globalThis.snakesAndLaddersRules;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};
const seatsOf = (...ids) => ids.map((id) => ({ id, bot: id.startsWith("bot") }));

console.log("\nthe board's squares");
check("1 is bottom left, 10 bottom right, 11 above 10, 100 top left", colOf(1) === 0 && rowOf(1) === 0 && colOf(10) === 9 && colOf(11) === 9 && rowOf(11) === 1 && colOf(100) === 0 && rowOf(100) === 9);

console.log("\nfair boards, over many seeds");
{
	const SEEDS = 150;
	const problems = [];
	const rolls = [];
	const boards = new Set();
	const feet = new Set();
	const heads = new Set();
	let snakes = 0;
	let ladders = 0;
	let tilted = 0;
	for (let seed = 1; seed <= SEEDS; seed++) {
		const b = layout(seed * 104729);
		const why = unfair(b);
		if (why) problems.push(`${seed}: ${why}`);
		boards.add(JSON.stringify([b.snakes, b.ladders]));
		b.ladders.forEach(([a]) => feet.add(Math.floor(a / 10)));
		b.snakes.forEach(([h]) => heads.add(Math.floor(h / 10)));
		snakes += b.snakes.length;
		ladders += b.ladders.length;
		if (Math.abs(b.snakes.length - b.ladders.length) > 3) tilted++;
		// Measured again on other dice, many more climbs than the deal uses.
		rolls.push(climb(b, rng(seed), 1500));
	}
	const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
	rolls.sort((a, b) => a - b);
	check(`every board is fair (${SEEDS} seeds)`, !problems.length, problems.slice(0, 3).join("; "));
	check("every seed deals a different board", boards.size === SEEDS, `${boards.size}`);
	check("ladders start, and snakes bite, all over the board", feet.size >= 8 && heads.size >= 7, `feet in ${feet.size} decades, heads in ${heads.size}`);
	check(
		`snakes and ladders in about equal numbers: ${(snakes / SEEDS).toFixed(1)} snakes to ${(ladders / SEEDS).toFixed(1)} ladders, never more than 3 apart (${tilted} boards were)`,
		Math.abs(snakes - ladders) / SEEDS <= 1.5 && snakes / SEEDS >= 7 && snakes / SEEDS <= 9.5 && tilted === 0,
	);
	const p5 = rolls[Math.floor(SEEDS * 0.05)];
	const p95 = rolls[Math.floor(SEEDS * 0.95)];
	check(
		`one token climbs in ${MIN_ROLLS}-${MAX_ROLLS} rolls on average, every table alike (average ${mean(rolls).toFixed(1)}; 90% of boards ${p5.toFixed(1)}-${p95.toFixed(1)}; all ${rolls[0].toFixed(1)}-${rolls.at(-1).toFixed(1)})`,
		p5 >= MIN_ROLLS && p95 <= MAX_ROLLS && rolls[0] >= MIN_ROLLS - 3 && rolls.at(-1) <= MAX_ROLLS + 3,
	);
	check("the same seed deals the same board", JSON.stringify(layout(77)) === JSON.stringify(layout(77)));
	const t0 = performance.now();
	for (let seed = 0; seed < 40; seed++) layout(seed * 13);
	const ms = (performance.now() - t0) / 40;
	check(`dealing a board takes ${ms.toFixed(1)} ms (under 8; once a match, in init)`, ms < 8);
	// Bigger tables play for more places, so they run longer by themselves.
	const minutes = {};
	for (const players of [2, 3, 4, 6]) {
		let t = 0;
		for (let seed = 1; seed <= 40; seed++) t += measure(layout(seed * 7919), players, rng(seed), 300).turns;
		minutes[players] = ((t / 40) * SECONDS_PER_TURN) / 60;
	}
	check(
		`a game lasts longer the more play: ${Object.entries(minutes).map(([p, m]) => `${p} players ${m.toFixed(1)} min`).join(", ")} (at ${SECONDS_PER_TURN} s a turn)`,
		minutes[2] < minutes[3] && minutes[3] < minutes[4] && minutes[4] < minutes[6] && minutes[4] >= 3.5,
	);
}

console.log("\nunfair boards are refused");
{
	const base = { ladders: [[4, 25], [55, 76]], snakes: [[48, 30], [92, 70]] };
	check("a fair board passes", unfair(base) === null, unfair(base));
	check("a ladder ending on a snake's head", unfair({ ...base, ladders: [[4, 48], [55, 76]] }) === "two ends share a square");
	check("a snake dropping onto a ladder's foot", unfair({ ...base, snakes: [[48, 4], [92, 70]] }) === "two ends share a square");
	check("a snake on 100", unfair({ ...base, snakes: [[100, 70], [48, 30]] }) !== null);
	check("a ladder to 100", unfair({ ...base, ladders: [[4, 25], [70, 100]] }) !== null);
	check("a ladder within one row", unfair({ ...base, ladders: [[4, 25], [51, 59]] }) !== null);
	check("a ladder leaning across the board", unfair({ ...base, ladders: [[4, 25], [41, 69]] }) !== null);
	check("a ladder too long", unfair({ ...base, ladders: [[4, 4 + MAX_LADDER + 1], [55, 76]] }) !== null);
	check("a snake too long", unfair({ ...base, snakes: [[48, 30], [92, 92 - MAX_SNAKE - 1]] }) !== null);
	check("a snake too short", unfair({ ...base, snakes: [[48, 30], [92, 92 - MIN_SPAN + 1]] }) !== null);
	check("three heads in six squares", unfair({ ...base, snakes: [[48, 30], [92, 70], [93, 71], [95, 72]] }) !== null);
	check("all the ladders at the bottom", unfair({ ...base, ladders: [[4, 25], [15, 36]] }) === "ladders all at one end");
	check("all the snakes at the top", unfair({ ...base, snakes: [[88, 67], [92, 70]] }) === "snakes all at one end");
}

console.log("\nmoves: the exact roll, snakes and ladders");
{
	const jumps = new Map([[4, 25], [48, 30]]);
	check("off the board, a 3 lands on 3", JSON.stringify(step(0, 3, jumps)) === JSON.stringify({ land: 3, to: 3, via: null }));
	check("the foot of a ladder climbs it", JSON.stringify(step(0, 4, jumps)) === JSON.stringify({ land: 4, to: 25, via: "ladder" }));
	check("a snake's head slides down it", JSON.stringify(step(44, 4, jumps)) === JSON.stringify({ land: 48, to: 30, via: "snake" }));
	check("100 needs the exact roll: 97 + 3 wins", step(97, 3, jumps).to === SIZE);
	check("…97 + 4 stays on 97 (no bounce)", JSON.stringify(step(97, 4, jumps)) === JSON.stringify({ land: 97, to: 97, via: "over" }));
	check("…99 + 6 stays, 99 + 1 wins", step(99, 6, jumps).to === 99 && step(99, 1, jumps).to === SIZE);
}

console.log("\nthe game: turns, the die, the end");
{
	const g = game();
	g.init({ seats: seatsOf("pA", "pB", "pC"), opts: {}, seed: 5, match: 0, first: "pB" });
	let v = g.view({ seat: "pA" });
	check("everyone starts off the board; the named seat rolls first", v.pos.join() === "0,0,0" && g.turn()[0] === "pB" && v.you === 0);
	check("the board travels in the view", v.board.snakes.length >= 5 && v.board.ladders.length >= 5 && !unfair(v.board));
	check("out of turn is refused", g.apply({ action: { roll: true }, by: "pA" }) === "not your turn");
	check("anything but a roll is refused", g.apply({ action: { roll: 6 }, by: "pB" }) === "tap the die to roll" && g.apply({ action: { move: 3 }, by: "pB" }) === "tap the die to roll");
	check("a stranger is refused", g.apply({ action: { roll: true }, by: "pZ" }) === "you are not playing");
	check("a roll is taken", g.apply({ action: { roll: true }, by: "pB" }) === undefined);
	v = g.view({ seat: null });
	check("…moves the token by the die, through any snake or ladder, and passes the turn", v.last.seat === 1 && v.last.roll >= 1 && v.last.roll <= 6 && v.last.from === 0 && v.last.land === v.last.roll && v.pos[1] === v.last.to && g.turn()[0] === "pC", JSON.stringify(v.last));
	check("the bot rolls, on its turn only", JSON.stringify(g.bot({ seat: "pC" })) === '{"roll":true}' && g.bot({ seat: "pA" }) === null);
	// The die is fair over many rolls, and comes from the state, so an heir rolls the same.
	const counts = [0, 0, 0, 0, 0, 0, 0];
	const h = game();
	h.init({ seats: seatsOf("pA", "pB"), opts: {}, seed: 11, match: 0, first: "pA" });
	const heir = game();
	let same = true;
	for (let i = 0; i < 3000 && h.turn().length; i++) {
		heir.restore({ snapshot: h.snapshot() });
		const who = h.turn()[0];
		h.apply({ action: { roll: true }, by: who });
		heir.apply({ action: { roll: true }, by: who });
		if (JSON.stringify(h.view({ seat: null })) !== JSON.stringify(heir.view({ seat: null }))) same = false;
		counts[h.view({ seat: null }).last.roll]++;
		if (h.result()) h.init({ seats: seatsOf("pA", "pB"), opts: {}, seed: 11 + i, match: i });
	}
	const total = counts.reduce((a, b) => a + b, 0);
	check(`the die shows each face about a sixth of the time (${counts.slice(1).join(", ")} of ${total})`, counts.slice(1).every((n) => Math.abs(n / total - 1 / 6) < 0.03));
	check("an heir restored from the snapshot rolls exactly what the host would", same);
	check("the snapshot is a copy", (() => {
		const snap = h.snapshot();
		snap.pos[0] = 99;
		return h.view({ seat: null }).pos[0] !== 99 || snap === null;
	})());
}
console.log("\nplaying on for places");
/** A game of `ids` on a plain board, tokens set at `pos`, `first` to roll. */
function rigged(ids, pos, first = ids[0]) {
	const g = game();
	g.init({ seats: seatsOf(...ids), opts: {}, seed: 3, match: 0, first });
	const snap = g.snapshot();
	snap.board = { ladders: [[4, 25], [55, 76]], snakes: [[48, 30], [92, 70]] };
	snap.pos = [...pos];
	g.restore({ snapshot: snap });
	return g;
}
/** Roll for whoever is on turn until `done(view)` or the game ends; returns the views seen. */
function rollUntil(g, done = () => false, max = 3000) {
	const seen = [];
	for (let i = 0; i < max && g.turn().length; i++) {
		const who = g.turn()[0];
		const refused = g.apply({ action: { roll: true }, by: who });
		if (refused) throw new Error(`${who}: ${refused}`);
		const v = g.view({ seat: null });
		seen.push(v);
		if (done(v)) break;
	}
	return seen;
}
check("places played for: 2 players 1, 3 players 2, 4-6 players 3", [2, 3, 4, 5, 6].map(placesOf).join() === "1,2,3,3,3");
{
	const g = rigged(["pA", "pB"], [99, 10]);
	const seen = rollUntil(g);
	const v = g.view({ seat: null });
	check("two players: the first home ends it (nothing left to play for)", v.over && v.home.length === 1 && g.result().ranking.length === 2 && g.result().ranking[0][0] === v.seats[v.home[0]]);
	check("…on 99 anything but a 1 left the token there", seen.filter((x) => x.last.seat === 0 && x.last.from === 99 && x.last.roll !== 1).every((x) => x.pos[0] === 99 || x.last.to !== 99 + x.last.roll));
}
{
	const g = rigged(["pA", "pB", "pC"], [99, 60, 30]);
	rollUntil(g, (v) => v.home.length === 1);
	let v = g.view({ seat: null });
	const first = v.home[0];
	check("three players: someone reaches 100 and the game goes on", !v.over && g.result() === null && g.turn().length === 1, JSON.stringify({ home: v.home, over: v.over }));
	check("…their place is first, the view says so", v.winner === null && v.last.place === 1 && v.pos[first] === SIZE);
	const seen = rollUntil(g);
	v = g.view({ seat: null });
	check("…the token home rolls no more: never on turn again", seen.every((x) => x.last.seat !== first));
	check("…a roll from it is refused", g.apply({ action: { roll: true }, by: v.seats[first] }) === "the game is over" || g.apply({ action: { roll: true }, by: v.seats[first] }) === "you are home");
	const r = g.result();
	check("…it ends when second place is decided: 1st and 2nd as they finished, then the last", v.over && v.home.length === 2 && JSON.stringify(r.ranking) === JSON.stringify([[v.seats[v.home[0]]], [v.seats[v.home[1]]], v.seats.filter((_, i) => !v.home.includes(i))]), JSON.stringify(r.ranking));
	check("…the winner is the first home", v.winner === v.home[0]);
	check("nobody is on turn after, and a roll is refused", g.turn().length === 0 && g.apply({ action: { roll: true }, by: "pB" }) === "the game is over");
	check("the end card counts rolls, ladders and snakes", r.details.map((d) => d.label).join() === "Rolls,Ladders climbed,Snakes slid down");
}
{
	const g = rigged(["pA", "pB", "pC", "pD", "pE"], [99, 98, 97, 20, 10]);
	rollUntil(g);
	const v = g.view({ seat: null });
	const r = g.result();
	check("five players: play goes on until third place is decided", v.over && v.home.length === 3 && r.ranking.slice(0, 3).every((ids, k) => ids.length === 1 && ids[0] === v.seats[v.home[k]]), JSON.stringify({ home: v.home, ranking: r.ranking }));
	const rest = r.ranking.slice(3).flat();
	check("…the rest placed by how far up they got", rest.length === 2 && v.pos[v.seats.indexOf(rest[0])] >= v.pos[v.seats.indexOf(rest[1])], JSON.stringify({ rest, pos: v.pos }));
}
{
	// pB is furthest up, then leaves: placed last all the same.
	const g = rigged(["pA", "pB", "pC", "pD"], [10, 95, 5, 0]);
	check("a player who leaves comes off the rotation", g.leave({ seat: "pB" }) && g.turn()[0] === "pA");
	rollUntil(g);
	const r = g.result();
	check("…and is placed last, however far up they were", JSON.stringify(r.ranking.at(-1)) === '["pB"]' && r.ranking.flat().length === 4, JSON.stringify(r.ranking));
}
{
	const g = rigged(["pA", "pB", "pC"], [99, 50, 40]);
	rollUntil(g, (v) => v.home.length === 1);
	const v0 = g.view({ seat: null });
	const firstId = v0.seats[v0.home[0]];
	check("a player home who then leaves keeps their place", g.leave({ seat: firstId }) && !g.view({ seat: null }).over);
	rollUntil(g);
	check("…first, in the result", g.result().ranking[0][0] === firstId, JSON.stringify(g.result().ranking));
}
{
	const g = rigged(["pA", "pB", "pC"], [0, 0, 0]);
	check("a skip passes the turn without a roll", g.skip() && g.turn()[0] === "pB" && g.view({ seat: null }).rolls === 0);
	check("one left racing after the rest left: decided, them first", g.leave({ seat: "pB" }) && g.leave({ seat: "pC" }) && g.view({ seat: null }).over && g.view({ seat: null }).winner === 0 && JSON.stringify(g.result().ranking) === '[["pA"],["pB","pC"]]', JSON.stringify(g.result()?.ranking));
}

console.log("\nwho rolls first, between rematches");
{
	const seats = seatsOf("pA", "pB", "pC", "pD");
	const g = game();
	g.init({ seats, opts: {}, seed: 1, match: 0, first: "pD" });
	check("the platform's `first` rolls first", g.turn()[0] === "pD");
	const h = game();
	h.init({ seats, opts: {}, seed: 6, match: 0 });
	const openers = [h.turn()[0]];
	for (let m = 1; m < 5; m++) {
		h.init({ seats, opts: {}, seed: 1000 + m, match: m });
		openers.push(h.turn()[0]);
	}
	check("without `first`: drawn from the seed, then each rematch the next seat", openers.join() === "pC,pD,pA,pB,pC", openers.join());
	const heir = game();
	heir.restore({ snapshot: h.snapshot() });
	heir.init({ seats, opts: {}, seed: 5, match: 5 });
	check("…an heir's rematch goes on round the table", heir.turn()[0] === "pD");
	const boards = new Set();
	for (let m = 0; m < 4; m++) {
		h.init({ seats, opts: {}, seed: 2000 + m, match: m, first: "pA" });
		boards.add(JSON.stringify(h.view({ seat: null }).board));
	}
	check("every rematch deals a new board", boards.size === 4);
}

console.log("\nbots finish games");
for (const n of [2, 4, 6]) {
	const ids = ["botA", "botB", "botC", "botD", "botE", "botF"].slice(0, n);
	let done = 0;
	let longest = 0;
	let refused = 0;
	for (let m = 0; m < 10; m++) {
		const g = game();
		g.init({ seats: seatsOf(...ids), opts: {}, seed: 300 + m, match: m });
		let i = 0;
		for (; i < 3000 && g.turn().length; i++) {
			const who = g.turn()[0];
			if (g.apply({ action: g.bot({ seat: who }), by: who }) !== undefined) refused++;
		}
		if (g.result()) done++;
		longest = Math.max(longest, i);
	}
	check(`${n} bots finish all 10 games, no move refused; the longest took ${longest} turns`, done === 10 && refused === 0, `${done}/10, ${refused} refused`);
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall snakes-and-ladders checks passed");
process.exit(failures ? 1 : 0);
