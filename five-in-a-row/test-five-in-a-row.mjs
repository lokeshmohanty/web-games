#!/usr/bin/env node
/**
 * test-five-in-a-row.mjs — the centre, the adjacency rule, lines of five in
 * every direction, three and four players, who opens, and the bot.
 *
 *   node five-in-a-row/test-five-in-a-row.mjs
 *
 * Plays the managed rules the platform runs on the host (SDK v2).
 */
import { readFileSync } from "node:fs";

new Function(readFileSync(new URL("./five-in-a-row-rules.js", import.meta.url), "utf8"))();
const { WIN, MAX_MARKS, boardOf, legal, legalCells, botCell, game } = globalThis.fiveInARowRules;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};
const seatsOf = (...ids) => ids.map((id) => ({ id, bot: id.startsWith("bot") }));

/** A fresh two-player game where pA opens. */
function fresh(ids = ["pA", "pB"], first = ids[0]) {
	const g = game();
	g.init({ seats: seatsOf(...ids), opts: {}, seed: 1, match: 0, first });
	return g;
}
/** Play the moves [[x, y], …] in turn order; returns each apply's answer. */
const play = (g, moves) => moves.map(([x, y]) => g.apply({ action: { x, y }, by: g.turn()[0] }));
const v = (g, seat = null) => g.view({ seat });

console.log("\nthe centre, then next to a mark");
{
	const g = fresh();
	check("A opens: on turn, the board empty", g.turn()[0] === "pA" && v(g).marks.length === 0);
	check("the first mark anywhere but the centre is refused", g.apply({ action: { x: 1, y: 0 }, by: "pA" }) === "the first mark goes in the centre");
	check("…and out of turn", g.apply({ action: { x: 0, y: 0 }, by: "pB" }) === "not your turn");
	check("…and nonsense", g.apply({ action: { x: "0", y: 0 }, by: "pA" }) === "no such cell" && g.apply({ action: null, by: "pA" }) === "no such cell" && g.apply({ action: { x: 0.5, y: 0 }, by: "pA" }) === "no such cell");
	check("…and from someone not seated", g.apply({ action: { x: 0, y: 0 }, by: "pZ" }) === "you are not playing");
	check("the centre is taken", g.apply({ action: { x: 0, y: 0 }, by: "pA" }) === undefined && v(g).marks.length === 1 && g.turn()[0] === "pB");
	check("a taken cell is refused", g.apply({ action: { x: 0, y: 0 }, by: "pB" }) === "that cell is taken");
	check("a cell two away is refused", g.apply({ action: { x: 2, y: 0 }, by: "pB" }) === "place it next to a mark");
	check("…and one far off", g.apply({ action: { x: 40, y: -40 }, by: "pB" }) === "place it next to a mark");
	for (const [x, y] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]]) {
		check(`(${x}, ${y}) touches the centre: legal`, legal(boardOf(v(g).marks), x, y));
	}
	check("a diagonal neighbour is taken", g.apply({ action: { x: 1, y: 1 }, by: "pB" }) === undefined);
	check("…and now (2, 2) touches it", g.apply({ action: { x: 2, y: 2 }, by: "pA" }) === undefined);
	check("the legal cells are the empty neighbours of the marks", legalCells(boardOf(v(g).marks)).length === 16, legalCells(boardOf(v(g).marks)).length);
	check("an empty board's only legal cell is the centre", JSON.stringify(legalCells(new Map())) === "[[0,0]]");
	check("the view says the last mark and the count", JSON.stringify(v(g).last) === "[2,2]" && v(g).moves === 3);
}

