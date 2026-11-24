// five-in-a-row/five-in-a-row.js — Five in a Row. An SDK v2 managed game.
//
// The rules are five-in-a-row-rules.js `game()`: the platform runs them on
// the host, sends each phone its view, plays bot seats with `bot()`, shows
// the turn-wait banner, reports the result, draws the end card with PLAY
// AGAIN and hands the board to the heir if the host leaves. This file is the
// board: a canvas with no edges, looked around by dragging and pinching (a
// mouse drags and wheels), and a tap that places a mark.
//
// ## Placing on a board you can zoom
//
// A cell is 44px at the start, a thumb's width. Zoomed out past CONFIRM_PX a
// cell is too small to hit for sure, so the first tap only shows the mark
// (a ghost) and a second tap on the same cell places it; a tap elsewhere
// moves the ghost. Every cell a mark may go on is dotted on your turn, and a
// tap on any other is answered here, at once, without asking the host.
//
// Seats wear the theme's player colours, each its player's pick (the
// platform's seat colours, as on the end card; seat order on an older shell),
// each with its own shape too — ring, cross, triangle, diamond — so the
// marks read without colour, whatever colours are picked.

const R = fiveInARowRules;
arcade.managed(R.game());

const style = document.createElement("style");
style.textContent = `
	.g-stage { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 6px;
		padding: calc(env(safe-area-inset-top) + 52px) max(8px, env(safe-area-inset-right))
			max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); box-sizing: border-box; }
	.g-hud { display: flex; flex-direction: column; align-items: center; gap: 4px; text-align: center; }
	.fr-status { font-size: clamp(0.9rem, 3.4vw, 1.15rem); color: var(--accent); text-shadow: 0 0 8px var(--accent-glow); min-height: 1.4em; }
	.fr-seats { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; font-size: 0.8rem; color: var(--muted); }
	.fr-seat { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; max-width: 44vw; overflow: hidden; text-overflow: ellipsis; }
	.fr-seat svg { flex: none; width: 14px; height: 14px; }
	.fr-seat.on { color: var(--ink); font-weight: 600; }
	.fr-seat.out { opacity: 0.55; text-decoration: line-through; }
	.fr-board { position: relative; flex: 1 1 auto; min-height: 0; border: 2px solid var(--rule); border-radius: 12px;
		overflow: hidden; background: var(--surface); box-shadow: 0 0 24px var(--glow); }
	.fr-board canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; cursor: crosshair; }
	.fr-board canvas.dragging { cursor: grabbing; }
	.fr-board canvas:focus-visible { outline: 3px solid var(--accent); outline-offset: -3px; }
	.fr-tools { position: absolute; right: 8px; bottom: 8px; display: flex; gap: 8px; }
	.fr-tools button { width: 44px; height: 44px; padding: 0; border-radius: 12px; border: 1px solid var(--border);
		background: color-mix(in srgb, var(--panel) 88%, transparent); color: var(--ink); font: inherit; font-size: 1.25rem;
		line-height: 1; cursor: pointer; display: grid; place-items: center; }
	.fr-tools button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
	.fr-hint { font-size: 0.8rem; color: var(--muted); text-align: center; min-height: 1.3em; }
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
const statusEl = el("div", "fr-status");
statusEl.setAttribute("role", "status");
statusEl.setAttribute("aria-live", "polite");
const seatsEl = el("div", "fr-seats");
hud.append(statusEl, seatsEl);
const board = el("div", "fr-board");
const canvas = el("canvas");
canvas.setAttribute("aria-label", "The board: drag or pinch to look around, tap to place. Arrow keys move the cursor, Enter places.");
canvas.tabIndex = 0;
const tools = el("div", "fr-tools");
const zoomOut = el("button", "", "−");
zoomOut.setAttribute("aria-label", "Zoom out");
const zoomIn = el("button", "", "+");
zoomIn.setAttribute("aria-label", "Zoom in");
const fitBtn = el("button", "", "◎");
fitBtn.setAttribute("aria-label", "Show every mark");
tools.append(zoomOut, zoomIn, fitBtn);
board.append(canvas, tools);
const hint = el("div", "fr-hint");
hint.setAttribute("aria-live", "polite");
stage.append(hud, board, hint);
document.body.append(stage);
const c2d = canvas.getContext("2d");

// ------------------------------------------------------------------ state

const START_PX = 44; // a cell at the start: a thumb
const MIN_PX = 14;
const MAX_PX = 96;
const CONFIRM_PX = 32; // under this, a tap shows the mark and a second places it
const POP_MS = 170; // a new mark grows in
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

let view = null;
let marks = new Map(); // "x,y" → seat
let legalNow = []; // [[x, y]…] on this phone's turn, else []
let cam = { x: 0, y: 0, z: START_PX }; // the view's centre in cells, and px per cell
let size = { w: 300, h: 300, dpr: 1 };
let pending = null; // [x, y]: the ghost waiting for a second tap
let hover = null; // [x, y] under the mouse
let cursor = null; // [x, y]: the keyboard's cell
let pop = null; // { x, y, t0 } while a new mark grows
let glide = null; // { from, to, t0, ms } while the camera follows a move
// The camera is the player's while they move it: no following a new mark
// while a finger is down, nor for HANDS_OFF_MS after a pan or a zoom. A win
// is framed all the same: the game is over.
const HANDS_OFF_MS = 2000;
let handled = -Infinity; // when the player last panned or zoomed
const handsOn = () => pointers.size > 0 || performance.now() - handled < HANDS_OFF_MS;
let blurs = 0; // glowing draws in the last frame, for the tests (marks come from sprites)
let raf = 0;
let drawn = 0; // frames painted, for the tests

const theme = () => arcade.theme;
// Each seat's colour, an index into the theme's players: its player's pick,
// no two alike (sdk/v2/runtime.js seatColors), set on every view.
let seatCols = [];
const colourOf = (seat) => theme()?.players[seatCols[seat] ?? seat % 8] ?? "gray"; // theme-exempt: before the theme arrives
const glows = () => !/,\s*0\)$/.test(theme()?.tokens.glow ?? ", 0)");
/** "rgba(r, g, b, a)" with its alpha replaced. */
const alpha = (rgba, a) => String(rgba).replace(/,\s*[\d.]+\)$/, `, ${a})`);
const nameOf = (id, seat) => {
	const m = arcade.party?.members?.find((p) => p.id === id);
	return m?.name || `Player ${seat + 1}`;
};
const myTurn = () => !!view && view.winner === null && view.you >= 0 && view.turn === view.you && !view.out[view.you];
const SHAPES = ["ring", "cross", "triangle", "diamond"];

// --------------------------------------------------------------- the camera

const toScreen = (x, y) => [size.w / 2 + (x - cam.x) * cam.z, size.h / 2 + (y - cam.y) * cam.z];
const toCell = (sx, sy) => [Math.round(cam.x + (sx - size.w / 2) / cam.z), Math.round(cam.y + (sy - size.h / 2) / cam.z)];
/** A point in CSS px inside the canvas, from a client point. */
function local(clientX, clientY) {
	const r = canvas.getBoundingClientRect();
	return [clientX - r.left, clientY - r.top];
}
/** Zoom by `k` keeping the board point under (sx, sy) where it is. */
function zoomAt(k, sx = size.w / 2, sy = size.h / 2) {
	const z = Math.min(MAX_PX, Math.max(MIN_PX, cam.z * k));
	const wx = cam.x + (sx - size.w / 2) / cam.z;
	const wy = cam.y + (sy - size.h / 2) / cam.z;
	cam = { x: wx - (sx - size.w / 2) / z, y: wy - (sy - size.h / 2) / z, z };
	glide = null;
	handled = performance.now();
	if (cam.z >= CONFIRM_PX) pending = null;
	paint();
}
/** Every mark in view (the centre on an empty board), at a zoom no bigger than the start's. */
function fitAll(animate = true) {
	const list = view?.marks?.length ? view.marks : [[0, 0]];
	const xs = list.map((m) => m[0]);
	const ys = list.map((m) => m[1]);
	const [x0, x1, y0, y1] = [Math.min(...xs) - 1.5, Math.max(...xs) + 1.5, Math.min(...ys) - 1.5, Math.max(...ys) + 1.5];
	const z = Math.min(START_PX, Math.max(MIN_PX, Math.min(size.w / (x1 - x0), (size.h - 56) / (y1 - y0))));
	moveTo({ x: (x0 + x1) / 2, y: (y0 + y1) / 2, z }, animate);
}
function moveTo(to, animate = true) {
	if (!animate || reduced.matches) {
		cam = to;
		glide = null;
	} else glide = { from: { ...cam }, to, t0: performance.now(), ms: 260 };
	paint();
}
/**
 * Keep the newest mark in view: glide to it only if it is near or past the
 * edge, and never while the player is moving the board (`force`: the
 * keyboard's own cursor).
 */
function follow(x, y, force = false) {
	if (!force && handsOn()) return;
	const [sx, sy] = toScreen(x, y);
	const m = cam.z * 1.2;
	if (sx < m || sy < m || sx > size.w - m || sy > size.h - m - 52) moveTo({ x, y, z: cam.z });
}

// ------------------------------------------------------------- the drawing

function resize() {
	const r = board.getBoundingClientRect();
	const w = Math.max(100, Math.floor(r.width - 4));
	const h = Math.max(100, Math.floor(r.height - 4));
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	size = { w, h, dpr };
	canvas.width = Math.round(w * dpr);
	canvas.height = Math.round(h * dpr);
	paint();
}

function paint() {
	if (!raf) raf = requestAnimationFrame(frame);
}

function frame(now) {
	raf = 0;
	const t = theme();
	if (!t) return;
	const { tokens } = t;
	if (glide) {
		const p = Math.min(1, (now - glide.t0) / glide.ms);
		const e = 1 - (1 - p) * (1 - p);
		cam = { x: glide.from.x + (glide.to.x - glide.from.x) * e, y: glide.from.y + (glide.to.y - glide.from.y) * e, z: glide.from.z + (glide.to.z - glide.from.z) * e };
		if (p >= 1) glide = null;
	}
	const { w, h, dpr } = size;
	blurs = 0;
	c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
	c2d.fillStyle = tokens.surface;
	c2d.fillRect(0, 0, w, h);
	const z = cam.z;

	// The grid: lines between cells, a little stronger every fifth, so a line
	// of five is easy to count.
	const [cx0, cy0] = toCell(0, 0);
	const [cx1, cy1] = toCell(w, h);
	c2d.lineWidth = 1;
	const fifth = alpha(tokens.ink3, 0.45);
	for (let x = cx0 - 1; x <= cx1 + 1; x++) {
		const sx = Math.round(toScreen(x + 0.5, 0)[0]) + 0.5;
		c2d.strokeStyle = (x + 1) % 5 === 0 ? fifth : tokens.rule;
		c2d.beginPath();
		c2d.moveTo(sx, 0);
		c2d.lineTo(sx, h);
		c2d.stroke();
	}
	for (let y = cy0 - 1; y <= cy1 + 1; y++) {
		const sy = Math.round(toScreen(0, y + 0.5)[1]) + 0.5;
		c2d.strokeStyle = (y + 1) % 5 === 0 ? fifth : tokens.rule;
		c2d.beginPath();
		c2d.moveTo(0, sy);
		c2d.lineTo(w, sy);
		c2d.stroke();
	}
	const inView = (x, y) => x >= cx0 - 1 && x <= cx1 + 1 && y >= cy0 - 1 && y <= cy1 + 1;

	// Where a mark may go: a dot in each cell, on this phone's turn.
	if (legalNow.length) {
		c2d.fillStyle = alpha(tokens.accent, 0.45);
		const r = Math.max(1.5, z * 0.07);
		for (const [x, y] of legalNow) {
			if (!inView(x, y)) continue;
			const [sx, sy] = toScreen(x, y);
			c2d.beginPath();
			c2d.arc(sx, sy, r, 0, Math.PI * 2);
			c2d.fill();
		}
	}

	// The marks.
	const popP = pop ? Math.min(1, (now - pop.t0) / POP_MS) : 1;
	for (const [k, seat] of marks) {
		const [x, y] = k.split(",").map(Number);
		if (!inView(x, y)) continue;
		const grow = pop && pop.x === x && pop.y === y ? 0.4 + 0.6 * popP : 1;
		drawMark(x, y, seat, grow, 1);
	}
	if (pop && popP >= 1) {
		pop = null;
		arcade.idle?.();
	}

	// The ghost: the keyboard's cursor, the pending tap, or the mouse.
	const me = view?.you ?? -1;
	if (myTurn()) {
		const ghost = pending ?? hover;
		if (ghost && !marks.has(R.key(ghost[0], ghost[1]))) drawMark(ghost[0], ghost[1], me, 1, pending ? 0.55 + 0.25 * Math.sin(now / 160) : 0.35);
	}
	if (cursor) {
		const [sx, sy] = toScreen(cursor[0], cursor[1]);
		c2d.strokeStyle = tokens.accent;
		c2d.lineWidth = 2;
		c2d.strokeRect(sx - z / 2 + 2, sy - z / 2 + 2, z - 4, z - 4);
	}

	// The last mark: an accent ring round its cell.
	if (view?.last) {
		const [sx, sy] = toScreen(view.last[0], view.last[1]);
		c2d.strokeStyle = tokens.accent;
		c2d.lineWidth = Math.max(1.5, z * 0.05);
		c2d.shadowBlur = glows() ? 8 * dpr : 0;
		c2d.shadowColor = tokens.accent;
		c2d.beginPath();
		c2d.arc(sx, sy, z * 0.48, 0, Math.PI * 2);
		c2d.stroke();
		c2d.shadowBlur = 0;
	}

	// The winning line, end to end.
	if (view?.line && view.winner >= 0) {
		const a = toScreen(...view.line[0]);
		const b = toScreen(...view.line[view.line.length - 1]);
		c2d.lineCap = "round";
		c2d.shadowBlur = glows() ? 18 * dpr : 0;
		c2d.shadowColor = colourOf(view.winner);
		c2d.strokeStyle = alpha(colourOf(view.winner), 0.85);
		c2d.lineWidth = Math.max(3, z * 0.16);
		c2d.beginPath();
		c2d.moveTo(a[0], a[1]);
		c2d.lineTo(b[0], b[1]);
		c2d.stroke();
		c2d.shadowBlur = 0;
		c2d.strokeStyle = tokens.ink;
		c2d.lineWidth = Math.max(1, z * 0.04);
		c2d.stroke();
		c2d.lineCap = "butt";
	}
	drawn++;
	if (glide || pop || pending) paint();
}

/** Seat `seat`'s shape as a path on `g`, centred on (sx, sy), r its size. */
function shapePath(g, seat, sx, sy, r) {
	g.beginPath();
	switch (SHAPES[seat % SHAPES.length]) {
		case "ring":
			g.arc(sx, sy, r, 0, Math.PI * 2);
			break;
		case "cross":
			g.moveTo(sx - r, sy - r);
			g.lineTo(sx + r, sy + r);
			g.moveTo(sx + r, sy - r);
			g.lineTo(sx - r, sy + r);
			break;
		case "triangle":
			g.moveTo(sx, sy - r * 1.1);
			g.lineTo(sx + r * 1.05, sy + r * 0.8);
			g.lineTo(sx - r * 1.05, sy + r * 0.8);
			g.closePath();
			break;
		default:
			g.moveTo(sx, sy - r * 1.1);
			g.lineTo(sx + r * 1.1, sy);
			g.lineTo(sx, sy + r * 1.1);
			g.lineTo(sx - r * 1.1, sy);
			g.closePath();
	}
}

/** Paint seat `seat`'s mark on `g` at (sx, sy) in its units, r its size, `px` backing pixels per unit. */
function paintMark(g, seat, sx, sy, r, px) {
	const colour = colourOf(seat);
	g.strokeStyle = colour;
	g.fillStyle = alpha(colour, 0.18);
	g.lineWidth = Math.max(2, cam.z * 0.1);
	g.lineJoin = "round";
	g.lineCap = "round";
	const glow = glows();
	g.shadowBlur = glow ? 10 * px : 0; // backing px: shadowBlur ignores the transform
	g.shadowColor = colour;
	if (glow) blurs++;
	shapePath(g, seat, sx, sy, r);
	if (SHAPES[seat % SHAPES.length] !== "cross") g.fill();
	g.stroke();
	g.shadowBlur = 0;
}

// A glowing blur is the dearest thing a canvas draws: zoomed out with 500
// marks at DPR 3 it cost about 52 ms a frame (review, 2026-11-23). So each
// seat's mark is painted once per zoom, theme and pixel ratio into a sprite,
// and the board stamps sprites.
const sprites = new Map(); // key → canvas
function spriteOf(seat) {
	const t = theme();
	const key = `${seat}:${cam.z.toFixed(2)}:${size.dpr}:${t?.name}:${t?.mode}:${colourOf(seat)}:${glows()}`;
	let sp = sprites.get(key);
	if (sp) return sp;
	if (sprites.size > 48) sprites.clear(); // a pinch walks through many zooms
	const r = cam.z * 0.34;
	const half = Math.ceil((r * 1.2 + Math.max(2, cam.z * 0.1)) * size.dpr + (glows() ? 22 * size.dpr : 2));
	sp = document.createElement("canvas");
	sp.width = sp.height = half * 2;
	const g = sp.getContext("2d");
	g.setTransform(size.dpr, 0, 0, size.dpr, 0, 0);
	paintMark(g, seat, half / size.dpr, half / size.dpr, r, size.dpr);
	sprites.set(key, sp);
	return sp;
}

/** Seat `seat`'s mark at (x, y): its colour and its shape, `grow` of full size, at opacity `a`. */
function drawMark(x, y, seat, grow, a) {
	const [sx, sy] = toScreen(x, y);
	if (grow === 1 && a === 1) {
		const sp = spriteOf(seat);
		const w = sp.width / size.dpr;
		c2d.drawImage(sp, sx - w / 2, sy - w / 2, w, w);
		return;
	}
	// Growing in, or a ghost: drawn as it is, once.
	c2d.save();
	c2d.globalAlpha = a;
	paintMark(c2d, seat, sx, sy, cam.z * 0.34 * grow, size.dpr);
	c2d.restore();
}

/** A seat's shape as a small SVG, for the seat list. */
function shapeIcon(seat) {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 14 14");
	svg.setAttribute("aria-hidden", "true");
	const shape = SHAPES[seat % SHAPES.length];
	const node = document.createElementNS(ns, shape === "ring" ? "circle" : "path");
	if (shape === "ring") {
		node.setAttribute("cx", "7");
		node.setAttribute("cy", "7");
		node.setAttribute("r", "5");
	} else node.setAttribute("d", shape === "cross" ? "M2 2L12 12M12 2L2 12" : shape === "triangle" ? "M7 1.5L12.5 12H1.5Z" : "M7 1L13 7L7 13L1 7Z");
	node.setAttribute("fill", "none");
	node.setAttribute("stroke", colourOf(seat));
	node.setAttribute("stroke-width", "2.2");
	node.setAttribute("stroke-linejoin", "round");
	node.setAttribute("stroke-linecap", "round");
	svg.append(node);
	return svg;
}

function renderHud() {
	if (!view) return;
	const me = view.you;
	let text;
	if (view.winner !== null) {
		if (view.winner < 0) text = "A DRAW";
		else text = view.winner === me ? "YOU WIN!" : `${nameOf(view.seats[view.winner], view.winner)} WINS`;
	} else if (myTurn()) text = view.marks.length ? "YOUR TURN" : "YOUR TURN — the centre first";
	else text = `${nameOf(view.seats[view.turn], view.turn)}'s turn`;
	if (statusEl.textContent !== text) statusEl.textContent = text;
	seatsEl.replaceChildren(
		...view.seats.map((id, i) => {
			const chip = el("span", `fr-seat${i === view.turn && view.winner === null ? " on" : ""}${view.out[i] ? " out" : ""}`);
			chip.append(shapeIcon(i), document.createTextNode(i === me ? "You" : nameOf(id, i)));
			return chip;
		}),
	);
}

