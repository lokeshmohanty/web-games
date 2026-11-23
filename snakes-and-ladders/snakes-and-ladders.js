// snakes-and-ladders/snakes-and-ladders.js — Snakes & Ladders. An SDK v2
// managed game.
//
// The rules are snakes-and-ladders-rules.js `game()`: the platform runs them
// on the host (the die is rolled there), sends each phone its view, rolls
// for bot seats, shows the turn-wait banner, reports the result, draws the
// end card with PLAY AGAIN and hands the game to the heir if the host leaves.
// This file is the board and the die.
//
// ## Never a long wait
//
// Your tap on the die starts it tumbling at once, before the host has
// answered; the host's roll lands it. A move then plays out — the die
// settles (ROLL_MS), the token hops square by square (HOP_MS each), and
// slides up a ladder or down a snake (SLIDE_MS) — about a second for an
// ordinary move. Moves that arrive while one is playing wait their turn, at
// double speed, so the board never falls behind. There is nothing to choose
// once the die is rolled (one token, one move), so the move is made for you.
// Under reduced motion nothing animates.
//
// The art is drawn here from the theme: squares from the surfaces, ladders in
// the theme's "good", snakes in its "danger", "warn" and second accent, tokens
// in the player colours (the end card's --p1…).

const SL = snakesAndLaddersRules;
// A bot rolls once the last move has had time to play: the platform's own
// pause (0.6–1.1 s) plus BOT_PACE_MS, so a table of bots moves at the pace
// of its animation rather than racing ahead of it (a bot's move may be a
// promise: docs/sdk-v2.md "Managed state").
const BOT_PACE_MS = 900;
const rules = SL.game();
arcade.managed({ ...rules, bot: (call) => new Promise((done) => setTimeout(() => done(rules.bot(call)), BOT_PACE_MS)) });

const style = document.createElement("style");
style.textContent = `
	.g-stage { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
		padding: calc(env(safe-area-inset-top) + 52px) max(8px, env(safe-area-inset-right))
			max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); box-sizing: border-box; }
	.sl-status { font-size: clamp(0.9rem, 3.4vw, 1.15rem); color: var(--accent); text-shadow: 0 0 8px var(--accent-glow);
		min-height: 1.4em; text-align: center; }
	.sl-players { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; font-size: 0.8rem; color: var(--muted); }
	.sl-player { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
	.sl-player svg { width: 16px; height: 16px; flex: none; }
	.sl-player b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
	.sl-player.on { color: var(--ink); }
	.sl-player.on svg { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 50%; }
	.sl-player.out { opacity: 0.55; text-decoration: line-through; }
	.sl-fill { flex: none; display: flex; align-items: center; justify-content: center; }
	.sl-board { display: block; border: 2px solid var(--rule); border-radius: 10px; box-shadow: 0 0 24px var(--glow); }
	.sl-bar { display: flex; align-items: center; justify-content: center; gap: 14px; width: 100%; max-width: 520px; min-height: 76px; }
	.sl-die { width: 68px; height: 68px; flex: none; padding: 9px; border-radius: 14px; border: 2px solid var(--border);
		background: var(--panel); display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); cursor: pointer;
		box-sizing: border-box; transition: transform 0.12s; }
	.sl-die span { align-self: center; justify-self: center; width: 10px; height: 10px; border-radius: 50%; background: var(--ink); visibility: hidden; }
	.sl-die span.on { visibility: visible; }
	.sl-die.mine { border-color: var(--accent); box-shadow: 0 0 16px var(--accent-glow); animation: sl-ready 1.2s ease-in-out infinite; }
	.sl-die.tumbling { animation: sl-tumble 0.18s linear infinite; }
	.sl-die:disabled { cursor: default; opacity: 0.85; }
	.sl-die:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
	@keyframes sl-ready { 50% { box-shadow: 0 0 26px var(--accent-glow), 0 0 0 3px var(--accent-glow); } }
	@keyframes sl-tumble { 0% { transform: rotate(0deg); } 50% { transform: rotate(14deg) scale(0.94); } 100% { transform: rotate(0deg); } }
	@media (prefers-reduced-motion: reduce) { .sl-die.mine, .sl-die.tumbling { animation: none; } }
	.sl-said { flex: 1 1 auto; min-width: 0; font-size: 0.85rem; color: var(--ink); line-height: 1.35; }
	.sl-said small { display: block; color: var(--muted); font-size: 0.8rem; }
`;
document.head.append(style);

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
};

