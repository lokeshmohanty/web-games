#!/usr/bin/env node
/**
 * test-sudoku.mjs — the generator, the difficulties, the daily seed, the race.
 *
 *   node sudoku/test-sudoku.mjs
 *
 * The one thing a Sudoku must never do is hand out a puzzle with two answers:
 * the player fills it in correctly, the phone says it is wrong, and the race is
 * lost to the generator. So every level is generated many times here and every
 * puzzle is checked to have exactly one solution. The race is played here too,
 * through the same managed rules the platform runs on the host (SDK v2).
 */
import { readFileSync } from "node:fs";

// The rules alone: no document, no platform.
new Function(readFileSync(new URL("./sudoku-rules.js", import.meta.url), "utf8"))();
const R = globalThis.sudokuRules;
const {
	CELLS, PEERS, UNITS, LEVELS, LEVEL_IDS, countSolutions, solve, solvesWithSingles, generate, dailyPuzzle, rngFrom,
	toText, fromText, today, clock, standings, clearNotes,
} = R;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};

/** A filled grid obeys the rules: every unit holds 1..9 once. */
const valid = (g) => g.length === CELLS && UNITS.every((u) => new Set(u.map((i) => g[i])).size === 9 && u.every((i) => g[i] >= 1 && g[i] <= 9));

// ---------------------------------------------------------------------------
console.log("\nthe grid");

check("81 cells, 27 units", CELLS === 81 && UNITS.length === 27);
check("every cell has 20 peers", PEERS.every((p) => p.length === 20));

{
	// A known puzzle (the classic from Wikipedia's Sudoku article).
	const p = fromText("530070000600195000098000060800060003400803001700020006060000280000419005000080079");
	const s = solve(p);
	check("the solver solves", s && valid(s));
	check("and keeps the givens", p.every((d, i) => !d || s[i] === d));
	check("that puzzle has one solution", countSolutions(p) === 1);
	check("an empty grid has many", countSolutions(Array(81).fill(0)) === 2);
	check("singles finish it", solvesWithSingles(p));
	const broken = p.slice();
	broken[1] = 5; // two 5s in the top row
	check("a contradiction has none", countSolutions(broken) === 0);
}

// ---------------------------------------------------------------------------
console.log("\nthe difficulties");

for (const level of LEVEL_IDS) {
	const spec = LEVELS[level];
	const rng = rngFrom(1234 + level.length);
	const runs = level === "expert" ? 6 : 10;
	let unique = 0;
	let solutionsValid = 0;
	let consistent = 0;
	let singlesOk = 0;
	const clues = [];
	const t0 = performance.now();
	for (let i = 0; i < runs; i++) {
		const { puzzle, solution } = generate(level, rng);
		if (countSolutions(puzzle) === 1) unique++;
		if (valid(solution)) solutionsValid++;
		if (puzzle.every((d, j) => !d || solution[j] === d)) consistent++;
		const singles = solvesWithSingles(puzzle);
		if (spec.singles == null || singles === spec.singles) singlesOk++;
		clues.push(puzzle.filter(Boolean).length);
	}
	const ms = (performance.now() - t0) / runs;
	check(`${level}: every puzzle has exactly one solution`, unique === runs, `${unique}/${runs}`);
	check(`${level}: the solution is a valid grid`, solutionsValid === runs);
	check(`${level}: the givens agree with it`, consistent === runs);
	if (spec.singles === true) check(`${level}: finishable by singles alone`, singlesOk === runs, `${singlesOk}/${runs}`);
	if (spec.singles === false) check(`${level}: needs more than singles`, singlesOk >= runs - 1, `${singlesOk}/${runs}`);
	check(`${level}: clue count in range`, clues.every((c) => c >= spec.clues && c <= spec.clues + 12),
		clues.join(","));
	// The host makes the puzzle while everyone waits; keep it quick on a phone.
	check(`${level}: made in under a second`, ms < 1000, `${Math.round(ms)}ms`);
	console.log(`  ·    ${level}: ${Math.min(...clues)}–${Math.max(...clues)} clues, ~${Math.round(ms)}ms each`);
}

{
	// Fewer clues as it gets harder, on average.
	const avg = (level) => {
		const rng = rngFrom(99);
		let n = 0;
		for (let i = 0; i < 5; i++) n += generate(level, rng).puzzle.filter(Boolean).length;
		return n / 5;
	};
	const a = LEVEL_IDS.map(avg);
	check("harder levels give fewer clues", a.every((v, i) => !i || v < a[i - 1]), a.join(" > "));
}

