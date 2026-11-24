#!/usr/bin/env node
/**
 * test-ludo.mjs — both boards' geometry, the classic rules (a 6 to leave the
 * yard, a 6 again, three 6s, captures, safe squares, the exact roll home),
 * teams (a team's win, a finished partner rolling for the other), empty
 * seats, the table's setup, who rolls first, bots finishing games and a
 * handover mid-game.
 *
 *   node ludo/test-ludo.mjs
 *
 * Plays the managed rules the platform runs on the host (SDK v2).
 */
import { readFileSync } from "node:fs";

new Function(readFileSync(new URL("./ludo-rules.js", import.meta.url), "utf8"))();
const { TOKENS, geometry, modesFor, boardsFor, placesOf, game } = globalThis.ludoRules;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
	if (!ok) failures++;
};
const seatsOf = (...ids) => ids.map((id) => ({ id, name: id, bot: id.startsWith("bot") }));
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

/**
 * A game of `ids` on `board` in `mode`, set up and started; `rolls` are the
 * die's faces in order (then the seeded die). `tokens` (by seat), when given,
 * replace where the tokens stand.
 */
function table(ids, { board = 4, mode = "ffa", rolls = [], tokens = null, first = ids[0], seed = 7 } = {}) {
	const queue = [...rolls];
	let seeded = null;
	const g = game({
		die: () => {
			if (queue.length) return queue.shift();
			seeded ??= globalThis.ludoRules.rng(seed);
			return seeded.int(1, 6);
		},
	});
	g.init({ seats: seatsOf(...ids), opts: {}, seed, match: 0, first });
	if (board !== g.view({ seat: null }).board) g.apply({ action: { board }, by: ids[0] });
	if (mode !== "ffa") check(`(set up: ${mode} on the ${board}-player board)`, g.apply({ action: { mode }, by: ids[0] }) === undefined);
	g.apply({ action: { start: true }, by: ids[0] });
	if (tokens) {
		const snap = g.snapshot();
		snap.tokens = tokens.map((t) => [...t]);
		snap.done = snap.tokens.map((t, i) => (t.every((p) => p === geometry(board).HOME) ? i : -1)).filter((i) => i >= 0);
		g.restore({ snapshot: snap });
	}
	return { g, more: (...r) => queue.push(...r), v: (seat = null) => g.view({ seat }) };
}
const roll = (g, by) => g.apply({ action: { roll: true }, by });

// ------------------------------------------------------------------ geometry

console.log("\nthe 4-player board: the classic 15 x 15 cross");
{
	const G = geometry(4);
	check("52 squares round, home at 56 (51 round, 5 up the home column)", G.T === 52 && G.HOME === 56 && G.track.length === 52);
	// Grid squares: column x + 7, row y + 7.
	const grid = (xy) => [xy[0] + 7, xy[1] + 7];
	const all = [...G.track.map((t) => t.xy), ...[0, 1, 2, 3].flatMap((a) => [1, 2, 3, 4, 5].map((i) => G.cell(a, 0, i)))];
	check("every square sits on the grid, inside it", all.every((xy) => grid(xy).every((c) => near(c, Math.round(c)) && c >= 0 && c <= 14)));
	check("no two squares in one place", new Set(all.map((xy) => grid(xy).map(Math.round).join())).size === all.length, `${all.length}`);
	check("the first arm starts at column 1, row 6 (left arm, top lane), as the classic", grid(G.spot(0, 0)).map(Math.round).join() === "1,6");
	check("each start is 13 on from the last, a quarter turn round", [1, 2, 3].every((a) => G.globalOf(a, 0) === 13 * a) && grid(G.spot(1, 0)).map(Math.round).join() === "8,1");
	const steps = G.track.map((t, i) => dist(t.xy, G.track[(i + 1) % G.T].xy));
	check("each square of the track touches the next (side, or corner where arms meet)", steps.every((d) => near(d, 1) || near(d, Math.SQRT2)));
	check("a token goes round to its own arm's tip (50), then up the home column to the middle (56)", grid(G.spot(0, 50)).map(Math.round).join() === "0,7" && grid(G.spot(0, 51)).map(Math.round).join() === "1,7" && grid(G.spot(0, 55)).map(Math.round).join() === "5,7");
	check("8 safe squares: 4 starts and 4 stars, each star 8 on from a start", G.safe.size === 8 && G.stars.every((g, a) => g === (13 * a + 8) % 52));
	const y = G.yard(0);
	check("the first yard is the top-left corner; its four spots apart, off the track", near(y.centre[0], -4.5) && near(y.centre[1], -4.5) && y.spots.every((p, i) => y.spots.every((q, j) => i === j || dist(p, q) >= 1.5)) && y.spots.every((p) => all.every((c) => dist(p, c) > 1.2)));
}

