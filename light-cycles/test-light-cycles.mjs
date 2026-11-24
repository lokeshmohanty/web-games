#!/usr/bin/env node
/**
 * test-light-cycles.mjs — the arena simulation, with no arena drawn.
 *
 *   node light-cycles/test-light-cycles.mjs
 *
 * The one rule worth testing hard is what happens when two riders enter the
 * same cell on the same tick. Resolving riders one at a time gets that wrong in
 * a way that is nearly invisible in play — the rider earlier in the array
 * survives, the other one "hits a wall" that did not exist when it set off —
 * and it decides rounds. So `advance` is a pure function over a grid and a list
 * of riders, and it is exercised here rather than through a canvas.
 *
 * The bot is measured the same way Onitama's is: against the thing it has to
 * beat to be worth playing, which for a space-filling game is a rider that
 * merely avoids dying.
 */
import { readFileSync } from "node:fs";

// The rules alone: no document, no platform.
new Function(readFileSync(new URL("./light-cycles-rules.js", import.meta.url), "utf8"))();
const R = globalThis.lightCycleRules;
const { COLS, ROWS, ORDER, STEP, SPAWNS, idx, inBounds, openSpace, distancesFrom, territory, botDirection, advance } = R;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};

const newGrid = () => new Uint8Array(COLS * ROWS);
const rider = (c, r, dir) => ({ c, r, dir, alive: true });
const place = (grid, riders) => riders.forEach((x, i) => (grid[idx(x.c, x.r)] = i + 1));

// ---------------------------------------------------------------------------
console.log("\nthe arena");

{
	check("eight spawns for eight seats", SPAWNS.length === 8);
	check("every spawn is on the board", SPAWNS.every((s) => inBounds(s.c, s.r)));
	check("no two riders start on the same cell", new Set(SPAWNS.map((s) => `${s.c},${s.r}`)).size === 8);
	// Facing a wall from the off would be a coin-flip death nobody chose.
	const facingWall = SPAWNS.filter((s) => {
		const [dc, dr] = STEP[s.d];
		return !inBounds(s.c + dc, s.r + dr);
	});
	check("nobody starts facing a wall", facingWall.length === 0, JSON.stringify(facingWall));
	// The first two seats are the two-player case. They must approach from
	// opposite sides but NOT down the same row — see the note by SPAWNS.
	check("the two-player spawns come from opposite sides",
		SPAWNS[0].d === "E" && SPAWNS[1].d === "W" && SPAWNS[0].c < SPAWNS[1].c);
	check("and are offset, so going straight is not a mutual suicide",
		Math.abs(SPAWNS[0].r - SPAWNS[1].r) >= 4, `${SPAWNS[0].r} vs ${SPAWNS[1].r}`);
	// No spawn may be another one rotated 180° about the centre. Two riders in
	// mirrored positions see mirrored arenas and die on the same tick — it turns
	// rounds into draws and it is invisible in the numbers. See the note on
	// SPAWNS in the game.
	const mirrors = [];
	for (let i = 0; i < SPAWNS.length; i++) {
		for (let j = i + 1; j < SPAWNS.length; j++) {
			if (SPAWNS[i].c + SPAWNS[j].c === COLS - 1 && SPAWNS[i].r + SPAWNS[j].r === ROWS - 1) {
				mirrors.push(`${i}/${j}`);
			}
		}
	}
	check("no spawn is another one rotated 180°", mirrors.length === 0, mirrors.join(", "));
}

// ---------------------------------------------------------------------------
console.log("\nmoving and crashing");

{
	const grid = newGrid();
	const riders = [rider(10, 10, "E")];
	place(grid, riders);
	advance(grid, riders);
	check("a rider moves one cell", riders[0].c === 11 && riders[0].r === 10, JSON.stringify(riders[0]));
	check("and leaves a wall where it was", grid[idx(10, 10)] === 1);
	check("and one where it now is", grid[idx(11, 10)] === 1);
}

{
	const grid = newGrid();
	const riders = [rider(COLS - 1, 10, "E")];
	place(grid, riders);
	advance(grid, riders);
	check("riding off the edge kills you", riders[0].alive === false);
	check("a dead rider does not move", riders[0].c === COLS - 1);
}

