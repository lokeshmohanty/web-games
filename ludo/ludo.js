// ludo/ludo.js — Ludo. An SDK v2 managed game.
//
// The rules are ludo-rules.js `game()`: the platform runs them on the host
// (the die is rolled there), sends each phone its view, rolls and moves for
// bot seats, shows the turn-wait banner, reports the result, draws the end
// card with PLAY AGAIN and hands the game to the heir if the host leaves.
// This file is the table: the setup, the board, the tokens and the die.
//
// ## Never a long wait
//
// A tap on the die starts it tumbling at once, before the host has answered;
// the host's roll lands it. A move then plays out — the die settles
// (ROLL_MS), the token hops square by square (HOP_MS each) and anyone it
// lands on flies back to their yard (CAPTURE_MS) — about a second for most
// moves. Moves that arrive while one is playing wait their turn, at double
// speed. With one move possible the rules make it; with a choice, each token
// that can move gets a ring to tap, 44px however small the squares are:
// rings that would overlap are pushed apart, with a line back to their token.
// Under reduced motion nothing animates.
//
// ## Telling players apart
//
// Every seat's tokens carry a mark as well as a colour (ring, cross,
// triangle, diamond, square, star: the marks Snakes & Ladders and Five in a
// Row use), the same mark as on the seat's chip, so the board reads without
// colour. Tokens of one player on one square stand as a little stack with a
// count; several players' on a safe square stand side by side.
//
// The art is drawn here from the theme: squares from the surfaces, each arm's
// start, home column and yard in its seat's colour (the end card's --p1…),
// safe stars in the ink, and nothing in a colour of its own.

const LR = ludoRules;
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
// A bot takes its whole turn in one move (ludo-rules.js). It moves once the
// host's own board has shown everything before it (at most BOT_WAIT_MS on top
// of the platform's 0.6–1.1 s pause, inside the platform's 5 s for a call), so
// a table of bots plays at the pace of its animation rather than racing ahead
// of it; under reduced motion nothing is waited for. A bot's move may be a
// promise (docs/sdk-v2.md "Managed state").
const BOT_WAIT_MS = 3500;
// The host's last table ({ n, board, mode }), kept in the game's storage on
// this device: a card's tap at the same table goes straight in on it.
let lastTable = null;
arcade.init.then((m) => {
	const t = m?.storage?.table;
	if (t && typeof t === "object") lastTable = t;
});
const rules = LR.game({ isHost: (id) => id === arcade.party?.host, last: () => lastTable });
arcade.managed({
	...rules,
	bot(call) {
		const action = rules.bot(call);
		// A hidden host tab draws nothing (no animation frames): never wait on it.
		if (!action || reduced.matches || document.hidden || !busy()) return action;
		const until = performance.now() + BOT_WAIT_MS;
		return new Promise((done) => {
			const check = () => (!busy() || performance.now() > until ? done(action) : setTimeout(check, 50));
			check();
		});
	},
});

const style = document.createElement("style");
style.textContent = `
	.g-stage { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
		padding: calc(env(safe-area-inset-top) + 52px) max(8px, env(safe-area-inset-right))
			max(8px, env(safe-area-inset-bottom)) max(8px, env(safe-area-inset-left)); box-sizing: border-box; }
	.lu-status { font-size: clamp(0.9rem, 3.4vw, 1.15rem); color: var(--accent); text-shadow: 0 0 8px var(--accent-glow);
		min-height: 1.4em; text-align: center; font-family: var(--font-display); letter-spacing: 0.02em; }
	.lu-players { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 12px; font-size: 0.8rem; color: var(--muted); max-width: 560px; }
	.lu-player { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
	.lu-player svg { width: 16px; height: 16px; flex: none; }
	.lu-player b { color: var(--ink); font-weight: 600; font-variant-numeric: tabular-nums; }
	.lu-player i { font-style: normal; font-size: 0.75rem; padding: 0 4px; border-radius: 4px; border: 1px solid var(--rule); color: var(--ink-2); }
	.lu-player.on { color: var(--ink); }
	.lu-player.on svg { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: 50%; }
	.lu-player.out { opacity: 0.55; text-decoration: line-through; }
	.lu-fill { position: relative; flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; width: 100%; }
	.lu-wrap { position: relative; flex: none; }
	.lu-board { display: block; touch-action: manipulation; }
	.lu-picks { position: absolute; inset: 0; pointer-events: none; }
	.lu-pick { position: absolute; width: 44px; height: 44px; margin: -22px 0 0 -22px; padding: 0; border-radius: 50%;
		border: 2px dashed var(--accent); background: transparent; cursor: pointer; pointer-events: auto;
		display: flex; align-items: center; justify-content: center; box-shadow: 0 0 12px var(--accent-glow);
		animation: lu-pulse 1.1s ease-in-out infinite; -webkit-tap-highlight-color: transparent; }
	/* A ring pushed off its token: see-through, so the board under it still reads. */
	.lu-pick.away { border-style: solid; }
	.lu-pick svg { width: 20px; height: 20px; pointer-events: none; }
	.lu-pick b { position: absolute; top: -9px; right: -9px; min-width: 18px; height: 18px; padding: 0 3px; box-sizing: border-box;
		border-radius: 9px; background: var(--ink); color: var(--bg); font: 700 12px/18px var(--font-mono); text-align: center; pointer-events: none; }
	.lu-pick:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
	@keyframes lu-pulse { 50% { transform: scale(1.08); box-shadow: 0 0 20px var(--accent-glow), 0 0 0 2px var(--accent-glow); } }
	.lu-bar { display: flex; align-items: center; justify-content: center; gap: 14px; width: 100%; max-width: 520px; min-height: 72px; }
	.lu-die { width: 64px; height: 64px; flex: none; padding: 9px; border-radius: 14px; border: 3px solid var(--border);
		background: var(--panel); display: grid; grid-template: repeat(3, 1fr) / repeat(3, 1fr); cursor: pointer;
		box-sizing: border-box; transition: transform 0.12s; }
	.lu-die span { align-self: center; justify-self: center; width: 9px; height: 9px; border-radius: 50%; background: var(--ink); visibility: hidden; }
	.lu-die span.on { visibility: visible; }
	.lu-die.mine { box-shadow: 0 0 16px var(--accent-glow); animation: lu-ready 1.2s ease-in-out infinite; }
	.lu-die.tumbling { animation: lu-tumble 0.18s linear infinite; }
	.lu-die:disabled { cursor: default; opacity: 0.9; }
	.lu-die:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
	@keyframes lu-ready { 50% { box-shadow: 0 0 26px var(--accent-glow), 0 0 0 3px var(--accent-glow); transform: scale(1.04); } }
	@keyframes lu-tumble { 0% { transform: rotate(0deg); } 50% { transform: rotate(16deg) scale(0.93); } 100% { transform: rotate(0deg); } }
	@media (prefers-reduced-motion: reduce) { .lu-die.mine, .lu-die.tumbling, .lu-pick { animation: none; } }
	.lu-said { flex: 1 1 auto; min-width: 0; font-size: 0.85rem; color: var(--ink); line-height: 1.35; }
	.lu-said small { display: block; color: var(--muted); font-size: 0.8rem; }
	.lu-setup { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 10px; padding: 12px; box-sizing: border-box; text-align: center; border-radius: 12px;
		background: color-mix(in oklch, var(--bg) 84%, transparent); overflow-y: auto; }
	.lu-setup[hidden] { display: none; }
	.lu-setup h2 { margin: 0; font-family: var(--font-display); font-size: 1.5rem; letter-spacing: 0.06em; color: var(--accent); }
	.lu-setup p { margin: 0; max-width: 26em; color: var(--ink-2); line-height: 1.35; font-size: 0.85rem; }
	.lu-choice { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
	.lu-setup .neon-btn { min-height: 44px; min-width: 44px; padding: 8px 12px; font-size: 0.85rem; }
	.lu-choice .neon-btn { border: 2px solid var(--accent); }
	.lu-choice .neon-btn[aria-pressed="false"]:not(:disabled) { background: transparent; color: var(--accent); }
	.lu-choice .neon-btn:disabled { border-color: var(--rule); }
	.lu-teams { display: flex; flex-wrap: wrap; gap: 4px 14px; justify-content: center; font-size: 0.8rem; color: var(--ink-2); }
	.lu-teams span { display: inline-flex; align-items: center; gap: 4px; }
	.lu-teams svg { width: 14px; height: 14px; }
	.lu-teams b { color: var(--ink); }
`;
document.head.append(style);

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
};

