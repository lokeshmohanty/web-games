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
const { SIZE, TURNS, MIN_ROLLS, MAX_ROLLS, SECONDS_PER_TURN, MIN_SPAN, MAX_LADDER, MAX_SNAKE, rng, rowOf, colOf, step, unfair, measure, layout, game } = globalThis.snakesAndLaddersRules;

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
	const SEEDS = 60;
	for (const players of [2, 3, 4, 6]) {
		const problems = [];
		const turns = [];
		const rolls = [];
		const boards = new Set();
		const feet = new Set();
		const heads = new Set();
		for (let seed = 1; seed <= SEEDS; seed++) {
			const b = layout(seed * 104729, players);
			const why = unfair(b);
			if (why) problems.push(`${seed}: ${why}`);
			boards.add(JSON.stringify([b.snakes, b.ladders]));
			b.ladders.forEach(([a]) => feet.add(Math.floor(a / 10)));
			b.snakes.forEach(([h]) => heads.add(Math.floor(h / 10)));
			// Measured again on other dice, many more games than the deal uses.
			const m = measure(b, players, rng(seed), 600);
			turns.push(m.turns);
			rolls.push(m.rolls);
		}
		const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
		check(`${players} players: every board is fair (${SEEDS} seeds)`, !problems.length, problems.slice(0, 3).join("; "));
		check(`${players} players: every seed deals a different board`, boards.size === SEEDS, `${boards.size}`);
		check(`${players} players: ladders start, and snakes bite, all over the board`, feet.size >= 8 && heads.size >= 7, `feet in ${feet.size} decades, heads in ${heads.size}`);
		const mt = mean(turns);
		const mr = mean(rolls);
		check(
			`${players} players: one token climbs in ${Math.round(Math.min(...rolls))}-${Math.round(Math.max(...rolls))} rolls (average ${mr.toFixed(0)}; kept near ${MIN_ROLLS}-${MAX_ROLLS})`,
			Math.min(...rolls) >= MIN_ROLLS - 6 && Math.max(...rolls) <= MAX_ROLLS + 16 && mr >= MIN_ROLLS && mr <= MAX_ROLLS + 4,
		);
		// The turns target is reached where one token's climb allows it (six
		// players); smaller tables are as long as a board may be (MAX_ROLLS).
		const [lo, hi] = TURNS;
		check(
			`${players} players: a game is ${Math.round(Math.min(...turns))}-${Math.round(Math.max(...turns))} turns (average ${mt.toFixed(0)}, about ${((mt * SECONDS_PER_TURN) / 60).toFixed(1)} min at ${SECONDS_PER_TURN} s a turn)`,
			mt <= hi && (players >= 6 ? mt >= lo - 10 : mr >= MAX_ROLLS - 8),
		);
	}
	check("the same seed and table deal the same board", JSON.stringify(layout(77, 4)) === JSON.stringify(layout(77, 4)));
	const t0 = performance.now();
	for (let seed = 0; seed < 10; seed++) layout(seed, 2);
	const ms = (performance.now() - t0) / 10;
	check(`dealing a board takes ${ms.toFixed(0)} ms (under 80, once a game)`, ms < 80);
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
{
	// A game to the end, by hand: force positions through the snapshot.
	const g = game();
	g.init({ seats: seatsOf("pA", "pB", "pC"), opts: {}, seed: 3, match: 0, first: "pA" });
	const snap = g.snapshot();
	snap.board = { ladders: [[4, 25], [55, 76]], snakes: [[48, 30], [92, 70]] };
	snap.pos = [99, 60, 30];
	g.restore({ snapshot: snap });
	let won = false;
	for (let i = 0; i < 500 && !won; i++) {
		const who = g.turn()[0];
		g.apply({ action: { roll: true }, by: who });
		const v = g.view({ seat: null });
		if (v.last.seat === 0 && v.last.from === 99 && v.last.roll !== 1) check("on 99 anything but a 1 leaves the token there", v.pos[0] === 99, JSON.stringify(v.last));
		won = v.winner !== null;
	}
	const v = g.view({ seat: null });
	const r = g.result();
	check("someone reaches 100 exactly and wins", won && v.pos[v.winner] === SIZE && r.ranking[0][0] === v.seats[v.winner]);
	check("the rest are placed by how far up they got", r.ranking.flat().length === 3 && r.ranking.slice(1).every((ids, k, all) => k === 0 || v.pos[v.seats.indexOf(all[k - 1][0])] > v.pos[v.seats.indexOf(ids[0])]), JSON.stringify({ r: r.ranking, pos: v.pos }));
	check("the end card counts rolls, ladders and snakes", r.details.map((d) => d.label).join() === "Rolls,Ladders climbed,Snakes slid down");
	check("nobody is on turn after, and a roll is refused", g.turn().length === 0 && g.apply({ action: { roll: true }, by: "pB" }) === "the game is over");
}
{
	const g = game();
	g.init({ seats: seatsOf("pA", "pB", "pC"), opts: {}, seed: 3, match: 0, first: "pA" });
	check("a skip passes the turn without a roll", g.skip() && g.turn()[0] === "pB" && g.view({ seat: null }).rolls === 0);
	check("a player leaving takes their token off the rotation", g.leave({ seat: "pB" }) && g.turn()[0] === "pC");
	check("…and the last one left wins", g.leave({ seat: "pC" }) && g.view({ seat: null }).winner === 0 && g.result().ranking[0][0] === "pA");
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