console.log("\nthe 6-player board: six arms round a hexagon");
{
	const G = geometry(6);
	check("66 squares round, home at 69 (65 round, 4 up the home column)", G.T === 66 && G.HOME === 69 && G.track.length === 66);
	const homes = [0, 1, 2, 3, 4, 5].flatMap((a) => [1, 2, 3, 4].map((i) => G.cell(a, 0, i)));
	const all = [...G.track.map((t) => t.xy), ...homes];
	let closest = Infinity;
	for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) closest = Math.min(closest, dist(all[i], all[j]));
	check(`no two squares overlap (closest centres ${closest.toFixed(3)} apart)`, closest >= 0.999);
	const steps = G.track.map((t, i) => dist(t.xy, G.track[(i + 1) % G.T].xy));
	check(`each square of the track is next to the one after (at most ${Math.max(...steps).toFixed(2)} apart)`, steps.every((d) => d > 0.99 && d < 1.5));
	// Turning the board a sixth maps every arm onto the next.
	const turn = ([x, y]) => [x * Math.cos(Math.PI / 3) - y * Math.sin(Math.PI / 3), x * Math.sin(Math.PI / 3) + y * Math.cos(Math.PI / 3)];
	check("a sixth of a turn takes each arm's squares, starts and yards onto the next arm's", [0, 1, 2, 3, 4, 5].every((a) => [-1, 0, 5, 30, 64, 66, 69].every((p) => dist(turn(G.spot(a, p, 1)), G.spot((a + 1) % 6, p, 1)) < 1e-9)));
	check("12 safe squares: 6 starts and 6 stars", G.safe.size === 12 && G.starts.every((g, a) => g === 11 * a));
	const xs = all.map((p) => p[0]);
	const ys = all.map((p) => p[1]);
	const [w, h] = [Math.max(...xs) - Math.min(...xs) + 1, Math.max(...ys) - Math.min(...ys) + 1];
	check(`taller than wide, at most 15.3 squares either way (${w.toFixed(2)} x ${h.toFixed(2)}): 22px squares on a 354px phone`, w < h && w <= 15.3 && h <= 15.3);
	const spots = [0, 1, 2, 3, 4, 5].flatMap((a) => G.yard(a).spots);
	let spotGap = Infinity;
	for (let i = 0; i < spots.length; i++) for (let j = i + 1; j < spots.length; j++) spotGap = Math.min(spotGap, dist(spots[i], spots[j]));
	const offTrack = Math.min(...spots.flatMap((p) => all.map((c) => dist(p, c))));
	check(`each yard's four spots fit between its arms, apart (${spotGap.toFixed(2)}) and off every square (${offTrack.toFixed(2)})`, spotGap >= 1.2 && offTrack >= 0.95);
	check("a token's home stands in the middle, inside the hexagon", [0, 1, 2, 3, 4, 5].every((a) => Math.hypot(...G.spot(a, 69)) < G.h));
}

// ------------------------------------------------------------------- setup

console.log("\nsetting the table up");
{
	const g = game({ isHost: (id) => id === "pA" });
	g.init({ seats: seatsOf("pA", "pB", "bot_1", "bot_2"), opts: {}, seed: 3, match: 0, first: "pA" });
	let v = g.view({ seat: "pB" });
	check("four seats: the 4-player board, free-for-all, still setting up; nobody on turn", v.phase === "setup" && v.board === 4 && v.mode === "ffa" && g.turn().length === 0);
	check("only the host sets it up", g.apply({ action: { board: 6 }, by: "pB" }) === "the host sets up the game");
	check("both boards and three modes are on offer to four", v.boards.join() === "4,6" && v.modes.join() === "ffa,pairs");
	check("the host picks teams: partners sit opposite (seats 1 and 3, 2 and 4)", g.apply({ action: { mode: "pairs" }, by: "pA" }) === undefined && (v = g.view({ seat: null })).teams.join() === "0,1,0,1");
	check("the 6-player board for four takes free-for-all only (teams need every seat)", g.apply({ action: { board: 6 }, by: "pA" }) === undefined && (v = g.view({ seat: null })).mode === "ffa" && v.modes.join() === "ffa" && g.apply({ action: { mode: "pairs" }, by: "pA" }) !== undefined);
	check("four on the 6-player board sit two by two, a gap between", v.arms.join() === "0,1,3,4");
	g.apply({ action: { board: 4 }, by: "pA" });
	g.apply({ action: { mode: "pairs" }, by: "pA" });
	const before = g.view({ seat: null }).teams.join();
	check("MIX TEAMS changes who partners whom", g.apply({ action: { mix: true }, by: "pA" }) === undefined && g.view({ seat: null }).teams.join() !== before, `${before} → ${g.view({ seat: null }).teams.join()}`);
	check("no move before the start", g.apply({ action: { roll: true }, by: "pA" }) === "the game has not started");
	g.apply({ action: { start: true }, by: "pA" });
	v = g.view({ seat: "pA" });
	check("START: play, every token in its yard, the opener to roll", v.phase === "play" && v.tokens.every((t) => t.every((p) => p === -1)) && g.turn()[0] === "pA" && v.stage === "roll");

	const five = game();
	five.init({ seats: seatsOf("a", "b", "c", "d", "e"), opts: {}, seed: 1, match: 0 });
	const v5 = five.view({ seat: null });
	check("five players: the 6-player board, and only it", v5.board === 6 && v5.boards.join() === "6" && five.apply({ action: { board: 4 }, by: "a" }) !== undefined);
	const six = game();
	six.init({ seats: seatsOf("a", "b", "c", "d", "e", "f"), opts: {}, seed: 1, match: 0 });
	six.apply({ action: { mode: "pairs" }, by: "a" });
	const pairs = six.view({ seat: null }).teams;
	six.apply({ action: { mode: "trios" }, by: "a" });
	const trios = six.view({ seat: null }).teams;
	check("six: three teams of two sit opposite; two teams of three on every other arm", pairs.join() === "0,1,2,0,1,2" && trios.join() === "0,1,0,1,0,1", `${pairs} / ${trios}`);
	check("modes and boards as documented", modesFor(4, 3).join() === "ffa" && modesFor(6, 6).join() === "ffa,pairs,trios" && boardsFor(3).join() === "4,6" && boardsFor(6).join() === "6");
}

