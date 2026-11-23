// sudoku/sudoku.js — Sudoku, as a race. An SDK v2 managed game.
//
// Alone it is plain Sudoku: one tap from the game page, a timer, a best time.
// With friends (or bots) everybody gets **the same puzzle** and the first to
// fill it correctly wins, watching each other's progress fill up as they go.
//
// The rules are sudoku-rules.js `race()`: the platform runs them on the host,
// sends every phone its view, polls the bots, reports the result and draws the
// end card (PLAY AGAIN goes back to picking a puzzle), and hands the race to
// the heir if the host leaves. This file is the page: the grid this phone
// solves on, which never leaves it — only "this many cells right" does.

const { CELLS, PEERS, LEVELS, LEVEL_IDS, toText, fromText, today, clock, standings, clearNotes, empties: emptiesIn } = sudokuRules;

arcade.managed(sudokuRules.race({ host: () => arcade.party?.host ?? null }));

// ------------------------------------------------------------------ chrome

const style = document.createElement("style");
style.textContent = `
	.g-stage { position: absolute; inset: 0; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 8px;
		padding: calc(env(safe-area-inset-top) + 52px) max(12px, env(safe-area-inset-right))
			max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left)); }
	.g-fill { flex: 1 1 auto; min-height: 0; width: 100%; display: flex; flex-direction: column;
		align-items: center; justify-content: center; gap: 8px; }
	.g-hud { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: center;
		gap: 4px 14px; min-height: 1.5em; font-size: clamp(0.85rem, 3vw, 1.1rem); color: var(--accent);
		text-shadow: 0 0 8px var(--accent-glow); text-align: center; }
	.g-hud .g-muted { color: var(--muted); text-shadow: none; }
	.g-overlay p { color: var(--muted); margin: 0; }
	.su { display: flex; flex-direction: column; gap: 10px; align-items: center;
		width: 100%; max-width: 520px; }
	.su-race { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; width: 100%; }
	.su-racer { display: flex; flex-direction: column; gap: 3px; min-width: 76px; flex: 1 1 76px;
		max-width: 140px; font-size: 0.75rem; color: var(--ink-2); }
	.su-racer.me { color: var(--accent); }
	.su-racer span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.su-bar { height: 5px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
	.su-bar i { display: block; height: 100%; background: currentColor; transition: width 0.3s; }
	/* Nine equal rows, not rows sized by what is in them: a row with no
	   given digit (a random puzzle may deal one) shrank to a sliver, 13px of
	   a 40px board, until something was written in it. */
	.su-grid { display: grid; grid-template-columns: repeat(9, 1fr); grid-template-rows: repeat(9, 1fr); aspect-ratio: 1;
		width: min(100%, calc(100dvh - 330px)); min-width: 260px;
		border: 2px solid var(--ink); border-radius: 6px; overflow: hidden;
		background: var(--surface); user-select: none; touch-action: manipulation; }
	.su-cell { position: relative; display: flex; align-items: center; justify-content: center;
		border: 0; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
		background: transparent; color: var(--accent); padding: 0; font: inherit;
		font-size: var(--su-digit, 1.4rem); cursor: pointer; }
	.su-cell:nth-child(9n) { border-right: 0; }
	.su-cell:nth-child(9n+3), .su-cell:nth-child(9n+6) { border-right: 2px solid var(--ink); }
	.su-cell:nth-child(n+19):nth-child(-n+27), .su-cell:nth-child(n+46):nth-child(-n+54) {
		border-bottom: 2px solid var(--ink); }
	.su-cell:nth-child(n+73) { border-bottom: 0; }
	.su-cell.given { color: var(--ink); font-weight: 600; }
	.su-cell.near { background: var(--surface-2); }
	.su-cell.same { background: color-mix(in oklch, var(--accent) 16%, transparent); }
	.su-cell.sel { background: color-mix(in oklch, var(--accent) 32%, transparent); }
	.su-notes { position: absolute; inset: 1px; display: grid; grid-template-columns: repeat(3, 1fr);
		font-size: var(--su-note, 0.55rem); color: var(--ink-2); line-height: 1; }
	.su-notes span { display: flex; align-items: center; justify-content: center; }
	.su-pad { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 100%; max-width: 440px; }
	.su-pad button { min-height: 48px; border-radius: 8px; border: 2px solid var(--rule);
		background: var(--surface); color: var(--ink); font: inherit; font-size: 1.2rem; cursor: pointer; }
	.su-pad button:disabled { opacity: 0.35; }
	.su-pad button.tool { font-size: 0.75rem; letter-spacing: 0.08em; color: var(--ink-2); }
	.su-pad button.wide { grid-column: 1 / -1; }
	.su-pad button.on { border-color: var(--accent); color: var(--accent); }
	.su-msg { min-height: 1.2em; font-size: 0.78rem; color: var(--ink-2); text-align: center; }
	.su-pick { display: flex; flex-direction: column; gap: 12px; align-items: center; width: 100%; max-width: 380px; }
	.su-pick h2 { margin: 0; font-weight: normal; font-size: 1.6rem; color: var(--ink); }
	.su-levels { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%; }
	.su-levels button { min-height: 52px; border-radius: 8px; border: 2px solid var(--rule);
		background: var(--surface); color: var(--ink); font: inherit; cursor: pointer;
		display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
	.su-levels button small { font-size: 0.75rem; color: var(--ink-3); }
	.su-levels button.on { border-color: var(--accent); color: var(--accent); }
	.su-go { display: flex; flex-direction: column; gap: 8px; width: 100%; }
	.su-go .neon-btn { min-height: 48px; width: 100%; }
	.su-hint { font-size: 0.76rem; color: var(--ink-2); text-align: center; line-height: 1.45; }
`;
document.head.append(style);

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
};