{
	const grid = newGrid();
	const riders = [rider(10, 10, "E")];
	place(grid, riders);
	grid[idx(11, 10)] = 9; // somebody else's wall
	advance(grid, riders);
	check("riding into a wall kills you", riders[0].alive === false);
}

{
	// The head-on. Two riders one cell apart, closing.
	const grid = newGrid();
	const riders = [rider(10, 10, "E"), rider(12, 10, "W")];
	place(grid, riders);
	advance(grid, riders);
	check("a head-on kills both, not whichever came second",
		riders[0].alive === false && riders[1].alive === false,
		JSON.stringify(riders.map((x) => x.alive)));
	check("neither claimed the contested cell", grid[idx(11, 10)] === 0, `${grid[idx(11, 10)]}`);
}

{
	// The near-miss that must NOT be treated as a head-on: they swap columns
	// but on different rows.
	const grid = newGrid();
	const riders = [rider(10, 10, "E"), rider(12, 11, "W")];
	place(grid, riders);
	advance(grid, riders);
	check("riders passing on different rows both live", riders.every((x) => x.alive));
}

{
	// Order must not decide anything. The same collision with the riders listed
	// the other way round has to end the same way.
	const a = { grid: newGrid(), riders: [rider(10, 10, "E"), rider(12, 10, "W")] };
	const b = { grid: newGrid(), riders: [rider(12, 10, "W"), rider(10, 10, "E")] };
	for (const s of [a, b]) {
		place(s.grid, s.riders);
		advance(s.grid, s.riders);
	}
	check("array order does not decide a collision",
		a.riders.every((x) => !x.alive) && b.riders.every((x) => !x.alive));
}

{
	const grid = newGrid();
	const riders = [rider(10, 10, "E"), rider(20, 20, "N")];
	riders[1].alive = false;
	place(grid, riders);
	const before = { ...riders[1] };
	advance(grid, riders);
	check("a crashed rider stays put and stays dead",
		!riders[1].alive && riders[1].c === before.c && riders[1].r === before.r);
}

// ---------------------------------------------------------------------------
console.log("\nopen space");

{
	const grid = newGrid();
	// The whole board minus nothing: an empty arena must not saturate a cap, or
	// every option ties and the bot stops choosing. See the note on openSpace.
	check("an empty arena reports the whole arena", openSpace(grid, 20, 20) === COLS * ROWS, `${openSpace(grid, 20, 20)}`);
	check("a wall cell has no room at all", (grid[idx(20, 20)] = 1, openSpace(grid, 20, 20) === 0));

	// Box a cell in and the answer must collapse to what is actually enclosed.
	const boxed = newGrid();
	for (let c = 8; c <= 12; c++) {
		boxed[idx(c, 8)] = 1;
		boxed[idx(c, 12)] = 1;
	}
	for (let r = 8; r <= 12; r++) {
		boxed[idx(8, r)] = 1;
		boxed[idx(12, r)] = 1;
	}
	check("a sealed box reports only the cells inside it", openSpace(boxed, 10, 10) === 9, `${openSpace(boxed, 10, 10)}`);
}

// ---------------------------------------------------------------------------
console.log("\nthe bot");

{
	const grid = newGrid();
	const r = rider(COLS - 1, 20, "E");
	place(grid, [r]);
	const dir = botDirection(grid, r);
	check("it does not ride into the wall it is facing", dir !== "E", dir);

	// A corridor with one way out: it must find it rather than pick by habit.
	const trap = newGrid();
	for (let c = 0; c < COLS; c++) {
		trap[idx(c, 9)] = 1;
		trap[idx(c, 11)] = 1;
	}
	trap[idx(21, 10)] = 1; // straight ahead is blocked, and the corridor walls the rest
	const boxedIn = rider(20, 10, "E");
	check("a rider with no legal turn still returns a direction", !!botDirection(trap, boxedIn));
}

/**
 * Play a whole round. `pick` decides each rider's direction; the simulation is
 * the real one.
 */
function playRound(pickers, maxTicks = 4000) {
	const grid = newGrid();
	const riders = pickers.map((_, i) => ({ ...SPAWNS[i], dir: SPAWNS[i].d, alive: true }));
	place(grid, riders);
	for (let t = 0; t < maxTicks; t++) {
		for (let i = 0; i < riders.length; i++) {
			if (riders[i].alive) riders[i].dir = pickers[i](grid, riders[i], riders.filter((o, j) => j !== i && o.alive));
		}
		advance(grid, riders);
		const alive = riders.filter((x) => x.alive);
		if (alive.length <= 1) return { winner: riders.indexOf(alive[0]), ticks: t + 1, riders, grid };
	}
	return { winner: -2, ticks: maxTicks, riders, grid };
}