const stage = el("div", "g-stage");
const statusEl = el("div", "lu-status");
statusEl.setAttribute("role", "status");
const playersEl = el("div", "lu-players");
const fill = el("div", "lu-fill");
const wrap = el("div", "lu-wrap");
const canvas = el("canvas", "lu-board");
canvas.setAttribute("role", "img");
const picks = el("div", "lu-picks");
const setup = el("div", "lu-setup");
setup.hidden = true;
setup.setAttribute("role", "dialog");
setup.setAttribute("aria-label", "Ludo: set up the game");
wrap.append(canvas, picks);
fill.append(wrap, setup);
const bar = el("div", "lu-bar");
const die = el("button", "lu-die");
die.type = "button";
const pips = Array.from({ length: 9 }, () => el("span"));
die.append(...pips);
const said = el("div", "lu-said");
said.setAttribute("aria-live", "polite");
bar.append(die, said);
stage.append(statusEl, playersEl, fill, bar);
document.body.append(stage);
const c2d = canvas.getContext("2d");

// ------------------------------------------------------------------ state

const ROLL_MS = 360; // the die settles
const HOP_MS = 85; // one square
const EXIT_MS = 240; // out of the yard onto the start
const CAPTURE_MS = 340; // a token sent back flies to its yard
const HOLD_MS = 450; // a roll with nothing to move (or a third 6) stays on show
const LOST_MS = 4000; // a tap with no answer: the die (or the rings) come back
const QUEUE_MAX = 8; // events waiting to be shown, past which the board jumps to the view
const FACES = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const GLYPHS = ["ring", "cross", "triangle", "diamond", "square", "star"];
const TEAM_NAMES = ["A", "B", "C"];

let view = null;
let shown = []; // each seat's tokens as drawn (lags the view while moves play)
let shownN = 0; // the last event drawn (view.last.n)
let queue = []; // events waiting to be drawn: { ev, after }
let anim = null; // { ev, after, t0, speed, settled } while one plays
let tumbling = false; // our roll is on its way to the host
let picking = false; // our pick is on its way to the host
let face = 1;
let geo = null;
let rot = 0; // the board turned so this phone's yard is bottom left
let box = { minX: 0, minY: 0, w: 15, h: 15 };
let cellPx = 20;
let dpr = 1;
let layer = null; // the board without tokens
let layerKey = "";
let raf = 0;
let targets = []; // the rings on show: { x, y, tx, ty, move }
let moves = 0; // events drawn, for the tests
let drawn = []; // the tokens last drawn, for the tests: { seat, x, y, r, count, square, shared, marks }