console.log("\nfive in a row, every way");
const lines = {
	across: (i) => [i, 0],
	down: (i) => [0, i],
	diagonal: (i) => [i, i],
	"the other diagonal": (i) => [i, -i],
};
for (const [name, at] of Object.entries(lines)) {
	const g = fresh();
	// A builds its line from the centre outward; B plays a parallel row a
	// step off, never in the way.
	const off = name === "across" ? [0, 1] : name === "down" ? [1, 0] : name === "diagonal" ? [1, 0] : [1, 0];
	const moves = [];
	for (let i = 0; i < WIN; i++) {
		moves.push(at(i));
		if (i < WIN - 1) moves.push([at(i)[0] + off[0] * (i % 2 ? -1 : 1), at(i)[1] + off[1] * (i % 2 ? -1 : 1)]);
	}
	const answers = play(g, moves);
	const r = g.result();
	check(`${name}: every move legal`, answers.every((a) => a === undefined), JSON.stringify(answers));
	check(`${name}: A wins with five`, v(g).winner === 0 && v(g).line.length === 5 && r?.ranking?.[0]?.[0] === "pA" && r.ranking[1][0] === "pB", JSON.stringify(v(g)));
	check(`${name}: nobody is on turn after`, g.turn().length === 0 && g.apply({ action: { x: 9, y: 9 }, by: "pB" }) === "the game is over");
}
{
	// Four in a row is not a win; a gap filled into six is.
	const g = fresh();
	const a = play(g, [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]);
	check("four in a row each: legal, and nobody has won", a.every((x) => x === undefined) && v(g).winner === null, JSON.stringify(a));
	play(g, [[4, -1], [4, 1]]);
	check("…B's fifth across row 1 wins", v(g).winner === 1 && v(g).line.length === 5);
}
{
	const g = fresh();
	// A: 0, 1, 2 and 4, 5 across row 0; B elsewhere. Then A fills 3: six.
	const a = play(g, [[0, 0], [0, 1], [1, 0], [1, -1], [2, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, -1]]);
	check("five marks with a hole is not a line", a.every((x) => x === undefined) && v(g).winner === null, JSON.stringify(a));
	play(g, [[3, 0]]);
	check("filling the hole makes six, which wins (five or more)", v(g).winner === 0 && v(g).line.length === 6, JSON.stringify(v(g).line));
	const r = g.result();
	check("the end card says how long", r.details.some((d) => d.label === "Winning line" && d.value === "6 in a row"), JSON.stringify(r.details));
}

console.log("\nthree and four players");
{
	const g = fresh(["pA", "pB", "pC"], "pB");
	check("three seats: the opener named by the platform is on turn", g.turn()[0] === "pB");
	play(g, [[0, 0]]);
	check("…then the next seat", g.turn()[0] === "pC");
	play(g, [[1, 0]]);
	check("…then round to the first", g.turn()[0] === "pA");
	check("each seat's marks are its own", JSON.stringify(v(g).marks) === "[[0,0,1],[1,0,2]]");
	check("everyone sees which seat they are", v(g, "pA").you === 0 && v(g, "pC").you === 2 && v(g).you === -1);
	check("a skip passes the turn", g.skip() && g.turn()[0] === "pB");
	check("A leaving takes them out of the rotation, their mark-less seat kept", g.leave({ seat: "pA" }) && v(g).out[0] === true);
	play(g, [[2, 0]]);
	check("…so the turn goes B, C, B", g.turn()[0] === "pC");
	play(g, [[3, 0]]);
	check("…B again", g.turn()[0] === "pB");
	check("C leaving too leaves B the winner", g.leave({ seat: "pC" }) && v(g).winner === 1 && g.result().ranking[0][0] === "pB");
}
{
	const g = fresh(["pA", "pB", "pC", "pD"], "pD");
	const answers = play(g, [[0, 0], [0, 1], [1, 1], [2, 2], [-1, 0], [0, -1], [1, -1], [1, 0], [-1, 1], [-1, -1], [2, 0], [-2, 0]]);
	check("four seats: twelve moves, all legal, in seat order D A B C …", answers.every((a) => a === undefined) && v(g).marks.map((m) => m[2]).join("") === "301230123012", v(g).marks.map((m) => m[2]).join(""));
	check("a four-player result ranks the winner over the other three", (() => {
		const h = fresh(["pA", "pB", "pC", "pD"], "pA");
		// A builds across row 0; B, C, D each play row 1, 2, 3 underneath.
		const ms = [];
		for (let i = 0; i < 5; i++) {
			ms.push([i, 0]);
			if (i < 4) ms.push([i, 1], [i, 2], [i, 3]);
		}
		play(h, ms);
		const r = h.result();
		return v(h).winner === 0 && r.ranking.length === 2 && r.ranking[0][0] === "pA" && r.ranking[1].length === 3;
	})());
}
{
	check("the draw cap is far past any real game", MAX_MARKS >= 400);
}