/** Turns only to stay alive, and otherwise ploughs on. The baseline. */
const survivor = (grid, r) => {
	const i = ORDER.indexOf(r.dir);
	for (const d of [ORDER[i], ORDER[(i + 1) % 4], ORDER[(i + 3) % 4]]) {
		const [dc, dr] = STEP[d];
		if (inBounds(r.c + dc, r.r + dr) && !grid[idx(r.c + dc, r.r + dr)]) return d;
	}
	return r.dir;
};

{
	const ROUNDS = 30;
	let botWins = 0;
	let botLosses = 0;
	let draws = 0;
	let unfinished = 0;
	let totalTicks = 0;
	for (let i = 0; i < ROUNDS; i++) {
		// Swap seats each round: seat 0 rides east from the left, and a spawn
		// advantage would otherwise read as bot strength.
		const botSeat = i % 2;
		const pickers = [0, 1].map((seat) => (seat === botSeat ? botDirection : survivor));
		const out = playRound(pickers);
		totalTicks += out.ticks;
		if (out.winner === -2) unfinished++;
		else if (out.winner < 0) draws++;
		else if (out.winner === botSeat) botWins++;
		else botLosses++;
	}
	check("every round ended", unfinished === 0, `${unfinished} hit the tick cap`);
	check("rounds are short enough to be casual", totalTicks / ROUNDS < 600, `${Math.round(totalTicks / ROUNDS)} ticks average`);
	// The whole point of the flood fill. A bot that merely avoids walls would
	// land near half.
	// Draws are counted separately rather than folded into the loss column: a
	// mutual crash is a legitimate result of two riders meeting, not the bot
	// being outplayed. What has to be rare is *losing*.
	check(`the bot beats a rider that only avoids crashing (${botWins}W ${botLosses}L ${draws}D of ${ROUNDS})`,
		botWins >= 27 && botLosses <= 2, `${botWins}W ${botLosses}L ${draws}D`);
}

{
	// Eight bots at once is the busiest the arena gets, and it is also the worst
	// case for the search: the host runs every one of them, on a phone, ten
	// times a second. Territory scoring is four breadth-first sweeps per rider
	// per tick, so this is worth a number rather than a shrug.
	const grid = newGrid();
	const riders = SPAWNS.map((sp) => ({ ...sp, dir: sp.d, alive: true }));
	place(grid, riders);
	for (let t = 0; t < 40; t++) {
		for (const r of riders) if (r.alive) r.dir = botDirection(grid, r, riders.filter((o) => o !== r && o.alive));
		advance(grid, riders);
	}
	const t0 = Date.now();
	for (const r of riders) if (r.alive) botDirection(grid, r, riders.filter((o) => o !== r && o.alive));
	const perTick = Date.now() - t0;
	// One tick is 100ms of wall clock at the starting speed, and the host has to
	// draw a frame in it too.
	check("a full eight-bot tick fits inside its own tick", perTick < 25, `${perTick}ms`);
}

{
	// Eight bots at once is the busiest the arena gets, and it is the case where
	// a collision-resolution bug would leave two riders alive on one cell.
	const out = playRound(Array.from({ length: 8 }, () => botDirection));
	check("an eight-bot round resolves to one rider or none", out.winner >= -1, `${out.winner}`);
	const alive = out.riders.filter((x) => x.alive);
	check("no two survivors share a cell",
		new Set(alive.map((x) => `${x.c},${x.r}`)).size === alive.length);
	check("every wall belongs to exactly one rider", out.grid.every((v) => v >= 0 && v <= 8));
}

// ---------------------------------------------------------------------------
console.log("\nthe round, as the platform runs it");