const theme = () => arcade.theme;
const colourOf = (seat) => theme()?.players[seat % 8] ?? "gray"; // theme-exempt: before the theme arrives
const glows = () => !/,\s*0\)$/.test(theme()?.tokens.glow ?? ", 0)");
const alpha = (rgba, a) => String(rgba).replace(/,\s*[\d.]+\)$/, `, ${a})`);
const glyphOf = (seat) => GLYPHS[seat % GLYPHS.length];
const nameOf = (seat) => {
	const id = view?.seats[seat];
	return arcade.party?.members?.find((p) => p.id === id)?.name || `Player ${seat + 1}`;
};
const who = (seat) => (seat === view?.you ? "You" : nameOf(seat));
const teamsOn = () => view && view.mode !== "ffa";
const playing = () => view?.phase === "play" && !view.over;
const myTurn = () => playing() && view.you >= 0 && view.turn === view.you && !view.out[view.you];
const busy = () => !!anim || queue.length > 0;
/** Whose turn the board is showing: the playing event's seat while it plays out, else the view's. */
const shownTurn = () => (anim ? anim.ev.seat : queue.length ? queue[0].ev.seat : view.turn);
const clone = (x) => JSON.parse(JSON.stringify(x));
const ordinal = (n) => `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
const armOf = (seat) => view.arms[seat];
const seatOfArm = (arm) => (view ? view.arms.indexOf(arm) : -1);

// ----------------------------------------------------------- the marks

/** A seat's mark, centred on (x, y), r its half size, as a path on `g` (a canvas or a pen). */
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
	else {
		for (let i = 0; i < 10; i++) {
			const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
			const k = i % 2 ? r * 0.45 : r;
			g[i ? "lineTo" : "moveTo"](x + Math.cos(a) * k, y + Math.sin(a) * k);
		}
		g.closePath();
	}
}
/** A seat's token as a small SVG: its chip, its ring when pushed away from it. */
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
	const pen = {
		beginPath() {},
		closePath: () => d.push("Z"),
		moveTo: (x, y) => d.push(`M${x.toFixed(2)} ${y.toFixed(2)}`),
		lineTo: (x, y) => d.push(`L${x.toFixed(2)} ${y.toFixed(2)}`),
		rect: (x, y, w, h) => d.push(`M${x} ${y}h${w}v${h}h${-w}Z`),
		arc: (x, y, r) => d.push(`M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`),
	};
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

// ------------------------------------------------------------- the board

/** Board units (the middle at 0, 0) to canvas CSS px, turned by `rot`. */
function px([x, y]) {
	const c = Math.cos(rot);
	const s = Math.sin(rot);
	return [(x * c - y * s - box.minX) * cellPx, (x * s + y * c - box.minY) * cellPx];
}
/** A square's four corners, in board units. */
function corners(arm, b, i) {
	const [cx, cy] = geo.cell(arm, b, i);
	const { u, v } = geo.axes(arm);
	return [
		[cx + (u[0] + v[0]) / 2, cy + (u[1] + v[1]) / 2],
		[cx + (u[0] - v[0]) / 2, cy + (u[1] - v[1]) / 2],
		[cx - (u[0] + v[0]) / 2, cy - (u[1] + v[1]) / 2],
		[cx - (u[0] - v[0]) / 2, cy - (u[1] - v[1]) / 2],
	];
}
/** Every square of the board: { arm, b, i, kind } — kind "track", "start", "star" or "lane" (a home column). */
function squares() {
	const out = geo.track.map((t, g) => ({ ...t, kind: geo.starts.includes(g) ? "start" : geo.stars.includes(g) ? "star" : "track" }));
	for (let arm = 0; arm < geo.n; arm++) for (let i = 1; i < geo.L; i++) out.push({ arm, b: 0, i, kind: "lane" });
	return out;
}

/** The turn that puts this phone's yard (a watcher: the first) bottom left. */
function turnFor() {
	if (!view) return 0;
	const seat = view.you >= 0 ? view.you : 0;
	const arm = view.arms[seat] ?? 0;
	const step = 360 / geo.n;
	const yardAngle = geo.theta0 + arm * step + step / 2;
	const want = geo.n === 4 ? 135 : 120;
	return ((want - yardAngle) * Math.PI) / 180;
}

function layout() {
	if (!view) return;
	geo = LR.geometry(view.board);
	rot = turnFor();
	const cs = getComputedStyle(stage);
	const room = (k) => parseFloat(cs[k]) || 0;
	const w = stage.clientWidth - room("paddingLeft") - room("paddingRight");
	const h = stage.clientHeight - room("paddingTop") - room("paddingBottom") - statusEl.offsetHeight - playersEl.offsetHeight - bar.offsetHeight - 3 * 6;
	// The board's extent, turned (each turn is one of its symmetries, so only its corner moves).
	const c = Math.cos(rot);
	const s = Math.sin(rot);
	const pts = [];
	for (const q of squares()) pts.push(...corners(q.arm, q.b, q.i));
	for (let arm = 0; arm < geo.n; arm++) pts.push(...geo.yard(arm).corners);
	const xs = pts.map(([x, y]) => x * c - y * s);
	const ys = pts.map(([x, y]) => x * s + y * c);
	const pad = 0.15;
	box = { minX: Math.min(...xs) - pad, minY: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + 2 * pad, h: Math.max(...ys) - Math.min(...ys) + 2 * pad };
	cellPx = Math.max(12, Math.min(w / box.w, h / box.h, 40));
	const [cw, ch] = [Math.floor(box.w * cellPx), Math.floor(box.h * cellPx)];
	dpr = Math.min(window.devicePixelRatio || 1, 3);
	canvas.style.width = `${cw}px`;
	canvas.style.height = `${ch}px`;
	wrap.style.width = `${cw}px`;
	wrap.style.height = `${ch}px`;
	canvas.width = Math.round(cw * dpr);
	canvas.height = Math.round(ch * dpr);
	layerKey = "";
	placeTargets();
	paint();
}

function polygon(g, pts) {
	g.beginPath();
	pts.forEach((p, k) => {
		const [x, y] = px(p);
		g[k ? "lineTo" : "moveTo"](x, y);
	});
	g.closePath();
}

/** A five-pointed star, the safe squares' mark. */
function star(g, x, y, r) {
	g.beginPath();
	for (let k = 0; k < 10; k++) {
		const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
		const q = k % 2 ? r * 0.45 : r;
		g[k ? "lineTo" : "moveTo"](x + Math.cos(a) * q, y + Math.sin(a) * q);
	}
	g.closePath();
}

/** The board without tokens: yards, squares, starts, stars, home columns and the middle. */
function drawLayer() {
	const t = theme();
	const key = `${canvas.width}:${view.board}:${view.arms.join()}:${rot}:${t.name}:${t.mode}:${t.tokens.surface}:${t.players.join()}`;
	if (layer && key === layerKey) return layer;
	layerKey = key;
	layer = layer ?? document.createElement("canvas");
	layer.width = canvas.width;
	layer.height = canvas.height;
	const g = layer.getContext("2d");
	g.setTransform(dpr, 0, 0, dpr, 0, 0);
	g.clearRect(0, 0, layer.width, layer.height);
	const { tokens } = t;
	const glow = glows();
	const line = Math.max(1, cellPx * 0.05);
	// Yards: each seated arm's in its colour, an empty one plain.
	for (let arm = 0; arm < geo.n; arm++) {
		const seat = seatOfArm(arm);
		const y = geo.yard(arm);
		polygon(g, y.corners);
		g.fillStyle = seat >= 0 ? alpha(colourOf(seat), 0.16) : tokens.surface2;
		g.fill();
		g.lineWidth = line * 1.4;
		g.strokeStyle = seat >= 0 ? colourOf(seat) : tokens.rule;
		g.shadowColor = g.strokeStyle;
		g.shadowBlur = glow && seat >= 0 ? 10 * dpr : 0;
		g.lineJoin = "round";
		g.stroke();
		g.shadowBlur = 0;
		// The four spots the tokens rest on.
		for (const p of y.spots) {
			const [x0, y0] = px(p);
			g.beginPath();
			g.arc(x0, y0, cellPx * 0.42, 0, Math.PI * 2);
			g.fillStyle = tokens.bg;
			g.fill();
			g.lineWidth = line;
			g.strokeStyle = seat >= 0 ? alpha(colourOf(seat), 0.7) : tokens.rule;
			g.stroke();
		}
	}
	// The middle: a triangle for each arm, its colour where a seat is home.
	const ring = Array.from({ length: geo.n }, (_, arm) => {
		const { u, v } = geo.axes(arm);
		return [geo.h * u[0] + 1.5 * v[0], geo.h * u[1] + 1.5 * v[1]];
	});
	for (let arm = 0; arm < geo.n; arm++) {
		const seat = seatOfArm(arm);
		const { u, v } = geo.axes(arm);
		const back = [geo.h * u[0] - 1.5 * v[0], geo.h * u[1] - 1.5 * v[1]];
		polygon(g, [[0, 0], back, ring[arm]]);
		g.fillStyle = seat >= 0 ? alpha(colourOf(seat), 0.5) : tokens.surface2;
		g.fill();
		g.lineWidth = line;
		g.strokeStyle = tokens.rule;
		g.stroke();
	}
	// The squares.
	for (const q of squares()) {
		const seat = seatOfArm(q.arm);
		const mine = seat >= 0 && (q.kind === "start" || q.kind === "lane");
		polygon(g, corners(q.arm, q.b, q.i));
		g.fillStyle = mine ? alpha(colourOf(seat), q.kind === "start" ? 0.55 : 0.32) : q.kind === "lane" ? tokens.surface2 : tokens.surface;
		g.fill();
		g.lineWidth = line;
		g.strokeStyle = tokens.rule;
		g.stroke();
		if (q.kind === "star" || q.kind === "start") {
			const [x0, y0] = px(geo.cell(q.arm, q.b, q.i));
			star(g, x0, y0, cellPx * 0.34);
			g.lineWidth = Math.max(1.2, cellPx * 0.06);
			g.lineJoin = "round";
			g.strokeStyle = q.kind === "start" && seat >= 0 ? tokens.bg : tokens.ink3;
			g.stroke();
		}
	}
	// An arrow on each tip, pointing up its home column.
	for (let arm = 0; arm < geo.n; arm++) {
		const seat = seatOfArm(arm);
		if (seat < 0) continue;
		const [a0, a1] = [px(geo.cell(arm, 0, 0.75)), px(geo.cell(arm, 0, 1.25))];
		g.strokeStyle = colourOf(seat);
		g.lineWidth = Math.max(1.5, cellPx * 0.08);
		g.lineCap = "round";
		const [dx, dy] = [a1[0] - a0[0], a1[1] - a0[1]];
		g.beginPath();
		g.moveTo(...a0);
		g.lineTo(...a1);
		g.moveTo(a1[0] - dx * 0.6 + dy * 0.5, a1[1] - dy * 0.6 - dx * 0.5);
		g.lineTo(...a1);
		g.lineTo(a1[0] - dx * 0.6 - dy * 0.5, a1[1] - dy * 0.6 + dx * 0.5);
		g.stroke();
	}
	return layer;
}

function paint() {
	if (!raf) raf = requestAnimationFrame(frame);
}

/** Where a token at progress p is drawn, in board units. */
const spotOf = (seat, p, k) => geo.spot(armOf(seat), p, k);

/** Every token to draw now: { seat, k, at: [x, y] board units, moving } — the playing event's tokens between squares. */
function tokenSpots(now) {
	const list = [];
	shown.forEach((ts, seat) => {
		if (view.out[seat] && view.mode === "ffa") return;
		ts.forEach((p, k) => list.push({ seat, k, p, at: spotOf(seat, p, k) }));
	});
	if (!anim) return list;
	const { ev } = anim;
	const at = (now - anim.t0) * anim.speed + (ev.picked ? ROLL_MS : 0);
	const m = ev.move;
	if (!m) return list;
	const mover = list.find((x) => x.seat === m.owner && x.k === m.token);
	const walk = walkMs(m);
	if (mover && at >= ROLL_MS) {
		const u = at - ROLL_MS;
		mover.moving = true;
		if (m.from < 0) {
			const e = Math.min(1, u / EXIT_MS);
			const [a, b] = [spotOf(m.owner, -1, m.token), spotOf(m.owner, 0, m.token)];
			mover.at = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
		} else if (u < walk) {
			const kf = u / HOP_MS;
			const i = Math.floor(kf);
			const [a, b] = [spotOf(m.owner, m.from + i, m.token), spotOf(m.owner, Math.min(m.to, m.from + i + 1), m.token)];
			const f = kf - i;
			// A little hop between squares: lifted toward the top of the screen.
			const lift = (Math.sin(f * Math.PI) * 0.3) / 1;
			const [lx, ly] = unturn([0, -lift]);
			mover.at = [a[0] + (b[0] - a[0]) * f + lx, a[1] + (b[1] - a[1]) * f + ly];
		} else mover.at = spotOf(m.owner, m.to, m.token);
		if (u >= walk)
			for (const [seat, k, from] of m.caps ?? []) {
				const v = list.find((x) => x.seat === seat && x.k === k);
				if (!v) continue;
				const e = Math.min(1, (u - walk) / CAPTURE_MS);
				const [a, b] = [spotOf(seat, from, k), spotOf(seat, -1, k)];
				v.at = [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e];
				v.moving = true;
			}
	}
	return list;
}
/** A screen direction back into board units (undoing the turn). */
function unturn([x, y]) {
	const c = Math.cos(-rot);
	const s = Math.sin(-rot);
	return [x * c - y * s, x * s + y * c];
}
const walkMs = (m) => (m.from < 0 ? EXIT_MS : (m.to - m.from) * HOP_MS);

/**
 * Tokens grouped where they stand: one player's on one square make a stack
 * (drawn once, with a count); several players' on a square stand side by side.
 * Returns [{ x, y, r, seat, count, members }] in CSS px.
 */
function groups(list) {
	const r = cellPx * 0.36;
	const bySquare = new Map();
	for (const t of list) {
		if (t.moving || t.p < 0) continue;
		const key = `${t.at[0].toFixed(2)},${t.at[1].toFixed(2)}`;
		bySquare.set(key, [...(bySquare.get(key) ?? []), t]);
	}
	const out = [];
	for (const t of list) {
		if (t.moving || t.p < 0) {
			const [x, y] = px(t.at);
			out.push({ x, y, r, seat: t.seat, count: 1, members: [t], cx: x, cy: y, shared: false });
		}
	}
	for (const here of bySquare.values()) {
		const seats = [...new Set(here.map((t) => t.seat))];
		const [cx, cy] = px(here[0].at);
		const homeSq = here[0].p === view.home;
		const n = seats.length;
		// Several players on one square stand in a ring round it, each at
		// least SHARED_R across and 4px apart, so every mark reads; their
		// stacks count in notches pointing out of the ring (drawToken).
		const size = n > 1 ? Math.max(SHARED_R, cellPx * 0.3) : r;
		const off = n > 1 ? (size + 2) / Math.sin(Math.PI / n) : 0;
		seats.forEach((seat, k) => {
			const members = here.filter((t) => t.seat === seat);
			const a = (k / n) * Math.PI * 2 - Math.PI / 2 + (homeSq ? 0 : Math.PI / 4);
			out.push({ x: cx + Math.cos(a) * off, y: cy + Math.sin(a) * off, r: size, seat, count: members.length, members, cx, cy, shared: n > 1 });
		});
	}
	return out;
}
const SHARED_R = 7; // px: the smallest a token is drawn beside others

function frame(now) {
	raf = 0;
	const t = theme();
	if (!t || !view || !geo) return;
	stepAnim(now);
	c2d.setTransform(1, 0, 0, 1, 0, 0);
	c2d.clearRect(0, 0, canvas.width, canvas.height);
	c2d.drawImage(drawLayer(), 0, 0);
	c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
	if (view.phase === "play") {
		const list = tokenSpots(now);
		// Where each choice would land: a ring in the owner's colour.
		if (targets.length) {
			for (const tg of targets) {
				const [x, y] = px(spotOf(tg.move.owner, tg.move.to, tg.move.token));
				c2d.beginPath();
				c2d.arc(x, y, cellPx * 0.3, 0, Math.PI * 2);
				c2d.setLineDash([3, 3]);
				c2d.lineWidth = 2;
				c2d.strokeStyle = colourOf(tg.move.owner);
				c2d.stroke();
				c2d.setLineDash([]);
			}
		}
		const gs = groups(list);
		// The moving token last, over the others.
		gs.sort((a, b) => Number(a.members.some((m) => m.moving)) - Number(b.members.some((m) => m.moving)));
		drawn = gs.map((gr) => ({ seat: gr.seat, x: gr.x, y: gr.y, r: gr.r, count: gr.count, square: `${gr.cx.toFixed(1)},${gr.cy.toFixed(1)}`, shared: gr.shared, marks: drawToken(gr, t) }));
		// A ring pushed off its token: a line back to it.
		for (const tg of targets) {
			const d = Math.hypot(tg.x - tg.tx, tg.y - tg.ty);
			if (d < 6) continue;
			// From the token's edge to the ring's: shown through the ring, which is see-through.
			const [ux, uy] = [(tg.x - tg.tx) / d, (tg.y - tg.ty) / d];
			const from = Math.min(d, cellPx * 0.36);
			c2d.beginPath();
			c2d.moveTo(tg.tx + ux * from, tg.ty + uy * from);
			c2d.lineTo(tg.x, tg.y);
			c2d.lineWidth = 2;
			c2d.strokeStyle = t.tokens.accent;
			c2d.stroke();
		}
	}
	if (anim || tumbling) paint();
}

/**
 * A token: a dark halo, so it stands off any square; the disc in its colour;
 * its mark cut in the background colour; a rim (ink for this phone's own).
 * A stack alone on its square shows the discs below it, offset, and its
 * count on a plate; a stack beside other players' shows its count as notches
 * on its rim, pointing away from the others, so nothing covers a neighbour.
 * Returns where the notches are drawn (for the tests).
 */
function drawToken({ seat, x, y, r, count = 1, cx = x, cy = y, shared = false }, t) {
	const { tokens } = t;
	const layers = shared ? 1 : Math.min(count, 3);
	for (let k = layers - 1; k >= 0; k--) {
		const [ox, oy] = [x + k * r * 0.22, y - k * r * 0.22];
		c2d.fillStyle = tokens.bg;
		c2d.beginPath();
		c2d.arc(ox, oy, r + Math.max(1.5, r * 0.2), 0, Math.PI * 2);
		c2d.fill();
		c2d.fillStyle = colourOf(seat);
		c2d.shadowColor = colourOf(seat);
		c2d.shadowBlur = glows() && k === 0 ? 8 * dpr : 0;
		c2d.beginPath();
		c2d.arc(ox, oy, r, 0, Math.PI * 2);
		c2d.fill();
		c2d.shadowBlur = 0;
		c2d.lineWidth = Math.max(1.2, r * 0.16);
		c2d.strokeStyle = seat === view.you ? tokens.ink : tokens.bg;
		c2d.stroke();
	}
	c2d.lineWidth = Math.max(1.3, r * 0.2);
	c2d.lineJoin = "round";
	c2d.lineCap = "round";
	c2d.strokeStyle = tokens.bg;
	glyphPath(c2d, glyphOf(seat), x, y, r * 0.56);
	c2d.stroke();
	const marks = [];
	if (count > 1 && shared) {
		// One notch per token, fanned round the outward direction.
		const out = Math.atan2(y - cy, x - cx);
		for (let k = 0; k < count; k++) {
			const a = out + (k - (count - 1) / 2) * 0.45;
			const [ux, uy] = [Math.cos(a), Math.sin(a)];
			const [x0, y0, x1, y1] = [x + ux * (r + 1.5), y + uy * (r + 1.5), x + ux * (r + 5.5), y + uy * (r + 5.5)];
			for (const [w, colour] of [
				[4.5, tokens.bg],
				[2.2, tokens.ink],
			]) {
				c2d.lineWidth = w;
				c2d.strokeStyle = colour;
				c2d.beginPath();
				c2d.moveTo(x0, y0);
				c2d.lineTo(x1, y1);
				c2d.stroke();
			}
			marks.push([x1, y1]);
		}
	} else if (count > 1) {
		// The count, at 12px: a plate up and to the right.
		const bx = x + r * 0.95;
		const by = y - r * 0.95;
		c2d.beginPath();
		c2d.arc(bx, by, 8, 0, Math.PI * 2);
		c2d.fillStyle = tokens.ink;
		c2d.fill();
		c2d.font = `700 12px ${t.fonts?.mono || "monospace"}`;
		c2d.textAlign = "center";
		c2d.textBaseline = "middle";
		c2d.fillStyle = tokens.bg;
		c2d.fillText(String(count), bx, by + 0.5);
		marks.push([bx, by]);
	}
	return marks;
}

// --------------------------------------------------------------- the moves

function showFace(n) {
	face = n;
	const on = FACES[n] ?? [];
	pips.forEach((p, i) => p.classList.toggle("on", on.includes(i)));
}

/** Advance the playing event; start the next one queued. */
function stepAnim(now) {
	if (tumbling && !anim) showFace(1 + (Math.floor(now / 70) % 6));
	if (!anim && queue.length) {
		const next = queue.shift();
		// A phone that has fallen behind (a backgrounded tab, a slow link) catches up at double speed.
		anim = { ...next, t0: now, speed: queue.length > 2 ? 2 : 1 };
		if (next.ev.seat === view?.you) stopTumbling();
		if (!next.ev.picked) die.classList.add("tumbling");
		dieColour(next.ev.seat);
		renderStatus();
		renderPlayers();
		renderDie();
	}
	if (!anim) return;
	const { ev } = anim;
	const at = (now - anim.t0) * anim.speed + (ev.picked ? ROLL_MS : 0); // a picked move: the die has already landed
	if (at < ROLL_MS) {
		showFace(1 + (Math.floor(at / 60) % 6));
		return;
	}
	if (!anim.settled) {
		anim.settled = true;
		showFace(ev.roll);
		die.classList.remove("tumbling");
		tell(ev, true);
	}
	const m = ev.move;
	const length = m ? walkMs(m) + (m.caps?.length ? CAPTURE_MS : 0) : ev.pass || ev.lost ? HOLD_MS : 0;
	if (at >= ROLL_MS + length) finish();
}

function finish() {
	const { ev, after } = anim;
	shown = clone(after);
	anim = null;
	moves++;
	tell(ev);
	if (!queue.length) {
		render();
		arcade.idle?.();
	} else paint();
}

/** The event in words, under the die. `early`: the roll alone, as the die lands. */
function tell(ev, early = false) {
	const name = who(ev.seat);
	const main = `${name} rolled ${ev.roll}.`;
	let more = "";
	const m = ev.move;
	if (ev.lost) more = "Three 6s in a row: the turn is lost.";
	else if (ev.pass) more = ev.roll === 6 ? "Nothing can move — but a 6 rolls again." : `Nothing can move with a ${ev.roll}.`;
	else if (ev.choose) more = ev.seat === view?.you ? "Tap a token to move." : `${name === "You" ? "You are" : `${name} is`} choosing a token.`;
	else if (m && !early) {
		const tok = m.owner === ev.seat ? "a token" : m.owner === view?.you ? "your token" : `${nameOf(m.owner)}'s token`;
		if (m.from < 0) more = `Brought ${tok} out of the yard.`;
		else if (m.to === view?.home) more = `Took ${tok} home!`;
		else more = `Moved ${tok} ${m.to - m.from}.`;
		if (m.caps?.length) more += ` Sent ${m.caps.map(([s]) => (s === view?.you ? "your" : `${nameOf(s)}'s`)).join(" and ")} token${m.caps.length > 1 ? "s" : ""} home!`;
		if (ev.roll === 6 && !view?.over) more += " A 6: roll again.";
	}
	said.replaceChildren(document.createTextNode(main), el("small", "", more || " "));
}