const stage = el("div", "g-stage");
const hud = el("div", "g-hud");
hud.setAttribute("role", "status");
hud.setAttribute("aria-live", "polite");
const wrap = el("div", "su");
const fill = el("div", "g-fill");
fill.append(wrap);
stage.append(hud, fill);
const overlay = el("div", "overlay g-overlay");
overlay.hidden = true;
document.body.append(stage, overlay);

/** The status line: text nodes updated in place, so a screen reader is not interrupted. */
const hudCells = new Map();
function setHud(parts) {
	const seen = new Set();
	for (const part of parts) {
		seen.add(part.key);
		let node = hudCells.get(part.key);
		if (!node) {
			node = el("span");
			hudCells.set(part.key, node);
			hud.append(node);
		}
		if (node.textContent !== String(part.text)) node.textContent = String(part.text);
		if (node.className !== (part.className ?? "")) node.className = part.className ?? "";
	}
	for (const [key, node] of hudCells) {
		if (seen.has(key)) continue;
		node.remove();
		hudCells.delete(key);
	}
}

// ------------------------------------------------------------------ state
//
// `state` is this phone's view of the race: which puzzle, and how far each
// racer has got. The digits a player has typed are theirs alone (`board`).

let state = { match: 0, phase: "pick", level: null, daily: null, puzzle: null, solution: null, progress: {}, times: {}, winner: null, players: [] };

let storage = {};
const store = {
	get: (key) => storage[key],
	set(key, value) {
		storage[key] = value;
		arcade.send("store.set", { key, value });
	},
};
let level = "easy";
let best = {}; // level → ms
let dailyDone = {}; // "date:level" → ms

let board = null; // { match, puzzle, solution, entries, notes, given, startedAt, elapsedBefore, solvedMs }
let selected = -1;
let notesMode = false;
let finishedMatch = 0;

const me = () => arcade.party?.self ?? null;
const isHost = () => arcade.isHost();
const nameOf = (id) => arcade.party?.members.find((m) => m.id === id)?.name ?? "Player";
const players = () => state.players;
const playing = () => players().includes(me());
const empties = () => emptiesIn(state.puzzle);

// --------------------------------------------------------------- the board

function openBoard() {
	const puzzle = fromText(state.puzzle);
	const saved = store.get("current");
	const resume = saved?.puzzle === state.puzzle;
	board = {
		match: state.match,
		puzzle,
		solution: fromText(state.solution),
		given: puzzle.map(Boolean),
		entries: resume ? fromText(saved.entries) : puzzle.slice(),
		notes: resume && Array.isArray(saved.notes) ? saved.notes.slice() : Array(CELLS).fill(0),
		startedAt: performance.now(),
		elapsedBefore: resume ? saved.elapsed ?? 0 : 0,
		solvedMs: null,
	};
	selected = board.given.indexOf(false);
	notesMode = false;
	report();
}

const elapsed = () => (board ? board.solvedMs ?? board.elapsedBefore + (performance.now() - board.startedAt) : 0);
const rightCount = () => (board ? board.entries.filter((d, i) => !board.given[i] && d === board.solution[i]).length : 0);