{
	const { HZ, KEY_EVERY, game } = R;
	const dt = 1 / HZ;
	const rules = game();
	const seats = [{ id: "pA", bot: false }, { id: "bot_1", bot: true }, { id: "bot_2", bot: true }];
	rules.init({ seats, opts: {}, seed: 1, match: 0 });
	let v = rules.view({ seat: "pA" });
	check("a round opens on a countdown", v.countdown === 4 && !v.racing && !v.decided);
	check("with the whole grid, three heads on it", typeof v.grid === "string" && [...v.grid].filter((x) => x !== "0").length === 3);
	check("bots do not think during the countdown", rules.bot({ seat: "bot_1" }) === null);
	check("moves are not actions: steering is input", typeof rules.apply({ action: { d: "N" }, by: "pA" }) === "string");
	let ticks = 0;
	const inputs = {};
	const run = (n, each) => {
		for (let i = 0; i < n; i++) {
			for (const id of ["bot_1", "bot_2"]) {
				const b = rules.bot({ seat: id });
				if (b) inputs[id] = b;
			}
			each?.();
			rules.tick({ inputs: { ...inputs }, dt });
			ticks++;
		}
	};
	run(Math.ceil((4 * 800) / (1000 / HZ)));
	v = rules.view({ seat: "pA" });
	check("3-2-1-GO takes 3.2 s of ticks", v.racing && v.countdown === 0, JSON.stringify({ c: v.countdown, r: v.racing, ticks }));
	const at = v.riders[0];
	run(2);
	v = rules.view({ seat: "pA" });
	check("a step every 100 ms at first (two ticks)", v.step === 1 && v.riders[0].c === at.c + 1, JSON.stringify(v.riders[0]));
	check("between full grids, a view carries only heads", v.step % KEY_EVERY === 0 || !("grid" in v));
	// Steer north: numbered, for this round.
	inputs.pA = { d: "N", n: 1, r: v.round };
	run(2);
	v = rules.view({ seat: "pA" });
	check("steering turns the rider", v.riders[0].dir === "N" && v.riders[0].r === at.r - 1, JSON.stringify(v.riders[0]));
	inputs.pA = { d: "S", n: 2, r: v.round };
	run(2);
	check("a reversal is refused", rules.view({ seat: "pA" }).riders[0].dir === "N");
	inputs.pA = { d: "E", n: 2, r: v.round };
	run(2);
	check("the same press is not taken twice", rules.view({ seat: "pA" }).riders[0].dir === "N");
	inputs.pA = { d: "E", n: 3, r: v.round + 1 };
	run(2);
	check("a press from another round is ignored", rules.view({ seat: "pA" }).riders[0].dir === "N");
	// The person rides into the top wall; the bots play it out.
	run(4000);
	v = rules.view({ seat: "pA" });
	check("the round ends by itself", v.decided && !v.racing, JSON.stringify({ step: v.step }));
	const r = rules.result();
	check("the result: the last rider moving first", r?.kind === "ffa" && (v.winner === null ? r.ranking.length === 1 : r.ranking[0][0] === v.winner), JSON.stringify(r));
	check("the winner's win is counted", v.winner === null || v.riders.find((x) => x.id === v.winner).wins === 1);
	check("the end card: a winner's is derived, nobody standing says so", v.winner === null ? r.title === "EVERYONE CRASHED" : !("title" in r), JSON.stringify(r));
	check("with other riders the result carries no score and no details (unchanged)", !("scores" in r) && !("details" in r), JSON.stringify(r));
	check("a decided round carries the whole grid", typeof v.grid === "string");
	const wins = Object.fromEntries(v.riders.map((x) => [x.id, x.wins]));
	rules.init({ seats, opts: {}, seed: 2, match: 1 });
	v = rules.view({ seat: null });
	check("PLAY AGAIN is the next round, wins carried", v.round === 2 && v.countdown === 4 && v.riders.every((x) => x.wins === wins[x.id]));
	run(Math.ceil((4 * 800) / (1000 / HZ)) + 20);
	const snap = JSON.parse(JSON.stringify(rules.snapshot()));
	const heir = game();
	heir.restore({ snapshot: snap });
	v = heir.view({ seat: null });
	check("the heir starts an undecided round again", v.countdown === 4 && v.step === 0 && v.round === 3 && v.riders.every((x) => x.wins === wins[x.id]), JSON.stringify({ c: v.countdown, s: v.step, r: v.round }));
	check("a player who left the party is out of the round", heir.leave({ seat: "pA" }) === true && !heir.view({ seat: null }).riders[0].alive);
}

