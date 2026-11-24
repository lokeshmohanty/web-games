// light-cycles/light-cycles.js — Light Cycles. An SDK v2 managed game, ticking.
//
// The casual counterweight to the board games: one bit of input, no rules to
// read, and a round is over in under a minute. You ride, you leave a wall
// behind you, you do not touch a wall. Last one moving wins.
//
// The round is light-cycles-rules.js `game()`: the platform steps it on the
// host 20 times a second with everyone's latest steering and the bots' (its
// "tick"), sends each phone the riders' heads, pauses everyone while the host
// is out of the app, reports each round and draws the end card — PLAY AGAIN
// is the next round, wins carried over. This file is the arena: it paints the
// heads it is sent into its own trail canvas, and steers.
//
// ## Steering
//
// You send the direction you want; the host refuses a reversal. Touch is
// relative — the left half of the screen turns you left, the right half turns
// you right — because that is one thumb and no aiming. Keyboard arrows are
// absolute, because on a keyboard that is what people press.

const { COLS, ROWS, ORDER, WALL, idx } = lightCycleRules;

// The options last played (`{ obstacles }`), kept in the game's storage on
// this phone: one person's round, and PLAY AGAIN, start on them without the
// setup (light-cycles-rules.js `game()`).
let lastOpts = null;
arcade.init.then((m) => {
	const o = m?.storage?.opts;
	if (o && typeof o === "object") lastOpts = o;
});
const rules = lightCycleRules.game({ isHost: (id) => id === arcade.party?.host, last: () => lastOpts });
arcade.managed(rules);

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
	.lc-arena { position: relative; border: 2px solid var(--rule); border-radius: 10px;
		box-shadow: 0 0 30px var(--glow); touch-action: none; }
	.lc-arena canvas { position: absolute; inset: 0; width: 100%; height: 100%; border-radius: 8px; }
	.lc-zones { position: absolute; inset: 0; display: flex; }
	.lc-zone { flex: 1; display: flex; align-items: flex-end; justify-content: center;
		padding-bottom: 6px; color: color-mix(in oklch, var(--ink) 16%, transparent); font-size: 1.6rem;
		user-select: none; -webkit-user-select: none; }
	.lc-scores { display: flex; flex-wrap: wrap; gap: 4px 10px; justify-content: center;
		font-size: 0.75rem; letter-spacing: 0.06em; }
	.lc-scores span { white-space: nowrap; }
	.lc-key { width: 12px; height: 12px; margin-right: 4px; vertical-align: -1px; }
	/* The setup (friends' first round) over the arena, and the end's "Next game" line. */
	.lc-setup { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 10px; padding: 12px; box-sizing: border-box; text-align: center; border-radius: 8px;
		background: color-mix(in oklch, var(--bg) 78%, transparent); overflow-y: auto; }
	.lc-setup[hidden], .lc-next[hidden] { display: none; }
	.lc-setup h2 { margin: 0; font-family: var(--font-display); font-size: 1.4rem; letter-spacing: 0.06em; color: var(--accent); }
	.lc-setup p { margin: 0; max-width: 24em; color: var(--ink-2); line-height: 1.35; font-size: 0.85rem; }
	.lc-choice { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
	.lc-setup .neon-btn, .lc-next .neon-btn { min-height: 44px; min-width: 44px; padding: 8px 12px; font-size: 0.85rem; }
	.lc-choice .neon-btn { border: 2px solid var(--accent); }
	.lc-choice .neon-btn[aria-pressed="false"] { background: transparent; color: var(--accent); }
	.lc-next { display: flex; flex-direction: column; align-items: center; gap: 6px; font-size: 0.85rem; color: var(--ink-2); text-align: center; }
	.lc-next-line { display: flex; align-items: center; justify-content: center; gap: 4px 10px; flex-wrap: wrap; }
	.lc-next b { color: var(--ink); font-weight: 600; }
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
const fill = el("div", "g-fill");
const arena = el("div", "lc-arena");
const trailCanvas = el("canvas");
const headCanvas = el("canvas");
const zones = el("div", "lc-zones");
const leftZone = el("div", "lc-zone", "↰");
const rightZone = el("div", "lc-zone", "↱");
zones.append(leftZone, rightZone);
const setup = el("div", "lc-setup");
setup.hidden = true;
arena.append(trailCanvas, headCanvas, zones, setup);
const scores = el("div", "lc-scores");
const nextEl = el("div", "lc-next");
nextEl.hidden = true;
fill.append(arena, scores);
stage.append(hud, nextEl, fill);
document.body.append(stage);

const trail2d = trailCanvas.getContext("2d");
const head2d = headCanvas.getContext("2d");

/** The status line: text nodes updated in place. */
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

let view = null; // the host's last word: { round, step, countdown, racing, decided, winner, tickMs, riders, grid? }
let grid = new Uint8Array(COLS * ROWS); // the trails, as painted here
let round = null;
let lastStep = -1;
let cellW = 8;
let cellH = 8;
let seq = 0; // numbers each steering press

const riders = () => view?.riders ?? [];
const me = () => riders().find((x) => x.id === arcade.party?.self) ?? null;
const nameOf = (id) => arcade.party?.members.find((m) => m.id === id)?.name ?? "Player";
// Riders wear the theme's player colours, each its player's pick (the
// platform's seat colours, no two alike; seat order on an older shell),
// resolved on this device, so a theme change recolours every trail.
let seatCols = [];
const colorOf = (i) => arcade.theme?.players[seatCols[i] ?? i % 8] ?? "gray"; // theme-exempt: before the theme arrives
// And each rider its own pattern, on its trail and its head, so two never
// differ by colour alone (picked colours can be close, or one under colour
// blindness: review, 2026-11-24). By seat: solid, dot, frame, dash-dot,
// plus, bars across, bars down, half.
const PATTERNS = ["solid", "dot", "frame", "dashdot", "plus", "hbars", "vbars", "half"];
const patternOf = (i) => PATTERNS[i % PATTERNS.length];
/** Rider i's pattern into (x, y, w, h) on g, in its fill style; odd: the cell's (c + r) parity. */
function pattern(g, i, x, y, w, h, odd = false) {
	const p = patternOf(i);
	const t = Math.max(1, Math.round(Math.min(w, h) / 3));
	const box = (a, b, cw, ch) => g.fillRect(x + a, y + b, cw, ch);
	if (p === "solid" || (p === "dashdot" && !odd)) box(0, 0, w, h);
	else if (p === "dot" || p === "dashdot") box(w / 4, h / 4, w / 2, h / 2);
	else if (p === "frame") {
		const f = Math.max(1, Math.round(Math.min(w, h) / 4));
		box(0, 0, w, f), box(0, h - f, w, f), box(0, 0, f, h), box(w - f, 0, f, h);
	} else if (p === "plus") box(0, (h - t) / 2, w, t), box((w - t) / 2, 0, t, h);
	else if (p === "hbars") box(0, 0, w, t), box(0, h - t, w, t);
	else if (p === "vbars") box(0, 0, t, h), box(w - t, 0, t, h);
	else {
		g.beginPath();
		g.moveTo(x, y);
		g.lineTo(x + w, y);
		g.lineTo(x, y + h);
		g.closePath();
		g.fill();
	}
}
const glows = () => !/,\s*0\)$/.test(arcade.theme?.tokens.glow ?? ", 0)");