const stage = el("div", "g-stage");
const statusEl = el("div", "sl-status");
statusEl.setAttribute("role", "status");
const playersEl = el("div", "sl-players");
const fill = el("div", "sl-fill");
const canvas = el("canvas", "sl-board");
canvas.setAttribute("role", "img");
fill.append(canvas);
const bar = el("div", "sl-bar");
const die = el("button", "sl-die");
die.type = "button";
const pips = Array.from({ length: 9 }, () => el("span"));
die.append(...pips);
const said = el("div", "sl-said");
said.setAttribute("aria-live", "polite");
bar.append(die, said);
stage.append(statusEl, playersEl, fill, bar);
document.body.append(stage);
const c2d = canvas.getContext("2d");

// ------------------------------------------------------------------ state

const ROLL_MS = 420; // the die settles
const HOP_MS = 105; // one square
const SLIDE_MS = 480; // up a ladder, down a snake
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
const FACES = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

let view = null;
let shown = []; // each seat's square as drawn (lags the view while moves play)
let shownN = 0; // the last roll drawn (view.last.n)
let queue = []; // moves waiting to be drawn
let anim = null; // { move, t0, speed, phase } while one plays
let tumbling = false; // our tap is on its way to the host
let face = 1;
let cell = 30;
let dpr = 1;
let layer = null; // the board without tokens, drawn once per board, size and theme
let layerKey = "";
let raf = 0;
let moves = 0; // moves drawn, for the tests

const theme = () => arcade.theme;
const colourOf = (seat) => theme()?.players[seat % 8] ?? "gray"; // theme-exempt: before the theme arrives
const glows = () => !/,\s*0\)$/.test(theme()?.tokens.glow ?? ", 0)");
const alpha = (rgba, a) => String(rgba).replace(/,\s*[\d.]+\)$/, `, ${a})`);
const nameOf = (seat) => {
	const id = view?.seats[seat];
	return arcade.party?.members?.find((p) => p.id === id)?.name || `Player ${seat + 1}`;
};
const myTurn = () => !!view && !view.over && view.you >= 0 && view.turn === view.you && !view.out[view.you];
const ordinal = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;