// --------------------------------------------------------------- the rules

console.log("\nleaving the yard, and the 6 again");
{
	const { g, v, more } = table(["pA", "pB"], { rolls: [3] });
	check("two people on the 4-player board sit opposite, the other arms empty", v().arms.join() === "0,2" && v().seats.length === 2);
	roll(g, "pA");
	check("a 3 with everyone in the yard: nothing moves, the turn passes", v().last.pass && v().tokens[0].every((p) => p === -1) && g.turn()[0] === "pB");
	more(6);
	roll(g, "pB");
	check("a 6 brings a token out to its start — made for you, the yard's tokens being alike", v().tokens[1].filter((p) => p === 0).length === 1 && v().last.move?.to === 0 && v().last.move?.from === -1);
	check("…and a 6 rolls again", g.turn()[0] === "pB" && v().stage === "roll");
	more(4);
	roll(g, "pB");
	check("one token out, a 4: it moves by itself, and the turn passes", v().tokens[1].includes(4) && g.turn()[0] === "pA");
	more(6);
	roll(g, "pA");
	more(6);
	roll(g, "pA");
	check("a 6 with a token out and others in the yard: a choice, waiting for a tap", v().stage === "move" && v().moves.length === 2 && v().moves.some((m) => m.from === -1) && v().moves.some((m) => m.from === 0), JSON.stringify(v().moves));
	check("a token that cannot move is refused", g.apply({ action: { token: 3, owner: 1 }, by: "pA" }) === "that token cannot move" && g.apply({ action: { token: 0 }, by: "pB" }) === "not your turn");
	const out = v().tokens[0].indexOf(0);
	g.apply({ action: { token: out }, by: "pA" });
	check("the tapped token moves 6, and the 6 rolls again", v().tokens[0][out] === 6 && g.turn()[0] === "pA" && v().stage === "roll");
}

console.log("\nthree 6s in a row lose the turn");
{
	const { g, v, more } = table(["pA", "pB"], { tokens: [[10, -1, -1, 56], [-1, -1, -1, -1]], rolls: [6] });
	roll(g, "pA");
	g.apply({ action: { token: 0 }, by: "pA" });
	more(6);
	roll(g, "pA");
	g.apply({ action: { token: 0 }, by: "pA" });
	const at = v().tokens[0][0];
	more(6);
	roll(g, "pA");
	check("the first two 6s are played; the third loses the turn and moves nothing", at === 22 && v().last.lost === true && v().tokens[0][0] === 22 && g.turn()[0] === "pB" && v().sixes === 0);
	more(6, 2);
	roll(g, "pB");
	roll(g, "pB");
	more(6);
	roll(g, "pA");
	check("the count starts again each turn: pA's next 6 is a first", v().last.lost !== true && v().sixes === 1);
}

console.log("\ncaptures, and safe squares");
{
	const G = geometry(4);
	// pA (arm 0) at 3, pB (arm 2) 26 squares round: arm 0's 29 is arm 2's 3.
	check("(the same square seen from both arms)", G.globalOf(0, 29) === G.globalOf(2, 3));
	const r = table(["pA", "pB"], { tokens: [[26, 56, 56, 56], [3, -1, -1, -1]], rolls: [3] });
	roll(r.g, "pA");
	check("landing on another's token sends it to its yard", r.v().tokens[1][0] === -1 && r.v().tokens[0][0] === 29 && r.v().last.move.caps.length === 1);
	// A star: arm 0's 8.
	const star = G.stars[0];
	const theirs = (star - G.globalOf(2, 0) + G.T) % G.T; // pB's progress on that square
	const s2 = table(["pA", "pB"], { tokens: [[5, 56, 56, 56], [theirs, -1, -1, -1]], rolls: [3] });
	roll(s2.g, "pA");
	check("…but never on a star: both stay", s2.v().tokens[0][0] === 8 && s2.v().tokens[1][0] === theirs && !s2.v().last.move.caps.length);
	// pB's start is arm 2's 0 = arm 0's 26.
	const s3 = table(["pA", "pB"], { tokens: [[23, 56, 56, 56], [0, -1, -1, -1]], rolls: [3] });
	roll(s3.g, "pA");
	check("…nor on a start", s3.v().tokens[0][0] === 26 && s3.v().tokens[1][0] === 0);
	// pB's two tokens stacked on arm 0's 22 (arm 2's 48): no block, pA passes them.
	const s4 = table(["pA", "pB"], { tokens: [[20, 23, 56, 56], [48, 48, -1, -1]], rolls: [5] });
	roll(s4.g, "pA");
	s4.g.apply({ action: { token: 0 }, by: "pA" });
	check("anyone passes anyone: two tokens on one square are no block", s4.v().tokens[0][0] === 25 && s4.v().tokens[1].join() === "48,48,-1,-1");
	const s5 = table(["pA", "pB"], { tokens: [[20, 23, 56, 56], [-1, -1, -1, -1]], rolls: [3] });
	roll(s5.g, "pA");
	s5.g.apply({ action: { token: 0 }, by: "pA" });
	check("a player's own tokens share a square", s5.v().tokens[0].slice(0, 2).join() === "23,23");
}