// ---------------------------------------------------------------- drawing

// How far a cell may be stretched from square before the arena is letterboxed
// instead. A 40x40 grid drawn square on a 390x844 phone leaves two thirds of
// the screen black; drawn to fill, the cells are rectangles, which costs
// nothing because movement is on the grid and not on the pixels. Past about
// this ratio it stops reading as an arena and starts reading as a bug.
const MAX_STRETCH = 1.6;

function layout() {
	const availW = stage.clientWidth;
	const availH = stage.clientHeight - hud.offsetHeight - scores.offsetHeight - 30;
	let w = Math.max(160, availW);
	let h = Math.max(160, availH);
	if (w / h > MAX_STRETCH) w = h * MAX_STRETCH;
	if (h / w > MAX_STRETCH) h = w * MAX_STRETCH;
	cellW = Math.max(3, Math.floor(w / COLS));
	cellH = Math.max(3, Math.floor(h / ROWS));
	const pxW = cellW * COLS;
	const pxH = cellH * ROWS;
	const dpr = Math.min(window.devicePixelRatio || 1, 2);
	arena.style.width = pxW + "px";
	arena.style.height = pxH + "px";
	for (const [canvas, c2d] of [[trailCanvas, trail2d], [headCanvas, head2d]]) {
		canvas.width = pxW * dpr;
		canvas.height = pxH * dpr;
		c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
	}
	repaintTrails();
	drawHeads();
}