// Each seat's token carries a mark as well as its colour (Five in a Row's
// four, and two more), the same mark beside its name, so tokens read without
// colour and apart from the snakes, which share the hues.
const GLYPHS = ["ring", "cross", "triangle", "diamond", "square", "star"];
const glyphOf = (seat) => GLYPHS[seat % GLYPHS.length];
/** The mark's path, centred on (x, y), r its half size; `stroke` draws it as lines. */
function glyphPath(g, glyph, x, y, r) {
	g.beginPath();
	if (glyph === "ring") g.arc(x, y, r * 0.8, 0, Math.PI * 2);
	else if (glyph === "cross") {
		g.moveTo(x - r * 0.7, y - r * 0.7);
		g.lineTo(x + r * 0.7, y + r * 0.7);
		g.moveTo(x + r * 0.7, y - r * 0.7);
		g.lineTo(x - r * 0.7, y + r * 0.7);
	} else if (glyph === "triangle") {
		g.moveTo(x, y - r);
		g.lineTo(x + r * 0.95, y + r * 0.7);
		g.lineTo(x - r * 0.95, y + r * 0.7);
		g.closePath();
	} else if (glyph === "diamond") {
		g.moveTo(x, y - r);
		g.lineTo(x + r, y);
		g.lineTo(x, y + r);
		g.lineTo(x - r, y);
		g.closePath();
	} else if (glyph === "square") g.rect(x - r * 0.72, y - r * 0.72, r * 1.44, r * 1.44);
	else
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
			const k = i % 2 ? r * 0.45 : r;
			g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * k, y + Math.sin(a) * k);
		}
	if (glyph === "star") g.closePath();
}
/** A seat's token as a small SVG, for its chip. */
function tokenIcon(seat) {
	const ns = "http://www.w3.org/2000/svg";
	const svg = document.createElementNS(ns, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.dataset.glyph = glyphOf(seat);
	const disc = document.createElementNS(ns, "circle");
	disc.setAttribute("cx", "8");
	disc.setAttribute("cy", "8");
	disc.setAttribute("r", "7.5");
	disc.setAttribute("fill", colourOf(seat));
	const mark = document.createElementNS(ns, "path");
	const d = [];
	const pen = { beginPath() {}, closePath: () => d.push("Z"), moveTo: (x, y) => d.push(`M${x.toFixed(2)} ${y.toFixed(2)}`), lineTo: (x, y) => d.push(`L${x.toFixed(2)} ${y.toFixed(2)}`), rect: (x, y, w, h) => d.push(`M${x} ${y}h${w}v${h}h${-w}Z`), arc: (x, y, r) => d.push(`M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`) };
	glyphPath(pen, glyphOf(seat), 8, 8, 4.4);
	mark.setAttribute("d", d.join(""));
	mark.setAttribute("fill", "none");
	mark.setAttribute("stroke", theme()?.tokens.bg ?? "black"); // theme-exempt: before the theme arrives
	mark.setAttribute("stroke-width", "1.8");
	mark.setAttribute("stroke-linejoin", "round");
	mark.setAttribute("stroke-linecap", "round");
	svg.append(disc, mark);
	return svg;
}
const busy = () => !!anim || queue.length > 0;

// ------------------------------------------------------------- the board

/** A square's centre in CSS px; 0 (not on the board yet) waits on square 1. */
function centre(sq) {
	if (sq <= 0) sq = 1;
	return [(SL.colOf(sq) + 0.5) * cell, (9 - SL.rowOf(sq) + 0.5) * cell];
}

/** A snake's body, head to tail: points in CSS px along a wave. */
function snakePath(head, tail) {
	const [x0, y0] = centre(head);
	const [x1, y1] = centre(tail);
	const len = Math.hypot(x1 - x0, y1 - y0) || 1;
	const [nx, ny] = [-(y1 - y0) / len, (x1 - x0) / len];
	const waves = Math.max(1, Math.round(len / (cell * 2.2)));
	const amp = Math.min(cell * 0.38, len * 0.14);
	const pts = [];
	const N = Math.max(16, Math.round(len / 4));
	for (let i = 0; i <= N; i++) {
		const u = i / N;
		const o = Math.sin(u * waves * Math.PI) * amp * (1 - 0.25 * u);
		pts.push([x0 + (x1 - x0) * u + nx * o, y0 + (y1 - y0) * u + ny * o]);
	}
	return pts;
}

function layout() {
	// The board takes what the stage has left, square, the rest centred round it.
	const cs = getComputedStyle(stage);
	const room = (k) => parseFloat(cs[k]) || 0;
	const w = stage.clientWidth - room("paddingLeft") - room("paddingRight");
	const h = stage.clientHeight - room("paddingTop") - room("paddingBottom") - statusEl.offsetHeight - playersEl.offsetHeight - bar.offsetHeight - 3 * 6;
	const side = Math.max(200, Math.floor(Math.min(w, h, 640) - 4));
	cell = side / 10;
	dpr = Math.min(window.devicePixelRatio || 1, 3);
	canvas.style.width = `${side}px`;
	canvas.style.height = `${side}px`;
	canvas.width = Math.round(side * dpr);
	canvas.height = Math.round(side * dpr);
	layerKey = "";
	paint();
}

/** The board without tokens: squares, numbers, ladders, snakes. */
function drawLayer() {
	const t = theme();
	const key = `${canvas.width}:${JSON.stringify(view?.board)}:${t?.name}:${t?.mode}:${t?.tokens.surface}`;
	if (layer && key === layerKey) return layer;
	layerKey = key;
	layer = layer ?? document.createElement("canvas");
	layer.width = canvas.width;
	layer.height = canvas.height;
	const g = layer.getContext("2d");
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	const { tokens } = t;
	const side = cell * 10;
	g.fillStyle = tokens.surface;
	g.fillRect(0, 0, side, side);
	// Squares: a quiet checker, so rows read; 100 lit.
	for (let sq = 1; sq <= 100; sq++) {
		const x = SL.colOf(sq) * cell;
		const y = (9 - SL.rowOf(sq)) * cell;
		if ((SL.colOf(sq) + SL.rowOf(sq)) % 2) {
			g.fillStyle = tokens.surface2;
			g.fillRect(x, y, cell, cell);
		}
		if (sq === 100) {
			g.fillStyle = alpha(tokens.accent, 0.2);
			g.fillRect(x, y, cell, cell);
		}
	}
	g.strokeStyle = tokens.rule;
	g.lineWidth = 1;
	for (let i = 1; i < 10; i++) {
		g.beginPath();
		g.moveTo(Math.round(i * cell) + 0.5, 0);
		g.lineTo(Math.round(i * cell) + 0.5, side);
		g.moveTo(0, Math.round(i * cell) + 0.5);
		g.lineTo(side, Math.round(i * cell) + 0.5);
		g.stroke();
	}
	if (!view) return numbers(g, t);
	const glow = glows();
	// Ladders: two rails and their rungs.
	for (const [foot, top] of view.board.ladders) {
		const [x0, y0] = centre(foot);
		const [x1, y1] = centre(top);
		const len = Math.hypot(x1 - x0, y1 - y0) || 1;
		const [ux, uy] = [(x1 - x0) / len, (y1 - y0) / len];
		const [nx, ny] = [-uy * cell * 0.2, ux * cell * 0.2];
		g.strokeStyle = tokens.good;
		g.shadowColor = tokens.good;
		g.shadowBlur = glow ? 8 * dpr : 0;
		g.lineCap = "round";
		g.lineWidth = Math.max(2, cell * 0.08);
		g.beginPath();
		g.moveTo(x0 + nx - ux * cell * 0.2, y0 + ny - uy * cell * 0.2);
		g.lineTo(x1 + nx + ux * cell * 0.2, y1 + ny + uy * cell * 0.2);
		g.moveTo(x0 - nx - ux * cell * 0.2, y0 - ny - uy * cell * 0.2);
		g.lineTo(x1 - nx + ux * cell * 0.2, y1 - ny + uy * cell * 0.2);
		g.stroke();
		g.lineWidth = Math.max(1.5, cell * 0.055);
		const rungs = Math.max(2, Math.round(len / (cell * 0.42)));
		g.beginPath();
		for (let i = 0; i <= rungs; i++) {
			const u = i / rungs;
			const [px, py] = [x0 + (x1 - x0) * u, y0 + (y1 - y0) * u];
			g.moveTo(px + nx, py + ny);
			g.lineTo(px - nx, py - ny);
		}
		g.stroke();
		g.shadowBlur = 0;
	}
	// Snakes: a tapering body, a head with eyes and a tongue.
	const hues = [tokens.danger, tokens.warn, tokens.accent2];
	view.board.snakes.forEach(([head, tail], k) => {
		const colour = hues[k % hues.length];
		const pts = snakePath(head, tail);
		g.lineCap = "round";
		g.lineJoin = "round";
		g.shadowColor = colour;
		g.shadowBlur = glow ? 10 * dpr : 0;
		for (let i = 1; i < pts.length; i++) {
			const u = i / pts.length;
			g.strokeStyle = colour;
			g.lineWidth = Math.max(2, cell * (0.26 - 0.19 * u));
			g.beginPath();
			g.moveTo(...pts[i - 1]);
			g.lineTo(...pts[i]);
			g.stroke();
		}
		g.shadowBlur = 0;
		// A darker stripe down the back.
		g.strokeStyle = alpha(tokens.bg, 0.45);
		g.lineWidth = Math.max(1, cell * 0.05);
		g.setLineDash([cell * 0.12, cell * 0.16]);
		g.beginPath();
		pts.forEach((p, i) => (i ? g.lineTo(...p) : g.moveTo(...p)));
		g.stroke();
		g.setLineDash([]);
		const [hx, hy] = pts[0];
		const [ax, ay] = pts[Math.min(3, pts.length - 1)];
		const ang = Math.atan2(hy - ay, hx - ax);
		g.save();
		g.translate(hx, hy);
		g.rotate(ang);
		g.fillStyle = colour;
		g.beginPath();
		g.ellipse(0, 0, cell * 0.24, cell * 0.19, 0, 0, Math.PI * 2);
		g.fill();
		g.strokeStyle = tokens.danger;
		g.lineWidth = Math.max(1, cell * 0.035);
		g.beginPath();
		g.moveTo(cell * 0.22, 0);
		g.lineTo(cell * 0.36, 0);
		g.lineTo(cell * 0.42, -cell * 0.05);
		g.moveTo(cell * 0.36, 0);
		g.lineTo(cell * 0.42, cell * 0.05);
		g.stroke();
		g.fillStyle = tokens.bg;
		for (const s of [-1, 1]) {
			g.beginPath();
			g.arc(cell * 0.07, s * cell * 0.08, Math.max(1.2, cell * 0.04), 0, Math.PI * 2);
			g.fill();
		}
		g.restore();
	});
	return numbers(g, t);
}

/** The square numbers, over the art, each on a plate of its square's colour so a snake never hides one. */
function numbers(g, t) {
	const { tokens } = t;
	const fontPx = Math.max(12, Math.round(cell * 0.3));
	g.font = `600 ${fontPx}px ${t.fonts?.mono || "monospace"}`;
	g.textBaseline = "top";
	g.textAlign = "left";
	for (let sq = 1; sq <= 100; sq++) {
		const [x, y] = [SL.colOf(sq) * cell + 2, (9 - SL.rowOf(sq)) * cell + 2];
		g.fillStyle = alpha((SL.colOf(sq) + SL.rowOf(sq)) % 2 ? tokens.surface2 : tokens.surface, 0.8);
		g.fillRect(x - 1, y - 1, g.measureText(String(sq)).width + 3, fontPx + 1);
		g.fillStyle = sq === 100 ? tokens.accent : tokens.ink3;
		g.fillText(String(sq), x, y);
	}
	return layer;
}

function paint() {
	if (!raf) raf = requestAnimationFrame(frame);
}

/** Where each seat's token is drawn now: shown[], with the moving one between squares. */
function tokenSpots(now) {
	const spots = shown.map((sq) => centre(sq));
	if (!anim) return spots;
	const { move } = anim;
	const at = (now - anim.t0) * anim.speed;
	const hops = move.via === "over" ? 0 : move.land - move.from;
	const hopEnd = ROLL_MS + hops * HOP_MS;
	if (at < ROLL_MS) spots[move.seat] = centre(move.from);
	else if (at < hopEnd) {
		const k = (at - ROLL_MS) / HOP_MS;
		const i = Math.floor(k);
		const [a, b] = [centre(move.from + i), centre(move.from + i + 1)];
		const u = k - i;
		// A little hop between squares.
		spots[move.seat] = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u - Math.sin(u * Math.PI) * cell * 0.25];
	} else if (move.via === "ladder" || move.via === "snake") {
		const u = Math.min(1, (at - hopEnd) / SLIDE_MS);
		const e = u < 0.5 ? 2 * u * u : 1 - 2 * (1 - u) * (1 - u);
		if (move.via === "ladder") {
			const [a, b] = [centre(move.land), centre(move.to)];
			spots[move.seat] = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
		} else {
			const pts = snakePath(move.land, move.to);
			spots[move.seat] = pts[Math.min(pts.length - 1, Math.round(e * (pts.length - 1)))];
		}
	} else spots[move.seat] = centre(move.land);
	return spots;
}