console.log("\nthe exact roll home");
{
	const { g, v, more } = table(["pA", "pB"], { tokens: [[54, 56, 56, 56], [-1, -1, -1, -1]], rolls: [3] });
	roll(g, "pA");
	check("on 54, a 3 would go past home: it cannot be played, the turn passes", v().last.pass && v().tokens[0][0] === 54 && g.turn()[0] === "pB");
	more(1, 2);
	roll(g, "pB");
	roll(g, "pA");
	check("a 2 takes it home, and with every token home pA has won (two players: one place)", v().tokens[0][0] === 56 && v().over && v().winner === 0);
	const r = g.result();
	check("the result: pA first, pB second", r.kind === "ffa" && r.ranking.map((x) => x.join()).join("|") === "pA|pB", JSON.stringify(r));
}

console.log("\nfree-for-all plays on for places");
{
	check("places played for: 1 for two, 2 for three, 3 from four", placesOf(2) === 1 && placesOf(3) === 2 && placesOf(4) === 3 && placesOf(6) === 3);
	const { g, v } = table(["pA", "pB", "pC"], { tokens: [[55, 56, 56, 56], [-1, -1, -1, -1], [-1, -1, -1, -1]], rolls: [1] });
	roll(g, "pA");
	check("three players: the first home is first, and the others play on", v().done.join() === "0" && !v().over && g.turn()[0] === "pB");
	check("a seat with every token home is passed over", (() => {
		g.apply({ action: { roll: true }, by: "pB" });
		g.apply({ action: { roll: true }, by: "pC" });
		return g.turn()[0] === "pB";
	})());
}

console.log("\nteams: a finished partner rolls for the other; a team wins together");
{
	const H = geometry(4).HOME;
	// Pairs on the 4-player board: pA and pC (arms 0 and 2) against pB and pD.
	const { g, v, more } = table(["pA", "pB", "pC", "pD"], { mode: "pairs", tokens: [[H, H, H, H], [-1, -1, -1, -1], [50, H, H, H], [-1, -1, -1, -1]], rolls: [3] });
	check("partners opposite", v().teams.join() === "0,1,0,1");
	roll(g, "pA");
	check("pA, every token home, rolls a 3 and it moves pC's last token (the only move)", v().last.move?.owner === 2 && v().tokens[2][0] === 53 && !v().over);
	more(2, 2, 3);
	roll(g, "pB");
	roll(g, "pC");
	check("pC moves its own token too", v().tokens[2][0] === 55);
	roll(g, "pD");
	more(1);
	roll(g, "pA");
	check("pA brings pC's token home: pA and pC's team wins", v().over && v().winners === 0);
	const r = g.result();
	check("the result is the team's: pA and pC first, together", r.kind === "teams" && r.ranking[0].join() === "pA,pC" && r.ranking[1].join() === "pB,pD", JSON.stringify(r));

	// Partners never capture each other.
	const geo = geometry(4);
	const onIt = (geo.globalOf(0, 27) - geo.globalOf(2, 0) + geo.T) % geo.T;
	const s3 = table(["pA", "pB", "pC", "pD"], { mode: "pairs", tokens: [[25, H, H, H], [-1, -1, -1, -1], [onIt, -1, -1, -1], [-1, -1, -1, -1]], rolls: [2] });
	roll(s3.g, "pA");
	check("landing on a partner's token: both stay", s3.v().tokens[0][0] === 27 && s3.v().tokens[2][0] === onIt && !s3.v().last.move.caps.length);

	// On the 6-player board, two teams of three: a finished player may move either partner's tokens.
	const H6 = geometry(6).HOME;
	const t = table(["a", "b", "c", "d", "e", "f"], { board: 6, mode: "trios", tokens: [[H6, H6, H6, H6], [-1, -1, -1, -1], [10, H6, H6, H6], [-1, -1, -1, -1], [20, H6, H6, H6], [-1, -1, -1, -1]], rolls: [4] });
	roll(t.g, "a");
	check("two teams of three: a, finished, picks between c's and e's tokens", t.v().stage === "move" && t.v().moves.map((m) => m.owner).sort().join() === "2,4", JSON.stringify(t.v().moves));
	t.g.apply({ action: { owner: 4, token: 0 }, by: "a" });
	check("…and moves e's", t.v().tokens[4][0] === 24 && t.v().tokens[2][0] === 10);
}