function dieColour(seat) {
	die.style.borderColor = seat >= 0 ? `var(--p${(seat % 8) + 1})` : "";
}

function renderDie() {
	// Your roll once the board has caught up: never while the moves before it still play.
	const roll = myTurn() && view.stage === "roll" && !busy();
	die.disabled = !roll || tumbling;
	die.classList.toggle("mine", roll && !tumbling && !busy());
	if (!busy() && view && playing()) dieColour(view.turn);
	die.setAttribute("aria-label", roll ? (tumbling ? "Rolling…" : "Roll the die") : `The die: ${face}`);
}

/** The status line: whose turn, and what for. */
function renderStatus() {
	let text = "";
	if (!view) text = "";
	else if (view.phase === "setup") text = "LUDO — setting up";
	else if (busy()) {
		// The status follows the board, not the host: the moves before still playing.
		const seat = shownTurn();
		text = seat === view.you ? "YOUR ROLL" : `${nameOf(seat)} to roll`;
	} else if (view.over) {
		if (teamsOn()) {
			const mine = view.you >= 0 && view.teams[view.you] === view.winners;
			text = mine ? "YOUR TEAM WINS!" : view.winners != null ? `TEAM ${TEAM_NAMES[view.winners]} WINS` : "GAME OVER";
		} else text = view.winner === view.you ? "YOU WIN!" : view.winner != null ? `${nameOf(view.winner)} WINS` : "GAME OVER";
	} else if (myTurn()) {
		const forMate = view.tokens[view.you].every((p) => p === view.home);
		if (view.stage === "move") text = `YOU ROLLED ${view.roll} — tap a token`;
		else text = forMate ? "YOUR ROLL — for your partner" : "YOUR ROLL — tap the die";
	} else {
		const place = view.done.indexOf(view.you);
		if (!teamsOn() && place >= 0) text = `You came ${ordinal(place + 1)} — the rest play on`;
		else text = view.stage === "move" ? `${nameOf(view.turn)} is choosing a token` : `${nameOf(view.turn)} to roll`;
	}
	if (statusEl.textContent !== text) statusEl.textContent = text;
}