function frame(now) {
	raf = 0;
	const t = theme();
	if (!t) return;
	stepAnim(now);
	c2d.setTransform(1, 0, 0, 1, 0, 0);
	c2d.drawImage(drawLayer(), 0, 0);
	c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (view) {
		const spots = tokenSpots(now);
		// Tokens sharing a square stand in a little ring.
		const groups = new Map();
		spots.forEach((p, seat) => {
			if (view.out[seat]) return;
			const k = `${Math.round(p[0])},${Math.round(p[1])}`;
			groups.set(k, [...(groups.get(k) ?? []), seat]);
		});
		const r = cell * (view.seats.length > 4 ? 0.22 : 0.26);
		for (const seats of groups.values()) {
			const n = seats.length;
			// Two to four sharing stand in a small ring; five or six in a wider
			// one, smaller, so none hides another.
			const off = n > 4 ? cell * 0.3 : n > 1 ? cell * 0.21 : 0;
			const size = n > 4 ? r * 0.74 : n > 1 ? r * 0.8 : r;
			seats.forEach((seat, k) => {
				const [x, y] = spots[seat];
				const a = (k / n) * Math.PI * 2 - Math.PI / 2;
				drawToken(seat, x + Math.cos(a) * off, y + Math.sin(a) * off, size, t);
			});
		}
	}
	if (anim || tumbling) paint();
}