console.log("\na player who leaves");
{
	const { g, v } = table(["pA", "pB", "pC"], { tokens: [[10, -1, -1, -1], [12, -1, -1, -1], [-1, -1, -1, -1]] });
	g.leave({ seat: "pB" });
	check("free-for-all: their tokens come off, the others play on", v().out[1] && !v().over);
	g.leave({ seat: "pC" });
	check("one left racing: decided, the leavers last", v().over && g.result().ranking.map((x) => x.join()).join("|") === "pA|pB,pC");
	const H = geometry(4).HOME;
	const t = table(["pA", "pB", "pC", "pD"], { mode: "pairs", tokens: [[10, H, H, H], [-1, -1, -1, -1], [30, -1, -1, -1], [-1, -1, -1, -1]], rolls: [2] });
	t.g.leave({ seat: "pC" });
	roll(t.g, "pA");
	check("teams: a partner who leaves leaves their tokens, which the other moves on their turn", t.v().stage === "move" && t.v().moves.some((m) => m.owner === 2) && t.v().moves.some((m) => m.owner === 0));
	const s = game();
	s.init({ seats: seatsOf("a", "b", "c", "d", "e"), opts: {}, seed: 2, match: 0 });
	s.leave({ seat: "e" });
	check("before the start, a leaver just leaves the table (four: both boards again)", s.view({ seat: null }).seats.length === 4 && s.view({ seat: null }).boards.join() === "4,6");
}

console.log("\na leave before the start keeps who opens");
{
	const g = game();
	g.init({ seats: seatsOf("a", "b", "c", "d"), opts: {}, seed: 1, match: 0, first: "c" });
	g.leave({ seat: "a" });
	g.apply({ action: { start: true }, by: "b" });
	check("c was to open; a leaves before START: c still opens", g.turn()[0] === "c", `${g.turn()[0]}`);
	const h = game();
	h.init({ seats: seatsOf("a", "b", "c", "d"), opts: {}, seed: 1, match: 0, first: "c" });
	h.leave({ seat: "c" });
	h.apply({ action: { start: true }, by: "a" });
	check("the opener leaves: whoever took their place (the seat after) opens", h.turn()[0] === "d", `${h.turn()[0]}`);
}

console.log("\nfree-for-all ends once only bots are racing");
{
	const { g, v } = table(["pA", "bot_1", "bot_2", "bot_3"], { tokens: [[55, 56, 56, 56], [10, -1, -1, -1], [30, 4, -1, -1], [-1, -1, -1, -1]], rolls: [1] });
	roll(g, "pA");
	const r = g.result();
	check("the one person home first: the game ends at once (it would play on for 2nd and 3rd)", v().over && r && r.ranking[0].join() === "pA", JSON.stringify({ over: v().over, done: v().done }));
	check("…the bots placed by how far round they got", r && r.ranking.slice(1).map((x) => x.join()).join("|") === "bot_2|bot_1|bot_3", JSON.stringify(r?.ranking));
	const t = table(["pA", "pB", "bot_1"], { tokens: [[55, 56, 56, 56], [10, -1, -1, -1], [20, -1, -1, -1]], rolls: [1] });
	roll(t.g, "pA");
	check("another person still racing: play goes on for places", !t.v().over && t.v().done.join() === "0");
	const u = table(["pA", "bot_1", "bot_2"], { tokens: [[10, -1, -1, -1], [55, 56, 56, 56], [20, -1, -1, -1]], rolls: [3, 1] });
	roll(u.g, "pA");
	roll(u.g, "bot_1");
	check("a bot home first while the person races: play goes on", !u.v().over && u.v().done.join() === "1");
	const w = table(["pA", "bot_1", "bot_2"], { tokens: [[10, -1, -1, -1], [20, -1, -1, -1], [30, -1, -1, -1]] });
	w.g.leave({ seat: "pA" });
	check("the only person leaves: only bots racing, so it ends", w.v().over);
	const allBots = botGame(["bot_a", "bot_b", "bot_c"], { board: 4, seed: 5 });
	check("a table of bots only still plays for its places", allBots.over && allBots.view.done.length === 2);
}