console.log("\nwho opens, between rematches");
{
	const g = game();
	const seats = seatsOf("pA", "pB", "pC");
	g.init({ seats, opts: {}, seed: 7, match: 0, first: "pC" });
	check("the platform's `first` opens", g.turn()[0] === "pC");
	g.init({ seats, opts: {}, seed: 7, match: 1, first: "pA" });
	check("…on every match it names", g.turn()[0] === "pA");
	// An older shell sends no `first`: the rules rotate on their own.
	const h = game();
	h.init({ seats, opts: {}, seed: 4, match: 0 });
	const firstOpener = h.turn()[0];
	check("without `first`: the first match's opener is drawn from the seed", firstOpener === "pB", firstOpener); // 4 % 3 = 1
	const openers = [firstOpener];
	for (let m = 1; m < 4; m++) {
		h.init({ seats, opts: {}, seed: 99, match: m });
		openers.push(h.turn()[0]);
	}
	check("…then each rematch the next seat opens, round the table", openers.join() === "pB,pC,pA,pB", openers.join());
	// A handover: the heir's rules restore the snapshot, and its rematch goes on round.
	const heir = game();
	heir.restore({ snapshot: h.snapshot() });
	heir.init({ seats, opts: {}, seed: 99, match: 4 });
	check("…and an heir's rematch carries the rotation on", heir.turn()[0] === "pC", heir.turn()[0]);
	// The last opener left: the seat that was next opens.
	heir.init({ seats: seatsOf("pA", "pB"), opts: {}, seed: 99, match: 5 });
	check("…and if the last opener left, whoever took their place", heir.turn()[0] === "pA", heir.turn()[0]);
	const seeds = new Set();
	for (let seed = 0; seed < 12; seed++) {
		const k = game();
		k.init({ seats, opts: {}, seed, match: 0 });
		seeds.add(k.turn()[0]);
	}
	check("…and every seat can be drawn first", seeds.size === 3);
}