{
	// The clock tightens as before: 10 ms every 120 steps, down to 60.
	const rules = R.game();
	rules.init({ seats: [{ id: "bot_1", bot: true }], opts: {}, seed: 1, match: 0 });
	const inputs = {};
	let steps = 0;
	for (let i = 0; i < 4000 && !rules.view({ seat: null }).decided; i++) {
		const b = rules.bot({ seat: "bot_1" });
		if (b) inputs.bot_1 = b;
		rules.tick({ inputs, dt: 1 / R.HZ });
		steps = rules.view({ seat: null }).step;
	}
	const v = rules.view({ seat: null });
	check("alone, the round ends when you crash", v.decided && v.winner === null, JSON.stringify({ steps }));
	const ridden = Math.floor((rules.snapshot().raceMs) / 1000);
	check("alone, the end card says how long you rode", rules.result()?.title === `CRASHED AFTER ${Math.floor(ridden / 60)}:${String(ridden % 60).padStart(2, "0")}` && ridden > 0, rules.result()?.title);
	check("the clock tightens every 120 steps", steps < 120 || v.tickMs === 100 - 10 * Math.min(4, Math.floor(steps / 120)), `${steps} steps, ${v.tickMs} ms`);
	const raceMs = rules.snapshot().raceMs;
	const r = rules.result();
	const secs = r?.scores?.bot_1;
	check("alone, the result's score is the race time survived, in seconds to the tenth, rounded down", secs === Math.floor(raceMs / 100) / 10 && secs === R.survived(raceMs) && Number.isInteger(Math.round(secs * 10)) && Math.abs(secs * 10 - Math.round(secs * 10)) < 1e-9 && secs <= raceMs / 1000, JSON.stringify({ secs, raceMs }));
	check("…and the end card's details say it, with the squares ridden", r?.details?.[0]?.label === "Time survived" && r.details[0].value === `${secs.toFixed(1)} s` && r.details[1]?.value === steps, JSON.stringify(r?.details));
}

{
	// The arcade's leaderboard checks a solo score against its own clock: the
	// score can never pass the wall time since the round began. Played on
	// ticks, wall time is at least ticks / HZ, and the countdown (4 beats) is
	// in it but never in the score.
	const rules = R.game();
	rules.init({ seats: [{ id: "pA", bot: false }], opts: {}, seed: 1, match: 0 });
	let ticks = 0;
	const inputs = {};
	// Turn back into your own trail at once — up, left, down, one square
	// apart — the shortest round there is.
	const presses = ["N", "W", "S"];
	for (; ticks < 4000 && !rules.view({ seat: null }).decided; ticks++) {
		const v = rules.view({ seat: null });
		const n = v.step; // one press after each of the first three squares
		if (v.racing && n >= 1 && n <= presses.length) inputs.pA = { d: presses[n - 1], r: v.round, n };
		rules.tick({ inputs, dt: 1 / R.HZ });
	}
	const r = rules.result();
	const secs = r?.scores?.pA;
	const wall = ticks / R.HZ;
	check("the shortest solo round: a crash into your own trail a few squares after GO", rules.view({ seat: null }).decided && rules.snapshot().step <= 6, JSON.stringify({ step: rules.snapshot().step, secs }));
	check("…its score is under a second", typeof secs === "number" && secs < 1, String(secs));
	check("…the round took at least the countdown, which the score leaves out", wall >= (4 * R.COUNT_MS) / 1000 && secs <= wall - (4 * R.COUNT_MS) / 1000 + 1e-9, JSON.stringify({ wall, secs }));
}


// ---------------------------------------------------------------------------
console.log("\nwho starts where, from the seed");

