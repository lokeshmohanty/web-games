#!/usr/bin/env node
/**
 * test-draw-guess.mjs — the rounds, the word, the guesses and the scoring.
 *
 *   node draw-guess/test-draw-guess.mjs
 *
 * Plays the managed rules the platform runs on the host (SDK v2), with a
 * clock the test moves by hand. What must hold: only the drawer is told the
 * word before the reveal, a phase ends at its deadline and at nothing else
 * (bar everybody guessing), and the scores and the ranking add up.
 */
import { readFileSync } from "node:fs";

new Function(readFileSync(new URL("./draw-guess-rules.js", import.meta.url), "utf8"))();
const { PHASES, SCORE_BASE, SCORE_TIME_BONUS, DRAWER_BONUS, ROUNDS_PER_PLAYER, game } = globalThis.drawGuessRules;

let failures = 0;
const check = (label, ok, detail = "") => {
	console.log(`  ${ok ? "ok  " : "FAIL"} ${label}${ok || !detail ? "" : ` — ${detail}`}`);
	if (!ok) failures++;
};

let t = 1_000_000;
const rules = game({ now: () => t, random: () => 0 });
const seats = ["pC", "pA", "pB"].map((id) => ({ id, bot: false }));
const clock = () => rules.apply({ action: { clock: rules.view({ seat: null }).clock }, by: "pA" });
const pass = (ms) => {
	t += ms;
	return clock();
};

console.log("\na round");
rules.init({ seats, opts: {}, seed: 1, match: 0 });
let v = rules.view({ seat: "pA" });
check("it opens on choosing, round 1 of two per player", v.phase === "choosing" && v.round === 0 && v.totalRounds === 3 * ROUNDS_PER_PLAYER);
check("the rotation is the players in order", JSON.stringify(v.players) === '["pA","pB","pC"]' && v.drawer === "pA");
check("the drawer is told the word", v.word === "cat");
check("nobody else is", rules.view({ seat: "pB" }).word === null && rules.view({ seat: null }).word === null);
check("no bots: nobody is on turn", rules.turn().length === 0);
check("an early clock is refused", clock() === "not yet");
check("a clock for another phase is refused", rules.apply({ action: { clock: "1:0:drawing" }, by: "pA" }) === "stale");
check("the deadline moves it on", pass(PHASES.choosing) == null && rules.view({ seat: null }).phase === "drawing");
v = rules.view({ seat: "pB" });
check("guessers see blanks", v.hint === "___" && v.word === null);
check("the time left travels as a duration", v.msLeft === PHASES.drawing);
check("the drawer cannot guess", rules.apply({ action: { guess: "cat" }, by: "pA" }) === "you are drawing");
rules.apply({ action: { guess: "dog" }, by: "pB" });
v = rules.view({ seat: "pC" });
check("a wrong guess is said in the chat", v.chat.at(-1)?.text === "dog" && v.chat.at(-1).kind === "chat");
t += 10_500; // 49.5 s left: 50 counted
rules.apply({ action: { guess: " CAT " }, by: "pB" });
v = rules.view({ seat: "pC" });
check("a right guess scores, with the time left", v.scores.pB === SCORE_BASE + 50 * SCORE_TIME_BONUS, JSON.stringify(v.scores));
check("and the drawer gets a bonus", v.scores.pA === DRAWER_BONUS);
check("and the word is not said", v.chat.at(-1).kind === "correct" && !v.chat.at(-1).text);
check("guessing twice is refused", rules.apply({ action: { guess: "cat" }, by: "pB" }) === "you have it");
rules.apply({ action: { guess: "cat" }, by: "pC" });
v = rules.view({ seat: "pC" });
check("everybody guessing ends the drawing at once", v.phase === "reveal" && v.word === "cat");

console.log("\nthe game");
pass(PHASES.reveal);
v = rules.view({ seat: "pB" });
check("the next round, the next drawer", v.phase === "choosing" && v.round === 1 && v.drawer === "pB" && v.word === "cat");
const snap = JSON.parse(JSON.stringify(rules.snapshot()));
const heir = game({ now: () => t + 30_000, random: () => 0 });
heir.restore({ snapshot: snap });
check("the heir carries on, word and all, with the time it had", heir.view({ seat: "pB" }).word === "cat" && heir.view({ seat: null }).msLeft === PHASES.choosing);
// The drawer leaves mid-drawing: the drawing ends.
pass(PHASES.choosing);
check("a drawer who left ends the drawing", rules.leave({ seat: "pB" }) === true && rules.view({ seat: null }).phase === "reveal");
check("…and is out of the rotation", !rules.view({ seat: null }).players.includes("pB"));
for (let i = 0; i < 40 && rules.view({ seat: null }).phase !== "gameover"; i++) pass(60_000);
v = rules.view({ seat: null });
check("the game ends after the last round", v.phase === "gameover" && rules.apply({ action: { clock: v.clock }, by: "pA" }) === "over");
const r = rules.result();
// pB and pC both guessed with 50 s left (200 each); pA drew it (2 × 50).
check("the ranking is by points, ties together, a leaver still in it", r?.kind === "ffa" && JSON.stringify(r.ranking) === '[["pC","pB"],["pA"]]', JSON.stringify(r));
check("with the scores", JSON.stringify(r.scores) === '{"pA":100,"pC":200,"pB":200}', JSON.stringify(r.scores));
rules.init({ seats, opts: {}, seed: 2, match: 1 });
v = rules.view({ seat: null });
check("PLAY AGAIN starts afresh, counting on", v.match === 2 && v.round === 0 && Object.keys(v.scores).length === 0 && v.phase === "choosing");

console.log("\nwho draws first (docs/sdk-v2.md \"Who starts\")");
{
	// The platform names a seat in init: random for the first match, then the
	// next seat (party order) on each PLAY AGAIN. That seat draws first and
	// the rotation goes on from it. Mid-series the host leaves: the heir
	// restores the copy mid-match and runs the next rematch.
	const party = ["pC", "pA", "pB"]; // party order: the order `first` goes round in
	const seated = party.map((id) => ({ id, bot: false }));
	const host = game({ now: () => t, random: () => 0 });
	const heir2 = game({ now: () => t, random: () => 0 });
	const firsts = ["pA", "pB", "pC", "pA"]; // drawn pA, then the next seat each time
	const drew = [];
	for (let m = 0; m < 4; m++) {
		const g = m < 2 ? host : heir2;
		if (m === 2) heir2.restore({ snapshot: JSON.parse(JSON.stringify(host.snapshot())) });
		g.init({ seats: seated, opts: {}, seed: m, match: m, first: firsts[m] });
		const w = g.view({ seat: null });
		drew.push(w.drawer);
		if (m === 1) check("…the rotation goes on from the first drawer", JSON.stringify(w.players) === '["pB","pC","pA"]', JSON.stringify(w.players));
	}
	check(`the seat the platform names draws first, three rematches running, the heir's too (${drew.join(", ")})`, JSON.stringify(drew) === JSON.stringify(firsts));
	host.init({ seats: seated, opts: {}, seed: 9, match: 0 });
	check("no `first` (an older shell): the rotation starts at the top", host.view({ seat: null }).drawer === "pA");
}

console.log(failures ? `\n${failures} failing` : "\nall passing");
process.exit(failures ? 1 : 0);