console.log("\nsetup only the first time");
{
	// A fresh mount: the platform's init with the device's last table (`last`).
	const fresh = (ids, last, match = 0) => {
		const g = game({ last: () => last });
		g.init({ seats: seatsOf(...ids), opts: {}, seed: 3, match, first: ids[0] });
		return g;
	};
	let g = fresh(["pA", "bot_1", "bot_2", "bot_3"], null);
	check("one person and bots, nothing remembered (a card's tap): straight into play, 4-player board, free-for-all", g.view({ seat: null }).phase === "play" && g.view({ seat: null }).board === 4 && g.view({ seat: null }).mode === "ffa" && g.turn()[0] === "pA");
	g = fresh(["pA", "bot_1", "bot_2", "bot_3"], { n: 4, board: 6, mode: "ffa" });
	check("…the same table as last time: straight in on the last board", g.view({ seat: null }).phase === "play" && g.view({ seat: null }).board === 6);
	g = fresh(["pA", "bot_1", "bot_2", "bot_3"], { n: 4, board: 4, mode: "pairs" });
	check("…teams too: 2 v 2 again, partners opposite", g.view({ seat: null }).phase === "play" && g.view({ seat: null }).mode === "pairs" && g.view({ seat: null }).teams.join() === "0,1,0,1");
	g = fresh(["pA", "bot_1", "bot_2", "bot_3", "bot_4", "bot_5"], { n: 4, board: 4, mode: "pairs" });
	let v = g.view({ seat: null });
	check("a different table (CHANGE PLAYERS): the setup, with what still fits picked (six: the 6-player board, teams of 2 still)", v.phase === "setup" && v.board === 6 && v.mode === "pairs", JSON.stringify({ phase: v.phase, board: v.board, mode: v.mode }));
	g = fresh(["pA", "pB", "bot_1"], { n: 3, board: 6, mode: "ffa" });
	v = g.view({ seat: null });
	check("friends at the table (a party's first game): the setup, the last board picked", v.phase === "setup" && v.board === 6);
	// PLAY AGAIN: straight in, the same board, mode and partners.
	g = fresh(["pA", "pB", "pC", "pD"], null);
	g.apply({ action: { mode: "pairs" }, by: "pA" });
	g.apply({ action: { mix: true }, by: "pA" });
	const teams = g.view({ seat: null }).teams.join();
	g.apply({ action: { start: true }, by: "pA" });
	g.init({ seats: seatsOf("pA", "pB", "pC", "pD"), opts: {}, seed: 4, match: 1, first: "pB" });
	v = g.view({ seat: null });
	check("PLAY AGAIN: straight into play, 2 v 2 with the same partners, the next opener", v.phase === "play" && v.mode === "pairs" && v.teams.join() === teams && g.turn()[0] === "pB", JSON.stringify({ phase: v.phase, teams: v.teams, was: teams }));
	g.init({ seats: seatsOf("pA", "pB", "pC"), opts: {}, seed: 5, match: 2, first: "pC" });
	v = g.view({ seat: null });
	check("PLAY AGAIN with a seat gone: teams no longer fit, so the setup", v.phase === "setup" && v.mode === "ffa");
}

console.log("\nthe next game: changed at the end, for the next game only");
{
	const H = geometry(4).HOME;
	const { g, v } = table(["pA", "bot_1"], { tokens: [[55, H, H, H], [-1, -1, -1, -1]], rolls: [1] });
	roll(g, "pA");
	check("(the game is over)", v().over);
	let n = g.nextGame();
	check("at the end: next game is this one's board and mode, with the choices that fit two (both boards, free-for-all only)", n.board === 4 && n.mode === "ffa" && n.boards.join() === "4,6" && n.modes.join() === "ffa", JSON.stringify(n));
	check("teams cannot be picked for two (teams need every seat)", g.setNext({ mode: "pairs" }) !== undefined && g.nextGame().mode === "ffa");
	check("before the end there is no next game to change", (() => {
		const t2 = table(["pA", "bot_1"]);
		return t2.g.setNext({ board: 6 }) !== undefined;
	})());
	check("the 6-player board for next game", g.setNext({ board: 6 }) === undefined && g.nextGame().board === 6 && v().board === 4);
	g.init({ seats: seatsOf("pA", "bot_1"), opts: {}, seed: 8, match: 1, first: "bot_1" });
	let w = v();
	check("PLAY AGAIN: straight into play on the board picked for next game", w.phase === "play" && w.board === 6 && w.arms.join() === "0,3", JSON.stringify({ phase: w.phase, board: w.board, arms: w.arms }));
	// Four, 2 v 2 picked for next game, then a seat gone: back to the setup.
	const f = table(["pA", "bot_1", "bot_2", "bot_3"], { tokens: [[55, H, H, H], [-1, -1, -1, -1], [10, -1, -1, -1], [-1, -1, -1, -1]], rolls: [1] });
	f.g.apply({ action: { roll: true }, by: "pA" });
	n = f.g.nextGame();
	check("four at the end: 2 v 2 on offer for next game", f.v().over && n.modes.join() === "ffa,pairs", JSON.stringify(n));
	check("2 v 2 for next game", f.g.setNext({ mode: "pairs" }) === undefined && f.g.nextGame().mode === "pairs");
	check("the 6-player board for four: teams no longer fit, so free-for-all", f.g.setNext({ board: 6 }) === undefined && f.g.nextGame().mode === "ffa" && f.g.nextGame().modes.join() === "ffa");
	f.g.setNext({ board: 4 });
	f.g.setNext({ mode: "pairs" });
	f.g.init({ seats: seatsOf("pA", "bot_1", "bot_2", "bot_3"), opts: {}, seed: 9, match: 1, first: "bot_1" });
	w = f.v();
	check("PLAY AGAIN: 2 v 2 straight away", w.phase === "play" && w.mode === "pairs" && w.teams.join() === "0,1,0,1");
	check("the next game's pick travels with the snapshot (an heir's PLAY AGAIN keeps it)", (() => {
		const h = table(["pA", "bot_1"], { tokens: [[55, H, H, H], [-1, -1, -1, -1]], rolls: [1] });
		roll(h.g, "pA");
		h.g.setNext({ board: 6 });
		const heir = game();
		heir.restore({ snapshot: h.g.snapshot() });
		heir.init({ seats: seatsOf("pA", "bot_1"), opts: {}, seed: 2, match: 1 });
		return heir.view({ seat: null }).board === 6 && heir.view({ seat: null }).phase === "play";
	})());
}