/**
 * A token: a dark halo first, so it stands off a snake of its own hue, the
 * disc in its colour, its mark cut in the background colour, and a rim (ink
 * for this phone's own token).
 */
function drawToken(seat, x, y, r, t) {
	const { tokens } = t;
	c2d.fillStyle = tokens.bg;
	c2d.beginPath();
	c2d.arc(x, y, r + Math.max(2, r * 0.22), 0, Math.PI * 2);
	c2d.fill();
	c2d.fillStyle = colourOf(seat);
	c2d.shadowColor = colourOf(seat);
	c2d.shadowBlur = glows() ? 10 * dpr : 0;
	c2d.beginPath();
	c2d.arc(x, y, r, 0, Math.PI * 2);
	c2d.fill();
	c2d.shadowBlur = 0;
	c2d.lineWidth = Math.max(1.5, cell * 0.045);
	c2d.strokeStyle = seat === view.you ? tokens.ink : tokens.bg;
	c2d.stroke();
	c2d.lineWidth = Math.max(1.4, r * 0.2);
	c2d.lineJoin = "round";
	c2d.lineCap = "round";
	c2d.strokeStyle = tokens.bg;
	glyphPath(c2d, glyphOf(seat), x, y, r * 0.55);
	c2d.stroke();
}

// --------------------------------------------------------------- the moves