/** Redraw every wall from the grid: on resize, a theme change and a full grid. */
function repaintTrails() {
	trail2d.clearRect(0, 0, cellW * COLS, cellH * ROWS);
	for (let r = 0; r < ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const owner = grid[idx(c, r)];
			if (owner === WALL) paintBlock(c, r);
			else if (owner) paintCell(c, r, owner - 1);
		}
	}
}

/** An obstacle at (c, r): the ink, faint, crossed — nobody's colour and no rider's pattern. */
function paintBlock(c, r) {
	const ink = arcade.theme?.tokens.ink ?? "gray"; // theme-exempt: before the theme arrives
	trail2d.fillStyle = ink;
	trail2d.globalAlpha = 0.35;
	trail2d.fillRect(c * cellW, r * cellH, cellW, cellH);
	trail2d.globalAlpha = 1;
	trail2d.strokeStyle = ink;
	trail2d.lineWidth = 1;
	trail2d.beginPath();
	trail2d.moveTo(c * cellW + 1, r * cellH + 1);
	trail2d.lineTo((c + 1) * cellW - 1, (r + 1) * cellH - 1);
	trail2d.moveTo((c + 1) * cellW - 1, r * cellH + 1);
	trail2d.lineTo(c * cellW + 1, (r + 1) * cellH - 1);
	trail2d.stroke();
}

/** Rider i's wall at (c, r): its colour, faint, and its pattern on top. */
function paintCell(c, r, i) {
	trail2d.fillStyle = colorOf(i);
	trail2d.globalAlpha = 0.3;
	trail2d.fillRect(c * cellW, r * cellH, cellW, cellH);
	trail2d.globalAlpha = 0.9;
	pattern(trail2d, i, c * cellW, r * cellH, cellW, cellH, (c + r) % 2 === 1);
	trail2d.globalAlpha = 1;
}

function drawHeads() {
	head2d.clearRect(0, 0, cellW * COLS, cellH * ROWS);
	const ink = arcade.theme?.tokens.ink;
	if (!ink) return;
	riders().forEach((rider, i) => {
		if (!rider.alive) return;
		head2d.fillStyle = ink;
		head2d.shadowColor = colorOf(i);
		head2d.shadowBlur = glows() ? Math.min(cellW, cellH) * 1.6 : 0;
		head2d.fillRect(rider.c * cellW, rider.r * cellH, cellW, cellH);
		head2d.shadowBlur = 0;
		// Its pattern inside, in its colour: the head says whose it is.
		head2d.fillStyle = colorOf(i);
		pattern(head2d, i, rider.c * cellW + 1, rider.r * cellH + 1, cellW - 2, cellH - 2);
	});
}

function renderScores() {
	const racing = !!view?.racing;
	scores.replaceChildren(
		...riders().map((rider, i) => {
			const s = el("span", null, `${nameOf(rider.id)} ${rider.wins}`);
			s.style.color = colorOf(i);
			// The rider's pattern beside its name, the key to its trail.
			const key = document.createElement("canvas");
			key.width = key.height = 12;
			key.className = "lc-key";
			key.setAttribute("aria-hidden", "true");
			const g = key.getContext("2d");
			g.fillStyle = colorOf(i);
			pattern(g, i, 0, 0, 12, 12);
			s.prepend(key);
			s.style.opacity = rider.alive || !racing ? "1" : "0.4";
			return s;
		}),
	);
}