function renderPlayers() {
	if (!view) return;
	const order = view.seats.map((_, i) => i).sort((a, b) => (teamsOn() ? view.teams[a] - view.teams[b] : 0) || view.arms[a] - view.arms[b]);
	playersEl.replaceChildren(
		...order.map((seat) => {
			const chip = el("span", `lu-player${view.phase === "play" && (busy() || !view.over) && seat === shownTurn() ? " on" : ""}${view.out[seat] ? " out" : ""}`);
			const toks = shown[seat] ?? view.tokens[seat];
			const home = toks.filter((p) => p === view.home).length;
			const place = view.done.indexOf(seat);
			chip.append(tokenIcon(seat), document.createTextNode(who(seat)));
			if (teamsOn()) chip.append(el("i", "", TEAM_NAMES[view.teams[seat]]));
			if (view.phase === "play") chip.append(el("b", "", !teamsOn() && place >= 0 ? ordinal(place + 1) : `${home}/4`));
			return chip;
		}),
	);
	if (view.phase === "play" && geo)
		canvas.setAttribute(
			"aria-label",
			`Ludo board. ${view.seats.map((_, s) => `${who(s)}: ${(shown[s] ?? []).filter((p) => p === view.home).length} home, ${(shown[s] ?? []).filter((p) => p < 0).length} in the yard`).join("; ")}.`,
		);
	else canvas.setAttribute("aria-label", "Ludo board");
}