{
	// Lokesh, 2026-11-24: spawn variety. Each round deals the seats to the
	// spawns afresh, from the round's seed, so a seat is not always the one
	// riding east from the left. The spawns themselves stay the designed ones
	// (the first n for n riders), so the no-mirror and offset rules above
	// still hold for every table.
	const { game } = R;
	const key = (s) => `${s.c},${s.r},${s.dir}`;
	const spawnsOf = (seed, n = 2) => {
		const rules = game();
		rules.init({ seats: Array.from({ length: n }, (_, i) => ({ id: `b${i}`, bot: true })), opts: {}, seed, match: 0 });
		return rules.view({ seat: null }).riders.map(key);
	};
	const firsts = new Set();
	for (let seed = 1; seed <= 40; seed++) firsts.add(spawnsOf(seed)[0]);
	check("seat 0 does not always start on the same spawn", firsts.size === 2, [...firsts].join(" | "));
	check("the same seed deals the same spawns (a run replays)", spawnsOf(7, 5).join() === spawnsOf(7, 5).join());
	const designed = (n) => SPAWNS.slice(0, n).map((s) => `${s.c},${s.r},${s.d}`).sort().join();
	let same = true;
	for (let seed = 1; seed <= 30 && same; seed++) for (const n of [2, 3, 5, 8]) if (spawnsOf(seed, n).sort().join() !== designed(n)) same = false;
	check("n riders always use the n designed spawns, only in another order", same);
	// PLAY AGAIN is a new round with a new seed: the deal changes between rounds too.
	const rules = game();
	const seats = [{ id: "pA", bot: false }, { id: "b1", bot: true }, { id: "b2", bot: true }];
	const deals = new Set();
	for (let m = 0; m < 8; m++) {
		rules.init({ seats, opts: {}, seed: 100 + m, match: m });
		deals.add(rules.view({ seat: null }).riders.map(key).join());
	}
	check("rounds of one run deal the seats differently", deals.size > 1, `${deals.size} deals in 8 rounds`);
}

// ---------------------------------------------------------------------------
console.log("\nobstacles");

{
	const { game, obstaclesFor, WALL } = R;
	check("obstacles are drawn with their own wall value, not a rider's", WALL === 9);
	// The lanes every spawn rides out on: its own cell and the 3x3 round it,
	// and 12 cells ahead, a cell either side. None may hold a block.
	const lanes = new Set();
	for (const sp of SPAWNS) {
		const [dc, dr] = STEP[sp.d];
		for (let k = -1; k <= 12; k++)
			for (let w = -1; w <= 1; w++) {
				const c = sp.c + dc * k + (dr ? w : 0);
				const r = sp.r + dr * k + (dc ? w : 0);
				if (inBounds(c, r)) lanes.add(idx(c, r));
			}
	}
	let inLane = 0;
	let counts = [];
	const layouts = new Set();
	for (let seed = 1; seed <= 50; seed++) {
		const cells = obstaclesFor(seed);
		counts.push(cells.length);
		layouts.add(cells.join());
		inLane += cells.filter((i) => lanes.has(i)).length;
		if (cells.some((i) => i < 0 || i >= COLS * ROWS)) inLane += 1000;
	}
	check("no block sits in a spawn lane, on any of 50 seeds", inLane === 0, `${inLane} cells`);
	check("a few blocks: 12 to 30 cells of the 1600", Math.min(...counts) >= 12 && Math.max(...counts) <= 30, `${Math.min(...counts)}–${Math.max(...counts)}`);
	check("each seed lays them out differently", layouts.size >= 45, `${layouts.size} layouts of 50`);
	check("the same seed lays the same blocks", obstaclesFor(9).join() === obstaclesFor(9).join());
	// Every rider can still reach almost all of the arena from its spawn.
	let worst = Infinity;
	for (let seed = 1; seed <= 20; seed++) {
		const grid = newGrid();
		for (const i of obstaclesFor(seed)) grid[i] = WALL;
		for (const sp of SPAWNS) worst = Math.min(worst, openSpace(grid, sp.c, sp.r));
	}
	check("the blocks never wall a spawn off: every spawn reaches 95% of the arena", worst >= 0.95 * COLS * ROWS, `${worst}`);
}