function renderHud() {
	const mine = me();
	const parts = [];
	if (!view) parts.push({ key: "s", text: "Getting ready…", className: "g-muted" });
	else if (view.phase === "setup") parts.push({ key: "s", text: "Setting up", className: "g-muted" });
	else if (view.countdown > 0) {
		parts.push({ key: "s", text: view.countdown === 1 ? "GO" : `Starting in ${view.countdown - 1}…` });
	} else if (view.racing) {
		parts.push(mine?.alive ? { key: "s", text: "Ride" } : { key: "s", text: mine ? "You crashed — watching" : "Spectating", className: "g-muted" });
		parts.push({ key: "n", text: `${riders().filter((r) => r.alive).length} still riding`, className: "g-muted" });
	} else if (view.decided) {
		parts.push({ key: "s", text: view.winner === null ? "Everyone crashed" : view.winner === arcade.party?.self ? "You win" : `${nameOf(view.winner)} wins` });
	} else {
		parts.push({ key: "s", text: "Getting ready…", className: "g-muted" });
	}
	setHud(parts);
}

function render() {
	drawHeads();
	renderScores();
	renderHud();
	renderSetup();
	renderNext();
}

// ---------------------------------------------------------------- setup
//
// Friends' first round only (Lokesh, 2026-11-23, as Ludo): the host picks
// an open arena or OBSTACLES — a few blocks of wall, clear of every spawn's
// lane — and STARTs; everyone else sees what is picked. The arena behind
// shows the blocks as they are picked.

const optsText = (o) => (o.obstacles ? "obstacles" : "open arena");
let lastSetup = "";
function renderSetup() {
	const on = view?.phase === "setup";
	setup.hidden = !on;
	if (!on) return void (lastSetup = "");
	const host = arcade.isHost();
	const key = JSON.stringify([view.obstacles, host, arcade.party?.host]);
	if (key === lastSetup) return;
	lastSetup = key;
	const parts = [el("h2", null, "LIGHT CYCLES")];
	if (host) {
		parts.push(el("p", null, "Ride, leave a wall, do not touch one. Obstacles put a few blocks of wall on the arena."));
		parts.push(optionButtons(view.obstacles, (obstacles) => arcade.act({ obstacles })));
		const start = el("button", "neon-btn neon-btn--accent lc-start", "START");
		start.type = "button";
		start.onclick = () => arcade.act({ start: true });
		parts.push(start);
	} else {
		const hostName = arcade.party?.members?.find((p) => p.id === arcade.party?.host)?.name || "The host";
		parts.push(el("p", null, `${hostName} is setting up: ${optsText(view)}.`));
	}
	setup.replaceChildren(...parts);
}
/** OPEN ARENA / OBSTACLES, the one pressed showing which. */
function optionButtons(obstacles, pick) {
	const group = el("div", "lc-choice");
	group.setAttribute("role", "group");
	group.setAttribute("aria-label", "Arena");
	for (const [value, label] of [[false, "OPEN ARENA"], [true, "OBSTACLES"]]) {
		const btn = el("button", "neon-btn", label);
		btn.type = "button";
		btn.dataset.obstacles = String(value);
		btn.setAttribute("aria-pressed", String(obstacles === value));
		btn.onclick = () => pick(value);
		group.append(btn);
	}
	return group;
}

// ------------------------------------------------------------ next game
//
// At the end the host's phone says what PLAY AGAIN starts — "Next game:
// open arena · CHANGE" — above the shell's card (SEE THE BOARD tucks it to
// the bottom). The pick goes to the host's own rules, which are the live ones
// (the platform takes no moves after the end), and is kept on this phone.

let choosingNext = false;
function nextGame() {
	if (!view?.decided || view.phase !== "play" || !arcade.isHost()) return null;
	try {
		return rules.nextGame();
	} catch {
		return null;
	}
}
function keepOpts(o) {
	if (JSON.stringify(o) === JSON.stringify(lastOpts)) return;
	lastOpts = { ...o };
	arcade.send("store.set", { key: "opts", value: lastOpts });
}
let lastNext = "";
function renderNext() {
	const n = nextGame();
	if (!n) choosingNext = false;
	const key = JSON.stringify([n, choosingNext]);
	if (key === lastNext) return;
	lastNext = key;
	nextEl.hidden = !n;
	// The line came, went or opened: the arena takes what is left.
	queueMicrotask(layout);
	if (!n) return void nextEl.replaceChildren();
	const change = el("button", "neon-btn lc-next-change", choosingNext ? "DONE" : "CHANGE");
	change.type = "button";
	change.setAttribute("aria-label", choosingNext ? "Done choosing the next game" : "Change the next game's arena");
	change.onclick = () => {
		choosingNext = !choosingNext;
		render();
	};
	const what = el("span");
	what.append(document.createTextNode("Next game: "), el("b", null, optsText(n)));
	const line = el("div", "lc-next-line");
	line.append(what, change);
	if (!choosingNext) return void nextEl.replaceChildren(line);
	nextEl.replaceChildren(
		line,
		optionButtons(n.obstacles, (obstacles) => {
			if (rules.setNext({ obstacles }) !== undefined) return;
			keepOpts(rules.nextGame());
			render();
		}),
	);
}