function say(text) {
	if (hint.textContent !== text) hint.textContent = text;
}

// ---------------------------------------------------------------- placing

function place(x, y) {
	if (!view || view.winner !== null) return;
	if (!myTurn()) return say(view.you >= 0 ? "Not your turn yet" : "You are watching");
	const b = marks;
	if (!R.legal(b, x, y)) {
		pending = null;
		paint();
		return say(!b.size ? "The first mark goes in the centre" : b.has(R.key(x, y)) ? "That cell is taken" : "Place it next to a mark");
	}
	if (cam.z < CONFIRM_PX && !(pending && pending[0] === x && pending[1] === y)) {
		pending = [x, y];
		paint();
		return say("Tap again to place it there");
	}
	pending = null;
	say("");
	arcade.act({ x, y });
}

// Pointers: one drags the board, two pinch it; a short touch that hardly
// moved is a tap.
const pointers = new Map(); // id → { x, y, x0, y0, t0 }
let dragged = false;
let pinch = null; // { d, mx, my }
const SLOP = 8; // px a tap may wander

canvas.addEventListener("pointerdown", (e) => {
	try {
		canvas.setPointerCapture(e.pointerId); // a drag that leaves the board keeps dragging it
	} catch {}
	const [x, y] = local(e.clientX, e.clientY);
	pointers.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now() });
	if (pointers.size === 1) dragged = false;
	if (pointers.size === 2) {
		const [a, b] = [...pointers.values()];
		pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
		dragged = true;
	}
	glide = null;
});
canvas.addEventListener("pointermove", (e) => {
	const [x, y] = local(e.clientX, e.clientY);
	const p = pointers.get(e.pointerId);
	if (!p) {
		if (e.pointerType === "mouse") {
			const c = toCell(x, y);
			if (!hover || hover[0] !== c[0] || hover[1] !== c[1]) {
				hover = c;
				paint();
			}
		}
		return;
	}
	const [dx, dy] = [x - p.x, y - p.y];
	p.x = x;
	p.y = y;
	if (pointers.size === 1) {
		if (!dragged && Math.hypot(x - p.x0, y - p.y0) > SLOP) {
			dragged = true;
			canvas.classList.add("dragging");
		}
		if (dragged) {
			cam = { ...cam, x: cam.x - dx / cam.z, y: cam.y - dy / cam.z };
			handled = performance.now();
			paint();
		}
	} else if (pointers.size === 2 && pinch) {
		const [a, b] = [...pointers.values()];
		const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
		const mx = (a.x + b.x) / 2;
		const my = (a.y + b.y) / 2;
		cam = { ...cam, x: cam.x - (mx - pinch.mx) / cam.z, y: cam.y - (my - pinch.my) / cam.z };
		zoomAt(d / pinch.d, mx, my);
		pinch = { d, mx, my };
	}
});
function lift(e, cancelled) {
	const p = pointers.get(e.pointerId);
	if (!p) return;
	pointers.delete(e.pointerId);
	if (pointers.size < 2) pinch = null;
	if (!pointers.size) canvas.classList.remove("dragging");
	if (cancelled || dragged || pointers.size) return;
	if (e.pointerType === "mouse" && e.button !== 0) return;
	const [x, y] = toCell(p.x, p.y);
	place(x, y);
}
canvas.addEventListener("pointerup", (e) => lift(e, false));
canvas.addEventListener("pointercancel", (e) => lift(e, true));
canvas.addEventListener("pointerleave", (e) => {
	if (e.pointerType === "mouse" && hover) {
		hover = null;
		paint();
	}
});
canvas.addEventListener(
	"wheel",
	(e) => {
		e.preventDefault();
		const [x, y] = local(e.clientX, e.clientY);
		if (e.ctrlKey || Math.abs(e.deltaY) >= Math.abs(e.deltaX)) zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), x, y);
		else {
			cam = { ...cam, x: cam.x + e.deltaX / cam.z };
			handled = performance.now();
			paint();
		}
	},
	{ passive: false },
);
zoomIn.addEventListener("click", () => zoomAt(1.25));
zoomOut.addEventListener("click", () => zoomAt(0.8));
fitBtn.addEventListener("click", () => fitAll());