{
	// The setup, the first time only (Lokesh, 2026-11-23, as Ludo): friends'
	// first round asks the host; PLAY AGAIN goes straight in with what was
	// picked; one person, alone or with bots, goes straight in with the last
	// options kept on their phone (`last()`).
	const { HZ, game, WALL } = R;
	const friends = [{ id: "pA", bot: false }, { id: "pB", bot: false }, { id: "b1", bot: true }];
	const walls = (v) => [...(v.grid ?? "")].filter((x) => x === String(WALL)).length;
	let rules = game({ isHost: (id) => id === "pA" });
	rules.init({ seats: friends, opts: {}, seed: 3, match: 0 });
	let v = rules.view({ seat: "pA" });
	check("friends' first round: the setup, obstacles off", v.phase === "setup" && v.obstacles === false && walls(v) === 0, JSON.stringify({ phase: v.phase, o: v.obstacles }));
	for (let i = 0; i < 100; i++) rules.tick({ inputs: {}, dt: 1 / HZ });
	check("…the countdown waits for START", rules.view({ seat: null }).countdown === 4 && !rules.view({ seat: null }).racing);
	check("…only the host sets it up", typeof rules.apply({ action: { obstacles: true }, by: "pB" }) === "string");
	check("…the host turns obstacles on", rules.apply({ action: { obstacles: true }, by: "pA" }) === undefined && rules.view({ seat: null }).obstacles === true);
	v = rules.view({ seat: null });
	check("…and the blocks show on the arena at once", walls(v) >= 12, `${walls(v)}`);
	check("…off again, and they go", rules.apply({ action: { obstacles: false }, by: "pA" }) === undefined && walls(rules.view({ seat: null })) === 0);
	rules.apply({ action: { obstacles: true }, by: "pA" });
	check("…START", rules.apply({ action: { start: true }, by: "pA" }) === undefined && rules.view({ seat: null }).phase === "play");
	check("…steering is still input, not a move", typeof rules.apply({ action: { d: "N" }, by: "pA" }) === "string");
	// A rider into a block crashes, as into any wall.
	const grid0 = rules.view({ seat: null }).grid;
	check("a block is a wall to the bots' search", R.botDirection(Uint8Array.from(grid0, Number), { c: 0, r: 0, dir: "E" }) !== undefined);
	check("…the next game is picked only once this one is over", typeof rules.setNext({ obstacles: false }) === "string");
	// Play it out, then PLAY AGAIN: straight in, obstacles still on, new blocks.
	const inputs = {};
	for (let i = 0; i < 6000 && !rules.view({ seat: null }).decided; i++) {
		const b = rules.bot({ seat: "b1" });
		if (b) inputs.b1 = b;
		rules.tick({ inputs, dt: 1 / HZ });
	}
	check("the round with obstacles ends", rules.view({ seat: null }).decided);
	const next = rules.nextGame();
	check("the end: the next game is this one's (obstacles)", next.obstacles === true, JSON.stringify(next));
	check("…CHANGE: an open arena next", rules.setNext({ obstacles: false }) === undefined && rules.nextGame().obstacles === false);
	rules.init({ seats: friends, opts: {}, seed: 4, match: 1 });
	v = rules.view({ seat: null });
	check("PLAY AGAIN: straight in, with the next game's pick", v.phase === "play" && v.obstacles === false && walls(v) === 0, JSON.stringify({ phase: v.phase, o: v.obstacles }));
	// One person with bots: straight in, on the options kept on the phone.
	rules = game({ last: () => ({ obstacles: true }) });
	rules.init({ seats: [{ id: "pA", bot: false }, { id: "b1", bot: true }], opts: {}, seed: 5, match: 0 });
	v = rules.view({ seat: null });
	check("one person with bots: no setup, the phone's last options (obstacles)", v.phase === "play" && v.obstacles === true && walls(v) >= 12, JSON.stringify({ phase: v.phase, o: v.obstacles }));
	rules = game();
	rules.init({ seats: [{ id: "pA", bot: false }], opts: {}, seed: 5, match: 0 });
	v = rules.view({ seat: null });
	check("alone, nothing kept: no setup, an open arena", v.phase === "play" && v.obstacles === false && walls(v) === 0);
	// A handover during the setup keeps it.
	rules = game({ isHost: () => true });
	rules.init({ seats: friends, opts: {}, seed: 6, match: 0 });
	rules.apply({ action: { obstacles: true }, by: "pA" });
	const heir = game({ isHost: () => true });
	heir.restore({ snapshot: JSON.parse(JSON.stringify(rules.snapshot())) });
	v = heir.view({ seat: null });
	check("the heir keeps the setup and its pick", v.phase === "setup" && v.obstacles === true && walls(v) >= 12, JSON.stringify({ phase: v.phase, o: v.obstacles }));
	check("someone leaving during the setup leaves the table", heir.leave({ seat: "pB" }) === true && heir.view({ seat: null }).riders.length === 2);
}

console.log(failures ? `\n${failures} failing\n` : "\nall passing\n");
process.exit(failures ? 1 : 0);