// ------------------------------------------------------------ the choices

/** The rings to tap: one per move on offer, over its token, pushed apart where they would overlap. */
function placeTargets() {
	targets = [];
	picks.replaceChildren();
	if (!view || !geo || !myTurn() || view.stage !== "move" || busy() || picking) return paint();
	const W = parseFloat(canvas.style.width) || 0;
	const H = parseFloat(canvas.style.height) || 0;
	const list = view.moves.map((move) => {
		const [x, y] = px(spotOf(move.owner, move.from, move.token));
		return { x, y, tx: x, ty: y, move };
	});
	// Stacks and side-by-side tokens are drawn off the square's centre: aim at the drawn token.
	const drawn = groups(tokenSpots(performance.now()));
	for (const tg of list) {
		const gr = drawn.find((d) => d.members.some((m) => m.seat === tg.move.owner && m.k === tg.move.token));
		if (gr) [tg.x, tg.y, tg.tx, tg.ty] = [gr.x, gr.y, gr.x, gr.y];
	}
	const MIN = 47;
	const clamp = (t) => {
		t.x = Math.max(23, Math.min(W - 23, t.x));
		t.y = Math.max(23, Math.min(H - 23, t.y));
	};
	list.forEach(clamp);
	for (let iter = 0; iter < 80; iter++) {
		let moved = false;
		for (let i = 0; i < list.length; i++)
			for (let j = i + 1; j < list.length; j++) {
				const [a, b] = [list[i], list[j]];
				let dx = b.x - a.x;
				let dy = b.y - a.y;
				let d = Math.hypot(dx, dy);
				if (d >= MIN) continue;
				if (d < 0.01) {
					const ang = (j * 2.4) % (Math.PI * 2);
					[dx, dy, d] = [Math.cos(ang), Math.sin(ang), 1];
				}
				const push = (MIN - d) / 2 + 0.5;
				a.x -= (dx / d) * push;
				a.y -= (dy / d) * push;
				b.x += (dx / d) * push;
				b.y += (dy / d) * push;
				clamp(a);
				clamp(b);
				moved = true;
			}
		if (!moved) break;
	}
	targets = list;
	list.forEach((tg, k) => {
		const btn = el("button", "lu-pick");
		btn.type = "button";
		btn.style.left = `${tg.x}px`;
		btn.style.top = `${tg.y}px`;
		btn.dataset.owner = String(tg.move.owner);
		btn.dataset.token = String(tg.move.token);
		const whose = tg.move.owner === view.you ? "your" : `${nameOf(tg.move.owner)}'s`;
		const many = tg.move.from >= 0 && view.tokens[tg.move.owner].filter((p) => p === tg.move.from).length > 1 ? " (one of a stack)" : "";
		const what = tg.move.from < 0 ? `Bring ${whose} token out of the yard` : tg.move.to === view.home ? `Move ${whose} token home` : `Move ${whose} token ${view.roll}, to square ${tg.move.to + 1}`;
		btn.setAttribute("aria-label", `${what}${many} (${k + 1})`);
		const off = Math.hypot(tg.x - tg.tx, tg.y - tg.ty);
		if (off >= 6) btn.classList.add("away");
		// Far enough that the ring no longer sits over its token: the token's mark in it.
		if (off >= 22) btn.append(tokenIcon(tg.move.owner));
		// A stack: how many tokens stand there (any one of them moves).
		const stack = tg.move.from >= 0 ? view.tokens[tg.move.owner].filter((p) => p === tg.move.from).length : 1;
		if (stack > 1) {
			btn.append(el("b", null, String(stack)));
			btn.dataset.stack = String(stack);
		}
		btn.addEventListener("click", () => pick(tg.move));
		picks.append(btn);
	});
	paint();
}