// ---------------------------------------------------------------------------
console.log("\nthe daily puzzle");

{
	const a = dailyPuzzle("2026-11-13", "medium");
	const b = dailyPuzzle("2026-11-13", "medium");
	check("the same day gives the same puzzle", toText(a.puzzle) === toText(b.puzzle));
	check("another day gives another", toText(dailyPuzzle("2026-11-14", "medium").puzzle) !== toText(a.puzzle));
	check("another level gives another", toText(dailyPuzzle("2026-11-13", "hard").puzzle) !== toText(a.puzzle));
	check("today is a date", /^\d{4}-\d{2}-\d{2}$/.test(today()));
	check("in the player's own calendar", today(new Date(2026, 0, 5, 23, 30)) === "2026-01-05");
}

// ---------------------------------------------------------------------------
console.log("\nnotes");

{
	const notes = Array(81).fill(0);
	notes[0] = (1 << 4) | (1 << 7);
	notes[1] = 1 << 4; // same row as 0
	notes[9] = 1 << 4; // same column
	notes[10] = (1 << 4) | (1 << 2); // same box
	notes[80] = 1 << 4; // unrelated
	const after = clearNotes(notes, 0, 4);
	check("placing a digit clears that cell's notes", after[0] === 0);
	check("and the digit from its row, column and box", after[1] === 0 && after[9] === 0 && after[10] === 1 << 2);
	check("but not from anywhere else", after[80] === 1 << 4);
	check("and does not touch the original", notes[1] === 1 << 4);
}

// ---------------------------------------------------------------------------
console.log("\nthe race");

{
	const s = standings(["a", "b", "c", "d"], { a: 10, b: 51, c: 30, d: 30 }, "b");
	check("the winner is first, alone", JSON.stringify(s[0]) === '["b"]');
	check("then by cells right, ties together", JSON.stringify(s.slice(1)) === '[["c","d"],["a"]]', JSON.stringify(s));
	check("alone, the solver is the ranking", JSON.stringify(standings(["a"], { a: 51 }, "a")) === '[["a"]]');
	check("bots get slower as it gets harder",
		LEVEL_IDS.every((l, i) => !i || LEVELS[l].botMs > LEVELS[LEVEL_IDS[i - 1]].botMs));
}

// ---------------------------------------------------------------------------
console.log("\nthe race, as the platform runs it");