/**
 * The host's view of one step. Every head it carries is painted into the
 * trails here, so the walls accumulate on this phone exactly as on the host;
 * a view with the whole grid (every tenth step, and between races) replaces
 * them, which is how a phone that came in late catches up.
 */
function onView(next) {
	if (next.round !== round) {
		round = next.round;
		lastStep = -1;
		grid = new Uint8Array(COLS * ROWS);
	}
	view = next;
	const cols = arcade.seatColors?.(next.riders.map((r) => r.id)) ?? [];
	const recoloured = cols.join() !== seatCols.join();
	seatCols = cols;
	// The options played, kept on the host's phone for its next one-person round.
	if (next.phase === "play" && arcade.isHost()) keepOpts({ obstacles: !!next.obstacles });
	if (next.grid) {
		grid = Uint8Array.from(next.grid, Number);
		repaintTrails();
	} else {
		// Someone picked another colour: every wall of theirs changes too.
		if (recoloured) repaintTrails();
		if (next.step !== lastStep) {
			next.riders.forEach((rider, i) => {
				if (!rider.alive) return;
				grid[idx(rider.c, rider.r)] = i + 1;
				paintCell(rider.c, rider.r, i);
			});
		}
	}
	lastStep = next.step;
	render();
}

// ------------------------------------------------------------------ input

/** Ask the host to face us a new way. It is free to refuse a reversal. */
function steerTo(dir) {
	const mine = me();
	if (!view?.racing || !mine?.alive) return;
	if (ORDER.indexOf(dir) === (ORDER.indexOf(mine.dir) + 2) % 4) return;
	arcade.input({ d: dir, n: ++seq, r: view.round });
}

function steerRelative(turn) {
	const mine = me();
	if (!mine) return;
	const i = ORDER.indexOf(mine.dir);
	steerTo(ORDER[(i + (turn === "left" ? 3 : 1)) % 4]);
}

const onZone = (turn) => (ev) => {
	ev.preventDefault();
	steerRelative(turn);
};
leftZone.addEventListener("pointerdown", onZone("left"));
rightZone.addEventListener("pointerdown", onZone("right"));

addEventListener("keydown", (ev) => {
	const map = { ArrowUp: "N", ArrowRight: "E", ArrowDown: "S", ArrowLeft: "W" };
	if (map[ev.key]) {
		ev.preventDefault();
		steerTo(map[ev.key]);
	} else if (ev.key === "a" || ev.key === "A") steerRelative("left");
	else if (ev.key === "d" || ev.key === "D") steerRelative("right");
});

// -------------------------------------------------------------------- go

addEventListener("resize", layout);
addEventListener("orientationchange", layout);
arcade.on("view", ({ state }) => onView(state));
arcade.on("roster", renderScores);
// A new theme: riders take its colours, trails are repainted.
arcade.on("theme.set", () => {
	repaintTrails();
	render();
});
arcade.init.then(() => {
	layout();
	render();
});

/** For the tests: the round as this phone sees it. */
arcade.debug = () => ({
	racing: !!view?.racing,
	countdown: view?.countdown ?? 0,
	winner: view?.decided ? view.winner : undefined,
	tickMs: view?.tickMs ?? 100,
	riders: riders().map((r) => ({ ...r })),
	colors: riders().map((_, i) => seatCols[i] ?? i % 8),
	patterns: riders().map((_, i) => patternOf(i)),
	walls: grid.reduce((n, v) => n + (v && v !== WALL ? 1 : 0), 0),
	blocks: grid.reduce((n, v) => n + (v === WALL ? 1 : 0), 0),
	phase: view?.phase ?? null,
	obstacles: !!view?.obstacles,
	mine: me()?.id ?? null,
});