function save() {
	if (!board) return;
	store.set("current", {
		puzzle: state.puzzle,
		solution: state.solution,
		level: state.level,
		daily: state.daily,
		entries: toText(board.entries),
		notes: board.notes,
		elapsed: Math.round(elapsed()),
	});
}

/** Tell the host how far I have got; finishing is just "all of them". */
function report() {
	if (!board || !playing() || state.phase !== "play") return;
	const right = rightCount();
	const done = right === empties();
	if (done && board.solvedMs == null) board.solvedMs = elapsed();
	// The filled grid goes with the finish: alone, it is the proof the
	// arcade's server checks before it ranks the time (sudoku-rules.js result).
	arcade.act({ progress: { match: state.match, right, ms: done ? Math.round(board.solvedMs) : null, ...(done ? { grid: toText(board.entries) } : {}) } });
}

function place(digit) {
	if (!board || state.phase !== "play" || !playing() || selected < 0 || board.given[selected]) return;
	if (board.solvedMs != null) return;
	if (notesMode && digit) {
		if (board.entries[selected]) return;
		board.notes[selected] ^= 1 << digit;
	} else {
		const was = board.entries[selected];
		board.entries[selected] = was === digit ? 0 : digit;
		if (board.entries[selected]) board.notes = clearNotes(board.notes, selected, digit);
		else board.notes[selected] = 0;
	}
	save();
	report();
	render();
}

function move(dr, dc) {
	const i = selected < 0 ? 0 : selected;
	const r = (Math.floor(i / 9) + dr + 9) % 9;
	const c = ((i % 9) + dc + 9) % 9;
	selected = r * 9 + c;
	render();
}

/** The host deals. `how`: "daily", "new", or "resume" (the unfinished one on this phone). */
function startPuzzle(how) {
	if (!isHost()) return;
	const saved = store.get("current");
	arcade.act({ start: how, level, ...(how === "resume" ? { resume: saved } : {}) });
}

/** Whatever just changed in `state`, catch the board and the screen up. */
function onState() {
	if (state.phase !== "pick" && state.puzzle && board?.match !== state.match) openBoard();
	if (state.phase === "pick") board = null;
	if (state.phase === "over") finish();
	else overlay.hidden = true;
	render();
}

// ------------------------------------------------------------------ the end
//
// The platform draws the end card (the winner, PLAY AGAIN for the host). Under
// it, SEE THE BOARD shows this: the times, the standings, your best.

function finish() {
	const self = me();
	const mine = state.times[self] ?? (board?.solvedMs != null ? Math.round(board.solvedMs) : null);
	const solo = players().length === 1;

	if (finishedMatch !== state.match) {
		finishedMatch = state.match;
		// A best time is a solve on this phone, raced or not.
		if (state.winner === self && mine != null) {
			if (!(best[state.level] <= mine)) {
				best = { ...best, [state.level]: mine };
				store.set("best", best);
			}
			if (state.daily) {
				const key = `${state.daily}:${state.level}`;
				// Kept to the last few weeks, so storage does not grow forever.
				const kept = Object.entries(dailyDone).sort(([a], [b]) => b.localeCompare(a)).slice(0, 59);
				dailyDone = Object.fromEntries([[key, Math.min(dailyDone[key] ?? Infinity, mine)], ...kept]);
				store.set("daily", dailyDone);
			}
		}
		store.set("current", null);
	}

	const winnerName = state.winner === self ? "You" : nameOf(state.winner);
	const title = solo ? `SOLVED IN ${clock(mine ?? 0)}` : state.winner === self ? "YOU WIN!" : `${winnerName.toUpperCase()} WINS`;
	overlay.replaceChildren(el("h1", null, title));
	if (!solo) {
		for (const slot of standings(players(), state.progress, state.winner)) {
			for (const id of slot) {
				const name = id === self ? "You" : nameOf(id);
				overlay.append(el("p", null, id === state.winner
					? `${name} — solved${state.times[id] != null ? ` in ${clock(state.times[id])}` : ""}`
					: `${name} — ${state.progress[id] ?? 0} of ${empties()}`));
			}
		}
	}
	const b = best[state.level];
	overlay.append(el("p", null, `${LEVELS[state.level].label}${state.daily ? " · today's puzzle" : ""}${b ? ` · your best ${clock(b)}` : ""}`));
	overlay.hidden = false;
}

// --------------------------------------------------------------- the screens