{
	let t = 1_000_000;
	const host = "pA";
	const rules = R.race({ host: () => host, now: () => t, random: () => 0.5 });
	const seats = [{ id: "pA", bot: false }, { id: "pB", bot: false }, { id: "bot_1", bot: true }];
	rules.init({ seats, opts: {}, seed: 1, match: 0 });
	let v = rules.view({ seat: "pA" });
	check("a race opens on picking a puzzle", v.phase === "pick" && !v.puzzle);
	check("nobody is on turn while picking", rules.turn().length === 0);
	check("only the host deals", rules.apply({ action: { start: "new", level: "easy" }, by: "pB" }) === "only the host deals");
	check("the host deals", rules.apply({ action: { start: "daily", level: "medium" }, by: "pA" }) == null);
	v = rules.view({ seat: "pB" });
	const total = R.empties(v.puzzle);
	check("everyone sees the same puzzle, and today's", v.phase === "play" && v.daily === R.today(new Date(t)) && v.puzzle === R.toText(R.dailyPuzzle(v.daily, "medium").puzzle));
	check("the view carries no bot clocks", !("due" in v) && !("bots" in v));
	check("a bot is the one on turn", JSON.stringify(rules.turn()) === '["bot_1"]');
	check("a bot polled early fills nothing", rules.apply({ action: rules.bot({ seat: "bot_1" }), by: "bot_1" }) == null && !rules.view({ seat: null }).progress.bot_1);
	t += LEVELS.medium.botMs * 1.01; // 0.6 + 0.5·0.8 = 1.0 of the pace
	rules.apply({ action: rules.bot({ seat: "bot_1" }), by: "bot_1" });
	check("a bot polled once due fills one cell", rules.view({ seat: null }).progress.bot_1 === 1);
	check("progress from an old race is refused", typeof rules.apply({ action: { progress: { match: 0, right: 3 } }, by: "pB" }) === "string");
	check("a player cannot speak for a bot", typeof rules.apply({ action: { progress: { match: v.match, right: 3 } }, by: "bot_1" }) === "string");
	rules.apply({ action: { progress: { match: v.match, right: 999 } }, by: "pB" });
	check("progress is capped at the empty cells", rules.view({ seat: null }).progress.pB === total);
	check("all right without a time is not a finish", rules.view({ seat: null }).phase === "play" && rules.result() === null);
	const snap = rules.snapshot();
	rules.apply({ action: { progress: { match: v.match, right: total, ms: 61_000 } }, by: "pB" });
	v = rules.view({ seat: "pA" });
	check("filling it all in wins", v.phase === "over" && v.winner === "pB" && v.times.pB === 61_000);
	const r = rules.result();
	check("the result: the winner first, then by cells right", r?.kind === "ffa" && JSON.stringify(r.ranking) === '[["pB"],["bot_1"],["pA"]]', JSON.stringify(r));
	check("a race's end card is the platform's (YOU WIN / X WINS on each phone)", r && !("title" in r));
	check("nobody is on turn once it is over", rules.turn().length === 0);
	// The heir carries on from the host's copy, a few seconds later.
	const heir = R.race({ host: () => "pB", now: () => t + 5000, random: () => 0.5 });
	heir.restore({ snapshot: JSON.parse(JSON.stringify(snap)) });
	const hv = heir.view({ seat: "pA" });
	check("the heir restores the race mid-way", hv.phase === "play" && hv.progress.pB === total && hv.puzzle === v.puzzle);
	check("and its bots carry on", JSON.stringify(heir.turn()) === '["bot_1"]');
	rules.init({ seats, opts: {}, seed: 2, match: 1 });
	check("PLAY AGAIN goes back to picking, counting on", rules.view({ seat: null }).phase === "pick" && rules.view({ seat: null }).match === v.match);
	check("resuming takes the host's own puzzle", rules.apply({ action: { start: "resume", resume: { puzzle: v.puzzle, solution: v.solution, level: "hard", daily: null } }, by: "pA" }) == null
		&& rules.view({ seat: null }).puzzle === v.puzzle && rules.view({ seat: null }).level === "hard");
	check("a bad resume is refused", (() => {
		rules.init({ seats, opts: {}, seed: 3, match: 2 });
		return typeof rules.apply({ action: { start: "resume", resume: { puzzle: "12", solution: v.solution, level: "hard" } }, by: "pA" }) === "string";
	})());
}

{
	// Alone: played, with the time.
	const t = 5_000;
	const rules = R.race({ host: () => "me", now: () => t });
	rules.init({ seats: [{ id: "me", bot: false }], opts: {}, seed: 1, match: 0 });
	rules.apply({ action: { start: "new", level: "easy" }, by: "me" });
	const v = rules.view({ seat: "me" });
	rules.apply({ action: { progress: { match: v.match, right: R.empties(v.puzzle), ms: 125_400 } }, by: "me" });
	const r = rules.result();
	check("alone, the result is played, with the time in seconds", r?.kind === "coop" && JSON.stringify(r.ranking) === '[["me"]]' && r.scores?.me === 125, JSON.stringify(r));
	check("and the end card says how long it took", r?.title === "SOLVED IN 2:05", r?.title);
}

{
	// A bot races to the end on its own.
	let t = 0;
	const rules = R.race({ host: () => "me", now: () => t });
	rules.init({ seats: [{ id: "me", bot: false }, { id: "bot_2", bot: true }], opts: {}, seed: 1, match: 0 });
	rules.apply({ action: { start: "new", level: "easy" }, by: "me" });
	const total = R.empties(rules.view({ seat: "me" }).puzzle);
	let polls = 0;
	while (rules.view({ seat: null }).phase === "play" && polls < 5000) {
		t += 850; // the platform's poll, roughly
		rules.apply({ action: { bot: 1 }, by: "bot_2" });
		polls++;
	}
	const v = rules.view({ seat: null });
	const perCell = v.times.bot_2 / total;
	check("a bot finishes a race by itself", v.winner === "bot_2", `${polls} polls`);
	check("at the difficulty's pace, give or take", perCell > LEVELS.easy.botMs * 0.8 && perCell < LEVELS.easy.botMs * 1.2, `${Math.round(perCell)}ms a cell`);
}

// ---------------------------------------------------------------------------
console.log("\nthe clock");

check("seconds", clock(4_000) === "0:04");
check("minutes", clock(754_000) === "12:34");
check("hours", clock(3_723_000) === "1:02:03");

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