console.log("\nskipping a turn");
{
	const { g } = table(["pA", "pB", "bot_1"]);
	check("SKIP TURN passes it on", g.skip({ seat: "pA" }) === true && g.turn()[0] === "pB");
}

// ---------------------------------------------------------- who rolls first

console.log("\nwho rolls first goes round the table");
{
	const g = game();
	const ids = ["pA", "pB", "pC"];
	g.init({ seats: seatsOf(...ids), opts: {}, seed: 4, match: 0, first: "pB" });
	g.apply({ action: { start: true }, by: "pA" });
	check("the platform's `first` opens", g.turn()[0] === "pB");
	const h = game();
	h.init({ seats: seatsOf(...ids), opts: {}, seed: 4, match: 0 });
	const one = h.view({ seat: null }).opener;
	h.init({ seats: seatsOf(...ids), opts: {}, seed: 99, match: 1 });
	const two = h.view({ seat: null }).opener;
	h.init({ seats: seatsOf(...ids), opts: {}, seed: 5, match: 2 });
	const three = h.view({ seat: null }).opener;
	check(`without it (an older shell): a draw, then the next seat each rematch (${one}, ${two}, ${three})`, two === (one + 1) % 3 && three === (one + 2) % 3);
	// Carried across a handover: the heir's PLAY AGAIN goes on round the table.
	const heir = game();
	heir.restore({ snapshot: h.snapshot() });
	heir.init({ seats: seatsOf(...ids), opts: {}, seed: 1, match: 3 });
	check("an heir goes on round the table from the snapshot", heir.view({ seat: null }).opener === (three + 1) % 3);
	const draws = new Set([1, 2, 3, 4, 5, 6, 7, 8, 9].map((seed) => {
		const k = game();
		k.init({ seats: seatsOf(...ids), opts: {}, seed, match: 0 });
		return k.view({ seat: null }).opener;
	}));
	check("the first match's opener is a draw: any seat may open", draws.size === 3);
	const rematch = game();
	rematch.init({ seats: seatsOf("a", "b", "c", "d"), opts: {}, seed: 1, match: 0 });
	rematch.apply({ action: { mode: "pairs" }, by: "a" });
	rematch.init({ seats: seatsOf("a", "b", "c", "d"), opts: {}, seed: 2, match: 1 });
	check("PLAY AGAIN keeps the board and mode picked last", rematch.view({ seat: null }).mode === "pairs" && rematch.view({ seat: null }).phase === "play");
}

// ------------------------------------------------------------------- bots

/** Bots on every seat, played to the end: { over, steps, result, bad }. */
function botGame(ids, { board, mode = "ffa", seed }) {
	const g = game();
	g.init({ seats: seatsOf(...ids), opts: {}, seed, match: 0 });
	if (board !== g.view({ seat: null }).board) g.apply({ action: { board }, by: ids[0] });
	if (mode !== "ffa") g.apply({ action: { mode }, by: ids[0] });
	g.apply({ action: { start: true }, by: ids[0] });
	let steps = 0;
	let bad = null;
	const G = geometry(board);
	for (; !g.view({ seat: null }).over && steps < 20000; steps++) {
		const [who] = g.turn();
		const a = g.bot({ seat: who });
		const before = g.view({ seat: null });
		const why = g.apply({ action: a, by: who });
		if (why) {
			bad = `${who} ${JSON.stringify(a)}: ${why}`;
			break;
		}
		const after = g.view({ seat: null });
		// Every token stays on the board: -1 … HOME.
		if (after.tokens.some((t) => t.some((p) => p < -1 || p > G.HOME))) {
			bad = `a token off the board: ${JSON.stringify(after.tokens)}`;
			break;
		}
		// A bot's one move is its whole turn: the turn has passed on (else a
		// platform asking bots only as they come on turn would stall).
		if (!after.over && g.turn()[0] === who) bad = `${who} still on turn after its move`;
		// The log holds every event since, in order, ending with the newest.
		const fresh = after.log.filter((e) => e.n > (before.last?.n ?? 0)).map((e) => e.n);
		if (!fresh.length || fresh.some((n, i) => n !== (before.last?.n ?? 0) + 1 + i) || fresh.at(-1) !== after.last.n) bad = `the log skipped: ${fresh.join()}`;
		if (bad) break;
	}
	return { over: g.view({ seat: null }).over, steps, result: g.result(), view: g.view({ seat: null }), bad };
}