function showFace(n) {
	face = n;
	const on = FACES[n] ?? [];
	pips.forEach((p, i) => p.classList.toggle("on", on.includes(i)));
}

/** Advance the playing move; start the next one queued. */
function stepAnim(now) {
	if (tumbling && !anim) showFace(1 + (Math.floor(now / 70) % 6));
	if (!anim && queue.length) {
		anim = { move: queue.shift(), t0: now, speed: queue.length ? 2 : 1 };
		if (anim.move.seat === view?.you) stopTumbling();
		die.classList.add("tumbling");
	}
	if (!anim) return;
	const { move } = anim;
	const at = (now - anim.t0) * anim.speed;
	if (at < ROLL_MS) {
		showFace(1 + (Math.floor(at / 60) % 6));
		return;
	}
	if (!anim.settled) {
		anim.settled = true;
		showFace(move.roll);
		die.classList.remove("tumbling");
	}
	const hops = move.via === "over" ? 0 : move.land - move.from;
	const slide = move.via === "ladder" || move.via === "snake" ? SLIDE_MS : 0;
	if (at >= ROLL_MS + hops * HOP_MS + slide + (move.via === "over" ? 250 : 0)) finish();
}

function finish() {
	const { move } = anim;
	shown[move.seat] = move.to;
	anim = null;
	moves++;
	tell(move);
	if (!queue.length) {
		renderPlayers();
		renderDie();
		arcade.idle?.();
	} else paint();
}

/** The move in words, under the die. */
function tell(move) {
	const who = move.seat === view?.you ? "You" : nameOf(move.seat);
	const main = `${who} rolled ${move.roll}.`;
	let more = "";
	if (move.via === "ladder") more = `Up the ladder from ${move.land} to ${move.to}!`;
	else if (move.via === "snake") more = `Down the snake from ${move.land} to ${move.to}.`;
	else if (move.via === "over") more = `${100 - move.from} needed exactly to finish: stays on ${move.from}.`;
	else more = move.to === 100 ? `Home on 100: ${ordinal(move.place ?? 1)} place!` : `On to ${move.to}.`;
	said.replaceChildren(document.createTextNode(main), el("small", "", more));
}

function renderDie() {
	const mine = myTurn() && !tumbling && !busy();
	die.disabled = !myTurn() || tumbling;
	die.classList.toggle("mine", mine);
	die.setAttribute("aria-label", myTurn() ? (tumbling ? "Rolling…" : "Roll the die") : `The die: ${face}`);
}