function renderPick() {
	wrap.replaceChildren();
	const pick = el("div", "su-pick");
	pick.append(el("h2", null, "Sudoku"));
	if (!isHost()) {
		pick.append(el("div", "su-hint", "The host is picking a puzzle. Everybody gets the same one — first to finish wins."));
		wrap.append(pick);
		return;
	}
	pick.append(el("div", "su-hint", players().length > 1
		? "Everybody gets the same puzzle. First to fill it in correctly wins."
		: "Fill every row, column and box with 1 to 9."));
	const levels = el("div", "su-levels");
	for (const id of LEVEL_IDS) {
		const b = el("button", id === level ? "on" : "");
		b.type = "button";
		b.append(el("span", null, LEVELS[id].label));
		b.append(el("small", null, best[id] ? `best ${clock(best[id])}` : "—"));
		b.setAttribute("aria-pressed", String(id === level));
		b.addEventListener("click", () => {
			level = id;
			store.set("level", level);
			render();
		});
		levels.append(b);
	}
	pick.append(levels);
	const go = el("div", "su-go");
	const key = `${today()}:${level}`;
	const daily = el("button", "neon-btn neon-btn--accent", dailyDone[key] ? `TODAY'S PUZZLE · DONE IN ${clock(dailyDone[key])}` : "TODAY'S PUZZLE");
	daily.type = "button";
	daily.addEventListener("click", () => startPuzzle("daily"));
	const fresh = el("button", "neon-btn", "NEW PUZZLE");
	fresh.type = "button";
	fresh.addEventListener("click", () => startPuzzle("new"));
	go.append(daily, fresh);
	// An unfinished puzzle from last time, for one player only: carrying it
	// into a race would hand the host a head start.
	const saved = store.get("current");
	if (saved?.puzzle && saved.solution && LEVELS[saved.level] && players().length === 1) {
		const more = el("button", "neon-btn", `CONTINUE · ${LEVELS[saved.level].label}${saved.daily ? " · daily" : ""} · ${clock(saved.elapsed ?? 0)}`);
		more.type = "button";
		more.addEventListener("click", () => startPuzzle("resume"));
		go.prepend(more);
	}
	pick.append(go);
	wrap.append(pick);
}

let cells = [];
let padButtons = [];
let notesButton = null;
let raceBox = null;
let msg = null;

function buildPlay() {
	wrap.replaceChildren();
	raceBox = el("div", "su-race");
	const grid = el("div", "su-grid");
	grid.setAttribute("role", "grid");
	cells = Array.from({ length: CELLS }, (_, i) => {
		const c = el("button", "su-cell");
		c.type = "button";
		c.addEventListener("pointerdown", (e) => {
			e.preventDefault();
			selected = i;
			render();
		});
		grid.append(c);
		return c;
	});
	msg = el("div", "su-msg");
	const pad = el("div", "su-pad");
	padButtons = [];
	for (let d = 1; d <= 9; d++) {
		const b = el("button", null, String(d));
		b.type = "button";
		b.addEventListener("click", () => place(d));
		pad.append(b);
		padButtons.push(b);
	}
	const erase = el("button", "tool", "ERASE");
	erase.type = "button";
	erase.addEventListener("click", () => place(0));
	pad.append(erase);
	notesButton = el("button", "tool wide", "NOTES");
	notesButton.type = "button";
	notesButton.addEventListener("click", () => {
		notesMode = !notesMode;
		render();
	});
	pad.append(notesButton);
	wrap.append(raceBox, grid, msg, pad);
	sizeDigits();
}

/**
 * Digits scale with the grid, which scales with the phone. A cell is a ninth
 * of the board — 36px on a 354px phone, 40px at 390 — so the digits placed
 * fill it and are read; its pencil notes are a 3 x 3 grid inside it, as large
 * as a third of the cell holds (11px at 36px, 12px at 40px).
 */
function sizeDigits() {
	const grid = wrap.querySelector(".su-grid");
	if (!grid) return;
	const cell = grid.clientWidth / 9;
	grid.style.setProperty("--su-digit", `${Math.round(cell * 0.58)}px`);
	grid.style.setProperty("--su-note", `${Math.max(8, Math.round(cell * 0.3))}px`);
}