console.log("\nbots finish games, every board and mode");
{
	const tables = [
		[2, 4, "ffa"],
		[3, 4, "ffa"],
		[4, 4, "ffa"],
		[4, 4, "pairs"],
		[2, 6, "ffa"],
		[3, 6, "ffa"],
		[4, 6, "ffa"],
		[5, 6, "ffa"],
		[6, 6, "ffa"],
		[6, 6, "pairs"],
		[6, 6, "trios"],
	];
	for (const [n, board, mode] of tables) {
		const ids = Array.from({ length: n }, (_, i) => `bot_${i}`);
		const runs = [11, 22, 33].map((seed) => botGame(ids, { board, mode, seed }));
		const ok = runs.every((r) => r.over && !r.bad && r.result && r.result.ranking.flat().sort().join() === [...ids].sort().join());
		const kinds = runs.every((r) => r.result?.kind === (mode === "ffa" ? "ffa" : "teams"));
		const places = mode === "ffa" ? runs.every((r) => r.view.done.length === placesOf(n)) : runs.every((r) => r.view.winners != null);
		check(`${n} bots, ${board}-player board, ${mode}: every game ends, everyone ranked, each bot move a whole turn (${runs.map((r) => r.steps).join(", ")} turns)`, ok && kinds && places, runs.map((r) => r.bad || (r.over ? "" : "unfinished")).join("; "));
	}
	const p = table(["pA", "bot_1"]);
	check("a person cannot have their turn played for them", p.g.apply({ action: { turn: true }, by: "pA" }) === "tap the die to roll");
	// The bot plays better than chance: against a bot that picks its first legal move, it wins most games.
	let wins = 0;
	const GAMES = 40;
	for (let seed = 1; seed <= GAMES; seed++) {
		const g = game();
		g.init({ seats: seatsOf("bot_smart", "naive"), opts: {}, seed: seed * 7919, match: 0, first: seed % 2 ? "bot_smart" : "naive" });
		g.apply({ action: { start: true }, by: "bot_smart" });
		for (let k = 0; k < 20000 && !g.view({ seat: null }).over; k++) {
			const [who] = g.turn();
			const v = g.view({ seat: null });
			const a = who === "bot_smart" ? g.bot({ seat: who }) : v.stage === "roll" ? { roll: true } : { owner: v.moves[0].owner, token: v.moves[0].token };
			g.apply({ action: a, by: who });
		}
		if (g.view({ seat: null }).winner === 0) wins++;
	}
	check(`the bot beats a careless one in most games (${wins} of ${GAMES})`, wins >= GAMES * 0.6);
}

console.log("\nthe die");
{
	const g = game();
	g.init({ seats: seatsOf("bot_a", "bot_b"), opts: {}, seed: 12345, match: 0 });
	g.apply({ action: { start: true }, by: "bot_a" });
	const faces = [0, 0, 0, 0, 0, 0, 0];
	let seen = 0;
	for (let k = 0; k < 6000 && !g.view({ seat: null }).over; k++) {
		const [who] = g.turn();
		g.apply({ action: g.bot({ seat: who }), by: who });
		// Every roll, from the log (a bot's turn may hold several).
		for (const e of g.view({ seat: null }).log) {
			if (e.n <= seen) continue;
			seen = e.n;
			if (!e.picked) faces[e.roll]++; // a picked move plays the roll before it
		}
	}
	const total = faces.slice(1).reduce((a, b) => a + b, 0);
	check(`every face comes up, about a sixth each (${faces.slice(1).join(", ")})`, faces.slice(1).every((f) => f > total / 6 - total / 12 && f < total / 6 + total / 12));
}

// --------------------------------------------------------------- handover

console.log("\nhandover mid-game: the heir rolls on");
{
	const host = game();
	host.init({ seats: seatsOf("pA", "bot_1", "bot_2", "bot_3"), opts: {}, seed: 2024, match: 0, first: "pA" });
	host.apply({ action: { mode: "pairs" }, by: "pA" });
	host.apply({ action: { start: true }, by: "pA" });
	const step = (g) => {
		const [who] = g.turn();
		return g.apply({ action: g.bot({ seat: who }), by: who });
	};
	for (let k = 0; k < 120 && !host.view({ seat: null }).over; k++) step(host);
	const heir = game();
	heir.restore({ snapshot: host.snapshot() });
	check("the heir's copy is the host's game: same view for everyone", ["pA", "bot_1", null].every((seat) => JSON.stringify(heir.view({ seat })) === JSON.stringify(host.view({ seat }))));
	let same = true;
	for (let k = 0; k < 400 && !host.view({ seat: null }).over; k++) {
		step(host);
		step(heir);
		if (JSON.stringify(heir.view({ seat: null })) !== JSON.stringify(host.view({ seat: null }))) {
			same = false;
			break;
		}
	}
	check("…and it rolls exactly what the host would have: the die's state is in the snapshot", same);
	const snap = host.snapshot();
	snap.tokens[0][0] = 99;
	check("the snapshot is a copy", host.view({ seat: null }).tokens[0][0] !== 99);
	check("a token count of four per seat", host.view({ seat: null }).tokens.every((t) => t.length === TOKENS));
}

console.log("\nfacts for the arcade's achievements: a win by others leaving is not a finish");
{
	const { g } = table(["pA", "pB", "pC"], { tokens: [[10, -1, -1, -1], [12, -1, -1, -1], [-1, -1, -1, -1]] });
	g.leave({ seat: "pB" });
	g.leave({ seat: "pC" });
	check("won because the others left: finished is false", g.result()?.seatFacts?.pA?.finished === false, JSON.stringify(g.result()?.seatFacts));
	const { g: h } = table(["pA", "bot_1"], { tokens: [[55, 56, 56, 56], [10, -1, -1, -1]], rolls: [1] });
	roll(h, "pA");
	check("every token home: finished is true", h.result()?.seatFacts?.pA?.finished === true && h.result().seatFacts.bot_1.finished === false, JSON.stringify(h.result()?.seatFacts));
}

console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