let lostTimer = 0;
function stopTumbling() {
	clearTimeout(lostTimer);
	tumbling = false;
	picking = false;
}
/** A tap with no answer (a dropped link, a host changing hands) must not leave the table dead. */
function watchLost(n) {
	clearTimeout(lostTimer);
	lostTimer = setTimeout(() => {
		if ((!tumbling && !picking) || shownN !== n) return;
		stopTumbling();
		die.classList.remove("tumbling");
		showFace(face);
		said.replaceChildren(document.createTextNode("That did not go through."), el("small", "", "Tap again."));
		render();
	}, LOST_MS);
}
function roll() {
	if (!myTurn() || view.stage !== "roll" || tumbling || busy()) return;
	tumbling = true;
	die.classList.add("tumbling");
	dieColour(view.you);
	renderDie();
	arcade.act({ roll: true });
	watchLost(shownN);
	paint();
}
function pick(move) {
	if (!myTurn() || view.stage !== "move" || picking) return;
	picking = true;
	arcade.act({ owner: move.owner, token: move.token });
	placeTargets();
	watchLost(shownN);
}
die.addEventListener("click", roll);
addEventListener("keydown", (e) => {
	if (e.target instanceof Element && e.target.closest("button") && (e.key === " " || e.key === "Enter")) return;
	if ((e.key === "r" || e.key === "R" || e.key === " " || e.key === "Enter") && myTurn() && view.stage === "roll") {
		e.preventDefault();
		roll();
	} else if (/^[1-9]$/.test(e.key) && targets[Number(e.key) - 1]) {
		e.preventDefault();
		pick(targets[Number(e.key) - 1].move);
	}
});

// ---------------------------------------------------------------- setup