function renderPlayers() {
	if (!view) return;
	playersEl.replaceChildren(
		...view.seats.map((_, seat) => {
			const chip = el("span", `sl-player${seat === view.turn && !view.over ? " on" : ""}${view.out[seat] ? " out" : ""}`);
			const sq = shown[seat] ?? 0;
			const place = view.home.indexOf(seat);
			const where = place >= 0 && sq === 100 ? ordinal(place + 1) : sq ? String(sq) : "start";
			chip.append(tokenIcon(seat), document.createTextNode(seat === view.you ? "You" : nameOf(seat)), el("b", "", where));
			return chip;
		}),
	);
	let text;
	const mine = view.home.indexOf(view.you);
	if (view.over) text = view.winner === view.you ? "YOU WIN!" : view.winner != null ? `${nameOf(view.winner)} WINS` : "GAME OVER";
	else if (mine >= 0) text = `You came ${ordinal(mine + 1)} — the rest play on`;
	else if (myTurn()) text = "YOUR ROLL — tap the die";
	else text = `${nameOf(view.turn)} to roll`;
	if (statusEl.textContent !== text) statusEl.textContent = text;
	canvas.setAttribute("aria-label", `Snakes and ladders board. ${view.seats.map((_, s) => `${s === view.you ? "You" : nameOf(s)} on ${shown[s] || "start"}`).join(", ")}.`);
}

// A roll lost on its way (a dropped link, a host changing hands) would leave
// the die tumbling and disabled for good: after LOST_MS with no new roll it
// stops, and can be tapped again.
const LOST_MS = 4000;
let lostTimer = 0;
function stopTumbling() {
	clearTimeout(lostTimer);
	tumbling = false;
}
function roll() {
	if (!myTurn() || tumbling) return;
	tumbling = true;
	die.classList.add("tumbling");
	renderDie();
	arcade.act({ roll: true });
	const n = shownN;
	clearTimeout(lostTimer);
	lostTimer = setTimeout(() => {
		if (!tumbling || shownN !== n) return;
		stopTumbling();
		die.classList.remove("tumbling");
		showFace(face);
		renderDie();
		said.replaceChildren(document.createTextNode("The roll did not go through."), el("small", "", "Tap the die again."));
	}, LOST_MS);
	paint();
}
die.addEventListener("click", roll);
addEventListener("keydown", (e) => {
	if ((e.key === "r" || e.key === "R" || ((e.key === " " || e.key === "Enter") && e.target === document.body)) && myTurn()) {
		e.preventDefault();
		roll();
	}
});

arcade.on("view", ({ state }) => {
	const before = view;
	view = state;
	if (!before || before.match !== state.match || !state.last || state.last.n < shownN) {
		// A new match, a first view or a jump back: draw it as it stands.
		queue = [];
		anim = null;
		stopTumbling();
		die.classList.remove("tumbling");
		shown = [...state.pos];
		shownN = state.last?.n ?? 0;
		showFace(state.last?.roll ?? 1);
		if (!before || before.match !== state.match) said.replaceChildren(document.createTextNode(state.last ? "" : "Land on 100 exactly to finish."), el("small", "", "Ladders climb, snakes slide; the rest play on for places."));
	} else if (state.last.n > shownN) {
		if (state.last.seat === state.you) clearTimeout(lostTimer); // ours arrived
		if (state.last.n > shownN + 1 || reduced.matches) {
			// More than one move behind (a reconnect), or no motion wanted: jump.
			queue = [];
			anim = null;
			shown = [...state.pos];
			stopTumbling();
			die.classList.remove("tumbling");
			showFace(state.last.roll);
			tell(state.last);
		} else queue.push({ ...state.last });
		shownN = state.last.n;
	}
	if (shown.length !== state.pos.length) shown = [...state.pos];
	if (state.out.some(Boolean)) state.out.forEach((o, i) => o && (shown[i] = state.pos[i]));
	if (!busy()) {
		tumbling = tumbling && state.turn === state.you;
		arcade.idle?.();
	}
	renderPlayers();
	renderDie();
	paint();
});
arcade.on("rejected", (m) => {
	stopTumbling();
	die.classList.remove("tumbling");
	renderDie();
	said.replaceChildren(document.createTextNode(m.reason));
});
arcade.on("roster", renderPlayers);
arcade.on("theme.set", () => {
	layerKey = "";
	renderPlayers();
	paint();
});
addEventListener("resize", layout);
const ro = new ResizeObserver(layout);
ro.observe(stage);
ro.observe(playersEl);
arcade.init.then(layout);

/** For the tests: the view, what is drawn (`shown`, `moves`), whether a move is playing, the board's cell in CSS px. */
arcade.debug = () => ({
	...(view ?? { seats: [], pos: [], winner: null }),
	shown: [...shown],
	shownN,
	moves,
	busy: busy(),
	tumbling,
	myTurn: myTurn(),
	cell,
});
