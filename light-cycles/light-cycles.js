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

const { COLS, ROWS, ORDER, idx } = lightCycleRules;

arcade.managed(lightCycleRules.game());

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
		font-size: 0.72rem; letter-spacing: 0.06em; }
	.lc-scores span { white-space: nowrap; }
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
arena.append(trailCanvas, headCanvas, zones);
const scores = el("div", "lc-scores");
fill.append(arena, scores);
stage.append(hud, fill);
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
// Riders wear the theme's player colours, resolved on this device, so a theme
// change recolours every trail.
const colorOf = (i) => arcade.theme?.players[i % 8] ?? "gray"; // theme-exempt: before the theme arrives
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
			if (owner) paintCell(c, r, colorOf(owner - 1));
		}
	}
}

function paintCell(c, r, color) {
	trail2d.fillStyle = color;
	trail2d.globalAlpha = 0.85;
	trail2d.fillRect(c * cellW, r * cellH, cellW, cellH);
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
	});
}

function renderScores() {
	const racing = !!view?.racing;
	scores.replaceChildren(
		...riders().map((rider, i) => {
			const s = el("span", null, `${nameOf(rider.id)} ${rider.wins}`);
			s.style.color = colorOf(i);
			s.style.opacity = rider.alive || !racing ? "1" : "0.4";
			return s;
		}),
	);
}

function renderHud() {
	const mine = me();
	const parts = [];
	if (!view) parts.push({ key: "s", text: "Getting ready…", className: "g-muted" });
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
	if (next.grid) {
		grid = Uint8Array.from(next.grid, Number);
		repaintTrails();
	} else if (next.step !== lastStep) {
		next.riders.forEach((rider, i) => {
			if (!rider.alive) return;
			grid[idx(rider.c, rider.r)] = i + 1;
			paintCell(rider.c, rider.r, colorOf(i));
		});
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
	walls: grid.reduce((n, v) => n + (v ? 1 : 0), 0),
	mine: me()?.id ?? null,
});