// The keyboard: arrows move a cursor (the board follows), Enter or Space
// places, + and − zoom, 0 shows every mark.
canvas.addEventListener("keydown", (e) => {
	const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
	if (step) {
		e.preventDefault();
		cursor = cursor ?? (view?.last ? [...view.last] : [0, 0]);
		cursor = [cursor[0] + step[0], cursor[1] + step[1]];
		follow(cursor[0], cursor[1], true);
		paint();
	} else if (e.key === "Enter" || e.key === " ") {
		e.preventDefault();
		if (!cursor) {
			// Nothing chosen yet: show where the cursor is, place nothing.
			showCursor();
			return say("Arrow keys move the cursor · Enter places");
		}
		pending = cam.z < CONFIRM_PX ? cursor : null;
		place(cursor[0], cursor[1]);
	} else if (e.key === "+" || e.key === "=") zoomAt(1.25);
	else if (e.key === "-") zoomAt(0.8);
	else if (e.key === "0") fitAll();
});

/** The keyboard's cursor, on the last mark (the centre on an empty board), in view. */
function showCursor() {
	cursor = cursor ?? (view?.last ? [...view.last] : [0, 0]);
	follow(cursor[0], cursor[1], true);
	paint();
}
// Focus from the keyboard shows the cursor; a tap that focuses does not.
canvas.addEventListener("focus", () => {
	if (canvas.matches(":focus-visible")) showCursor();
});
canvas.addEventListener("blur", () => {
	cursor = null;
	paint();
});