console.log("\nthe bot");
{
	// It takes a win.
	const marks = [[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], [0, 1, 1], [1, 1, 1], [2, 1, 1]];
	const at = botCell(marks, 0, [0, 1]);
	check("it completes its own five", (at[0] === 4 || at[0] === -1) && at[1] === 0, JSON.stringify(at));
	// It blocks a five.
	const block = botCell([[0, 0, 1], [1, 0, 1], [2, 0, 1], [3, 0, 1], [0, 1, 0], [5, 5, 0], [1, 2, 0]].filter((m) => m[0] < 5), 0, [0, 1]);
	check("it blocks the other's four", (block[0] === 4 || block[0] === -1) && block[1] === 0, JSON.stringify(block));
	// It blocks an open three.
	const three = botCell([[0, 0, 1], [1, 0, 1], [2, 0, 1], [0, 1, 0], [1, -1, 0]], 0, [0, 1]);
	check("it blocks an open three at one of its ends", (three[0] === 3 || three[0] === -1) && three[1] === 0, JSON.stringify(three));
	// Given the choice, it makes its own open four rather than block a three.
	const four = botCell([[0, 0, 0], [1, 0, 0], [2, 0, 0], [0, 2, 1], [1, 2, 1], [2, 2, 1]], 0, [0, 1]);
	check("it makes its own open four before blocking a three", (four[0] === 3 || four[0] === -1) && four[1] === 0, JSON.stringify(four));
	// Three players: the one who moves before a threat is the one to stop it.
	const four3 = [[0, 0, 2], [0, 1, 2], [0, 2, 2], [0, 3, 2], [3, 3, 1], [1, 1, 0]];
	const next = botCell(four3, 1, [1, 2, 0]);
	check("three players: the seat before a four blocks it", next[0] === 0 && (next[1] === 4 || next[1] === -1), JSON.stringify(next));
	const early = botCell(four3, 0, [0, 1, 2]);
	check("…a seat earlier leaves it to them (with every four blocked by everyone, three-player games never end)", !(early[0] === 0 && (early[1] === 4 || early[1] === -1)), JSON.stringify(early));
	check("on an empty board it plays the centre", JSON.stringify(botCell([], 0, [0, 1])) === "[0,0]");

	// Bots finish games, at two, three and four seats.
	for (const n of [2, 3, 4]) {
		const ids = ["botA", "botB", "botC", "botD"].slice(0, n);
		let done = 0;
		let longest = 0;
		let refused = 0;
		const games = 6;
		for (let m = 0; m < games; m++) {
			const g = game();
			g.init({ seats: seatsOf(...ids), opts: {}, seed: m, match: m });
			for (let i = 0; i < MAX_MARKS + 5 && g.turn().length; i++) {
				const who = g.turn()[0];
				if (g.apply({ action: g.bot({ seat: who }), by: who }) !== undefined) refused++;
			}
			if (g.result()) done++;
			longest = Math.max(longest, v(g).moves);
		}
		check(`${n} bots finish every game (${games}), every move legal; the longest took ${longest} marks`, done === games && refused === 0 && longest < MAX_MARKS, `${done}/${games}, ${refused} refused`);
	}
	// The bot beats a player who only ever plays the first legal cell.
	let wins = 0;
	for (let m = 0; m < 6; m++) {
		const g = game();
		g.init({ seats: seatsOf("pA", "botB"), opts: {}, seed: m, match: m, first: m % 2 ? "pA" : "botB" });
		for (let i = 0; i < 400 && g.turn().length; i++) {
			const who = g.turn()[0];
			const action = who === "botB" ? g.bot({ seat: who }) : (([x, y]) => ({ x, y }))(legalCells(boardOf(v(g).marks))[0]);
			g.apply({ action, by: who });
		}
		if (v(g).winner === 1) wins++;
	}
	check("the bot beats a careless player every time (6 games)", wins === 6, `${wins}/6`);
	// Its move is quick enough for a phone: well under a frame budget on a busy board.
	const g = game();
	g.init({ seats: seatsOf("botA", "botB", "botC", "botD"), opts: {}, seed: 3, match: 0 });
	for (let i = 0; i < 60 && g.turn().length; i++) g.apply({ action: g.bot({ seat: g.turn()[0] }), by: g.turn()[0] });
	const t0 = performance.now();
	for (let i = 0; i < 20; i++) g.bot({ seat: g.turn()[0] ?? "botA" });
	const ms = (performance.now() - t0) / 20;
	check(`a move on a board of ${v(g).moves} marks takes ${ms.toFixed(1)} ms (under 25)`, ms < 25);
}

console.log("\nsnapshot and restore");
{
	const g = fresh();
	play(g, [[0, 0], [1, 0], [0, 1]]);
	const heir = game();
	heir.restore({ snapshot: g.snapshot() });
	check("the heir has the same board and turn", JSON.stringify(heir.view({ seat: "pA" })) === JSON.stringify(g.view({ seat: "pA" })) && heir.turn()[0] === "pB");
	play(heir, [[1, 1]]);
	check("…and the snapshot is a copy, not the host's state", v(g).marks.length === 3 && v(heir).marks.length === 4);
}

console.log("\nfacts for the arcade's achievements");
{
	const g = game();
	g.init({ seats: [{ id: "pA" }, { id: "pB" }], seed: 1, match: 0, first: "pA" });
	g.leave({ seat: "pB" });
	check("won because the other left: no line (facts.line 0), so line-gated achievements stay locked", g.result()?.facts?.line === 0 && g.result().ranking[0][0] === "pA", JSON.stringify(g.result()));
}

console.log(failures ? `\n${failures} check(s) FAILED` : "\nall five-in-a-row checks passed");
process.exit(failures ? 1 : 0);