function renderPlay() {
	if (!wrap.querySelector(".su-grid")) buildPlay();
	const total = empties();
	const self = me();
	// The race: everybody's progress, me first.
	raceBox.replaceChildren();
	const ids = players();
	if (ids.length > 1) {
		for (const id of [self, ...ids.filter((x) => x !== self)]) {
			if (!ids.includes(id)) continue;
			const r = el("div", "su-racer" + (id === self ? " me" : ""));
			const done = state.progress[id] ?? 0;
			r.append(el("span", null, `${id === self ? "You" : nameOf(id)} ${Math.round((done / total) * 100)}%`));
			const bar = el("div", "su-bar");
			const fillBar = el("i");
			fillBar.style.width = `${(done / total) * 100}%`;
			bar.append(fillBar);
			r.append(bar);
			raceBox.append(r);
		}
	}
	if (!board) return;
	const sel = selected;
	const selDigit = sel >= 0 ? board.entries[sel] : 0;
	const counts = Array(10).fill(0);
	for (const d of board.entries) counts[d]++;
	for (let i = 0; i < CELLS; i++) {
		const c = cells[i];
		const d = board.entries[i];
		let cls = "su-cell";
		if (board.given[i]) cls += " given";
		if (i === sel) cls += " sel";
		else if (selDigit && d === selDigit) cls += " same";
		else if (sel >= 0 && PEERS[sel].includes(i)) cls += " near";
		if (c.className !== cls) c.className = cls;
		if (d) {
			if (c.textContent !== String(d) || c.firstChild?.nodeType !== 3) c.textContent = String(d);
		} else if (board.notes[i]) {
			const notes = el("div", "su-notes");
			for (let n = 1; n <= 9; n++) notes.append(el("span", null, board.notes[i] & (1 << n) ? String(n) : ""));
			c.replaceChildren(notes);
		} else if (c.childNodes.length) {
			c.replaceChildren();
		}
		c.setAttribute("aria-label", `row ${Math.floor(i / 9) + 1} column ${(i % 9) + 1}${d ? `, ${d}` : ""}`);
	}
	const canPlay = playing() && state.phase === "play" && board.solvedMs == null;
	padButtons.forEach((b, k) => (b.disabled = !canPlay || counts[k + 1] >= 9));
	notesButton.className = "tool wide" + (notesMode ? " on" : "");
	notesButton.setAttribute("aria-pressed", String(notesMode));
	const full = board.entries.every(Boolean);
	msg.textContent = !playing() ? "Watching the race."
		: full && rightCount() !== total ? "Every cell is filled, but something is not right yet."
		: notesMode ? "Notes: tap digits to pencil them in." : "";
}

function renderHud() {
	if (state.phase === "pick") setHud([{ key: "s", text: "Pick a puzzle", className: "g-muted" }]);
	else setHud([
		{ key: "s", text: `${LEVELS[state.level].label}${state.daily ? " · Daily" : ""}` },
		{ key: "t", text: clock(elapsed()), className: "g-muted" },
	]);
}

function render() {
	if (!arcade.party) return;
	if (state.phase === "pick") {
		cells = [];
		renderPick();
	} else {
		renderPlay();
	}
	renderHud();
}

// ------------------------------------------------------------------ the input

addEventListener("keydown", (e) => {
	if (state.phase !== "play") return;
	if (e.key >= "1" && e.key <= "9") place(Number(e.key));
	else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") place(0);
	else if (e.key === "n" || e.key === "N") {
		notesMode = !notesMode;
		render();
	} else if (e.key === "ArrowUp") move(-1, 0);
	else if (e.key === "ArrowDown") move(1, 0);
	else if (e.key === "ArrowLeft") move(0, -1);
	else if (e.key === "ArrowRight") move(0, 1);
	else return;
	e.preventDefault();
});
addEventListener("resize", sizeDigits);

// ----------------------------------------------------------------------- boot

arcade.on("view", ({ state: next }) => {
	state = next;
	onState();
});
// The host may change (the pick screen is the host's), and names with it.
arcade.on("roster", () => render());
setInterval(() => {
	if (state.phase === "play") renderHud();
}, 1000);

arcade.init.then((init) => {
	storage = init.storage ?? {};
	level = LEVEL_IDS.includes(store.get("level")) ? store.get("level") : "easy";
	best = store.get("best") ?? {};
	dailyDone = store.get("daily") ?? {};
	render();
});

/** For the tests: the race as this phone sees it, and its own board. */
arcade.debug = () => ({
	phase: state.phase,
	match: state.match,
	level: state.level,
	daily: state.daily,
	puzzle: state.puzzle,
	solution: state.solution,
	progress: { ...state.progress },
	winner: state.winner,
	entries: board ? toText(board.entries) : null,
	notes: board ? board.notes.slice() : null,
	selected,
	notesMode,
});