// -------------------------------------------------------------- the views

/** A view from the host (named, so a test can hand it one). */
function onView({ state }) {
	const before = view;
	view = state;
	seatCols = arcade.seatColors?.(state.seats ?? []) ?? [];
	marks = R.boardOf(state.marks);
	legalNow = myTurn() ? R.legalCells(marks) : [];
	if (pending && !legalNow.some(([x, y]) => x === pending[0] && y === pending[1])) pending = null;
	const fresh = before && before.match === state.match && state.moves === before.moves + 1 && state.last;
	if (!before || before.match !== state.match) {
		// A new match (or the first view): the centre, at the start's zoom.
		cam = { x: 0, y: 0, z: START_PX };
		glide = null;
		cursor = null;
		pending = null;
		say(state.you >= 0 ? "Drag to look around · pinch or use + − to zoom" : "");
		if (state.marks.length > 1) fitAll(false);
	}
	if (fresh) {
		const [x, y] = state.last;
		follow(x, y);
		const seat = marks.get(R.key(x, y));
		say(seat === state.you ? "" : `${nameOf(state.seats[seat], seat)} placed a mark`);
		if (!reduced.matches) pop = { x, y, t0: performance.now() };
	}
	if (state.winner !== null && before?.winner === null && state.line && state.winner >= 0) {
		// Show the whole winning line.
		const xs = state.line.map((c) => c[0]);
		const ys = state.line.map((c) => c[1]);
		const mid = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
		const need = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + 2;
		// Always: the game is over, so the camera is no longer the player's
		// (holding off for a recent pan left a win off screen for good). With
		// a finger still down it jumps rather than glides, so the drag goes on
		// from the framed board.
		moveTo({ ...mid, z: Math.min(cam.z, Math.max(MIN_PX, Math.min(size.w, size.h - 56) / need)) }, !pointers.size);
	}
	if (!pop) arcade.idle?.();
	renderHud();
	paint();
}
arcade.on("view", onView);

arcade.on("rejected", (m) => say(m.reason));
arcade.on("roster", renderHud);
arcade.on("theme.set", () => {
	sprites.clear();
	renderHud();
	paint();
});
addEventListener("resize", resize);
new ResizeObserver(resize).observe(board);
arcade.init.then(resize);

/**
 * For the tests: the view, plus the camera (`cam`: centre in cells, px per
 * cell), the canvas's box in the frame (`box`), the cells a mark may take
 * now (`legal`), the ghost (`pending`) and frames painted.
 */
arcade.debug = () => {
	const r = canvas.getBoundingClientRect();
	return {
		...(view ?? { marks: [], seats: [], winner: null }),
		colors: (view?.seats ?? []).map((_, i) => seatCols[i] ?? i % 8),
		shapes: (view?.seats ?? []).map((_, i) => SHAPES[i % SHAPES.length]),
		cam: { ...cam },
		box: { left: r.left, top: r.top, w: size.w, h: size.h },
		legal: legalNow.map((c) => [...c]),
		myTurn: myTurn(),
		pending,
		cursor,
		drawn,
		blurs,
		focused: document.activeElement === canvas,
	};
};