let lastSetup = "";
function renderSetup() {
	const on = view?.phase === "setup";
	setup.hidden = !on;
	if (!on) {
		lastSetup = "";
		return;
	}
	const host = arcade.isHost();
	const names = view.seats.map((_, i) => who(i));
	const key = JSON.stringify([view.board, view.mode, view.arms, view.teams, host, arcade.party?.host, names]);
	if (key === lastSetup) return;
	lastSetup = key;
	const parts = [el("h2", null, "LUDO")];
	const boardLabel = `${view.board}-player board`;
	const modeLabel = { ffa: "free-for-all", pairs: view.board === 4 ? "2 v 2" : "3 teams of 2", trios: "2 teams of 3" }[view.mode];
	if (host) {
		parts.push(el("p", null, "A 6 to leave the yard, a 6 rolls again. Land on a token to send it home; stars are safe."));
		const boards = el("div", "lu-choice");
		boards.setAttribute("role", "group");
		boards.setAttribute("aria-label", "Board");
		for (const b of [4, 6]) {
			const btn = el("button", "neon-btn", `${b}-PLAYER BOARD`);
			btn.type = "button";
			btn.dataset.board = String(b);
			btn.setAttribute("aria-pressed", String(view.board === b));
			btn.disabled = !view.boards.includes(b);
			btn.onclick = () => arcade.act({ board: b });
			boards.append(btn);
		}
		const modes = el("div", "lu-choice");
		modes.setAttribute("role", "group");
		modes.setAttribute("aria-label", "Mode");
		const offered = [["ffa", "FREE-FOR-ALL"], ["pairs", view.board === 4 ? "2 V 2" : "TEAMS OF 2"], ...(view.board === 6 ? [["trios", "TEAMS OF 3"]] : [])];
		for (const [mode, label] of offered) {
			const btn = el("button", "neon-btn", label);
			btn.type = "button";
			btn.dataset.mode = mode;
			btn.setAttribute("aria-pressed", String(view.mode === mode));
			btn.disabled = !view.modes.includes(mode);
			btn.onclick = () => arcade.act({ mode });
			modes.append(btn);
		}
		parts.push(boards, modes);
		if (view.modes.length === 1) parts.push(el("p", null, view.board === 4 ? "Teams: four players on the 4-player board." : "Teams: six players on the 6-player board."));
	} else {
		const hostName = arcade.party?.members?.find((p) => p.id === arcade.party?.host)?.name || "The host";
		parts.push(el("p", null, `${hostName} is setting up: the ${boardLabel}, ${modeLabel}.`));
	}
	if (teamsOn()) {
		const list = el("div", "lu-teams");
		const ts = [...new Set(view.teams)].sort();
		for (const t of ts) {
			const row = el("span");
			row.append(el("b", null, `TEAM ${TEAM_NAMES[t]}:`));
			view.seats.forEach((_, i) => {
				if (view.teams[i] !== t) return;
				row.append(tokenIcon(i), document.createTextNode(who(i)));
			});
			list.append(row);
		}
		parts.push(list);
	}
	if (host) {
		const go = el("div", "lu-choice");
		if (teamsOn()) {
			const mix = el("button", "neon-btn lu-mix", "MIX TEAMS");
			mix.type = "button";
			mix.onclick = () => arcade.act({ mix: true });
			go.append(mix);
		}
		const start = el("button", "neon-btn neon-btn--accent lu-start", "START");
		start.type = "button";
		start.onclick = () => arcade.act({ start: true });
		go.append(start);
		parts.push(go);
	}
	setup.replaceChildren(...parts);
}

// ------------------------------------------------------------------ views

function render() {
	renderStatus();
	renderPlayers();
	renderDie();
	renderSetup();
	placeTargets();
}

arcade.on("view", ({ state }) => {
	const before = view;
	view = state;
	// The table played, remembered on the host's device for its next card tap.
	if (state.phase === "play" && arcade.isHost()) {
		const table = { n: state.seats.length, board: state.board, mode: state.mode };
		if (JSON.stringify(table) !== JSON.stringify(lastTable)) {
			lastTable = table;
			arcade.send("store.set", { key: "table", value: table });
		}
	}
	const reshaped = !before || before.board !== state.board || before.arms.join() !== state.arms.join() || before.you !== state.you;
	if (!before || before.match !== state.match || state.phase !== "play" || before.phase !== "play" || !state.last || state.last.n < shownN) {
		// A new match, a first view, the setup or a jump back: draw it as it stands.
		queue = [];
		anim = null;
		stopTumbling();
		die.classList.remove("tumbling");
		shown = clone(state.tokens);
		shownN = state.last?.n ?? 0;
		showFace(state.last?.roll || face);
		if (state.phase === "play" && (!before || before.phase !== "play" || before.match !== state.match)) said.replaceChildren(document.createTextNode(state.last ? "" : "A 6 brings a token out."), el("small", "", "Land on a token to send it home. Stars are safe."));
	} else if (state.last.n > shownN) {
		if (state.last.seat === state.you) {
			clearTimeout(lostTimer); // ours arrived
			picking = false;
		}
		// Every event since the last one drawn, in order (a bot's turn is several).
		const fresh = (state.log ?? [state.last]).filter((e) => e.n > shownN);
		if (fresh[0]?.n !== shownN + 1 || reduced.matches || document.hidden || queue.length + fresh.length > QUEUE_MAX) {
			// Further behind than the log reaches (a reconnect), no motion
			// wanted, a hidden tab (it draws nothing), or far behind: jump.
			queue = [];
			anim = null;
			shown = clone(state.tokens);
			stopTumbling();
			die.classList.remove("tumbling");
			showFace(state.last.roll);
			tell(state.last);
			moves += fresh.length || 1;
		} else {
			// Each event's board after it, from the one before: the last is the view's own.
			let board = clone(queue.length ? queue[queue.length - 1].after : anim ? anim.after : shown);
			for (const ev of fresh) {
				board = clone(board);
				if (ev.move) {
					for (const [seat, k] of ev.move.caps ?? []) board[seat][k] = -1;
					board[ev.move.owner][ev.move.token] = ev.move.to;
				}
				queue.push({ ev: clone(ev), after: ev.n === state.last.n ? clone(state.tokens) : board });
			}
		}
		shownN = state.last.n;
	} else if (!busy()) shown = clone(state.tokens);
	if (shown.length !== state.tokens.length) shown = clone(state.tokens);
	if (!busy()) {
		tumbling = tumbling && state.turn === state.you && state.stage === "roll";
		arcade.idle?.();
	}
	if (reshaped) layout();
	render();
	paint();
});
// Back from hidden with moves still waiting (a tab switched away mid-move): show where things are.
document.addEventListener("visibilitychange", () => {
	if (document.hidden || !view || !busy()) return;
	queue = [];
	anim = null;
	shown = clone(view.tokens);
	stopTumbling();
	die.classList.remove("tumbling");
	if (view.last) {
		showFace(view.last.roll);
		tell(view.last);
	}
	arcade.idle?.();
	render();
	paint();
});
arcade.on("rejected", (m) => {
	stopTumbling();
	die.classList.remove("tumbling");
	said.replaceChildren(document.createTextNode(m.reason));
	render();
});
arcade.on("roster", () => {
	lastSetup = "";
	render();
});
arcade.on("theme.set", () => {
	layerKey = "";
	lastSetup = "";
	render();
	paint();
});
addEventListener("resize", layout);
const ro = new ResizeObserver(layout);
ro.observe(stage);
ro.observe(playersEl);
arcade.init.then(layout);

/**
 * For the tests: the view, what is drawn (`shown`, `moves`), whether an event
 * is playing, the rings on show in the frame's CSS px, the square size.
 */
arcade.debug = () => {
	const r = canvas.getBoundingClientRect();
	return {
		...(view ?? { seats: [], tokens: [], phase: null, over: false }),
		shown: clone(shown),
		shownN,
		moves,
		busy: busy(),
		tumbling,
		picking,
		myTurn: myTurn(),
		cell: cellPx,
		rot,
		drawn: clone(drawn),
		targets: targets.map((t) => ({ x: r.left + t.x, y: r.top + t.y, owner: t.move.owner, token: t.move.token, away: Math.hypot(t.x - t.tx, t.y - t.ty) >= 6 })),
		setupOpen: !setup.hidden,
	};
};
