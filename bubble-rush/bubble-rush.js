// bubble-rush/bubble-rush.js — Bubble Rush. An SDK v2 managed game, ticking.
//
// The round is bubble-rush-rules.js `game()`: the platform steps it on the
// host 10 times a second (its "tick") with the bots' taps, judges every
// person's tap against the host's own bubbles (`apply`), sends each phone the
// field, pauses everyone while the host is out of the app, reports each round
// and draws the end card — PLAY AGAIN is the next round, its mode picked
// again here first. This file is the field: it draws every bubble from its
// own copy of the round clock at the screen's frame rate, and sends taps.
//
// ## The clock on a phone
//
// Each view carries the host's round time. Between views the phone carries it
// forward on its own clock, but never more than EXTRA_MS past the last view
// (so a pause, or a dropped link, freezes the field instead of letting it run
// on), and never backwards by a small step (a late view would make every
// bubble twitch down). A tap carries the time it was drawn at: that is what
// the host judges it against.

const R = bubbleRushRules;
const { ROUND_MS, FRENZY_MS } = R;

// The host and the sides are the party's, read from this frame's copy of it:
// the rules only run live on the host's phone, where that copy is the host's.
arcade.managed(
	R.game({
		isHost: (id) => id === arcade.party?.host,
		sideOf: (id) => arcade.party?.members.find((m) => m.id === id)?.team ?? null,
	}),
);

const EXTRA_MS = 250; // how far past the last view this phone's clock may run (rules AHEAD_MS matches it)
const HIDE_MAX_MS = 3000; // a popped bubble stays hidden until the host's word; this long at most, if it is lost
const TAP_MIN_MS = 80; // one finger, one tap: a bounce is not a second one

// ------------------------------------------------------------------ chrome

const style = document.createElement("style");
style.textContent = `
	html, body { margin: 0; height: 100%; overflow: hidden; background: var(--bg); color: var(--ink); }
	/* The top 52px band is the shell's (portal link left, game buttons right). */
	.g-stage { position: absolute; inset: 0; display: flex; flex-direction: column; gap: 8px; box-sizing: border-box;
		padding: calc(env(safe-area-inset-top) + 56px) max(12px, env(safe-area-inset-right))
			max(12px, env(safe-area-inset-bottom)) max(12px, env(safe-area-inset-left));
		font-family: var(--font-body); }
	.br-hud { display: flex; flex-direction: column; gap: 6px; font-size: 0.9rem; }
	.br-row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
	.br-clock { font-family: var(--font-mono); font-weight: bold; letter-spacing: 0.04em; white-space: nowrap; }
	.br-clock.is-frenzy { color: var(--danger); }
	.br-me { font-family: var(--font-mono); color: var(--ink-2); white-space: nowrap; }
	.br-mult { font-weight: bold; color: var(--accent); margin-left: 6px; }
	.br-bar { height: 4px; border-radius: 2px; background: var(--rule); overflow: hidden; }
	.br-bar > div { height: 100%; background: var(--accent); }
	.br-bar.is-frenzy > div { background: var(--danger); }
	.br-board { display: flex; flex-wrap: wrap; gap: 4px 10px; min-height: 1.3em; font-size: 0.78rem; }
	.br-chip { font-family: var(--font-mono); white-space: nowrap; }
	.br-chip.is-me { font-weight: bold; text-decoration: underline; }
	/* The field is always 1 : 2 (rules FIELD_ASPECT), letterboxed into the room there is. */
	.br-field { position: relative; flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; }
	.br-field canvas { display: block; box-sizing: content-box; flex: none;
		border: 2px solid var(--rule); border-radius: 10px; background: var(--surface-2);
		touch-action: none; user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; }
	.br-setup { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
		gap: 14px; padding: 20px; box-sizing: border-box; text-align: center; border-radius: 10px;
		background: color-mix(in oklch, var(--bg) 82%, transparent); }
	.br-setup[hidden] { display: none; }
	.br-setup h2 { margin: 0; font-family: var(--font-display); font-size: 1.6rem; letter-spacing: 0.04em; color: var(--accent); }
	.br-setup p { margin: 0; max-width: 30em; color: var(--ink-2); line-height: 1.4; }
	.br-modes { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
	.br-setup .neon-btn { min-height: 44px; min-width: 44px; }
	/* A choice of two: the one not picked is an outline, so the pick reads at a glance. */
	.br-modes .neon-btn { border: 2px solid var(--accent); }
	.br-modes .neon-btn[aria-pressed="false"]:not(:disabled) { background: transparent; color: var(--accent); }
	.br-modes .neon-btn:disabled { border-color: var(--rule); }
`;
document.head.append(style);

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
};

const stage = el("div", "g-stage");
const hud = el("div", "br-hud");
const row = el("div", "br-row");
const hudClock = el("span", "br-clock");
const hudMeWrap = el("span");
const hudMe = el("span", "br-me");
const hudMult = el("span", "br-mult");
hudMeWrap.append(hudMe, hudMult);
row.append(hudClock, hudMeWrap);
const bar = el("div", "br-bar");
const barFill = el("div");
bar.append(barFill);
const board = el("div", "br-board");
board.setAttribute("aria-label", "Scores");
hud.append(row, bar, board);
const field = el("div", "br-field");
const canvas = el("canvas");
canvas.setAttribute("aria-label", "The field: tap a bubble to pop it");
const setup = el("div", "br-setup");
setup.hidden = true;
setup.setAttribute("role", "dialog");
setup.setAttribute("aria-label", "Bubble Rush: the next round");
field.append(canvas, setup);
stage.append(hud, field);
document.body.append(stage);
const c2d = canvas.getContext("2d");
const reduced = matchMedia("(prefers-reduced-motion: reduce)");

// ------------------------------------------------------------------ state

let view = null; // the host's last word (bubble-rush-rules.js view)
let bubbles = []; // view.bubbles, unpacked
let recvAt = 0; // performance.now() when `view` came
let clockT = 0; // the round time this phone last drew
let paused = false; // the host is out of the app (the platform's `paused`)
let lastSeq = -1; // the last pop shown as an effect
let lastMatch = null;
let lastTap = 0;
const hidden = new Map(); // bubble id -> { at, n }: popped here by tap n, until the host's word
let tapN = 0; // numbers this phone's taps: the host's view says which it has judged
let effects = []; // { x, y, at, text?, ring?, flash?, r, colour }

const me = () => view?.you ?? null;
const seats = () => view?.seats ?? [];
const nameOf = (id) => arcade.party?.members.find((m) => m.id === id)?.name ?? "Player";
const seatIndex = (id) => seats().findIndex(([sid]) => sid === id);
const teamOf = (id) => seats().find(([sid]) => sid === id)?.[1] ?? null;
const side = (team) => seats().filter(([, t]) => t === team).map(([id]) => id);
const modeLabel = (mode) => (mode === "teams" ? "TEAMS" : "FREE-FOR-ALL");
const live = () => view && (view.phase === "count" || view.phase === "play");

/** A player's streak at round time `t`, from the view's [streak, lastPop]. */
function streakAt(id, t) {
	const [streak, last] = view?.st?.[id] ?? [0, null];
	return last === null || t - last > R.STREAK_MS ? 0 : streak;
}

/** The round time to draw now. */
function now() {
	if (!view) return 0;
	if (!live()) return view.t;
	if (paused) return clockT;
	const target = view.t + Math.min(EXTRA_MS, performance.now() - recvAt);
	// Forward freely; backwards only for a real jump (a takeover, a long stall).
	if (target >= clockT || clockT - target > 300) clockT = target;
	return clockT;
}

// ------------------------------------------------------------------ colour

const tokens = () => arcade.theme?.tokens ?? {};
const alpha = (rgba, a) => (typeof rgba === "string" ? rgba.replace(/,\s*[\d.]+\)$/, `, ${a})`) : rgba);
const glows = () => !/,\s*0\)$/.test(tokens().glow ?? ", 0)");
/** A theme colour: a token name or a seat index. */
function colour(name, a = 1) {
	const c = typeof name === "number" ? arcade.theme?.players[name % 8] : tokens()[name];
	return alpha(c ?? tokens().ink, a);
}
/** What a player is drawn in: their side's colour in TEAMS, their seat's otherwise. */
function colourOf(id) {
	if (view?.mode === "teams") return teamOf(id) === "B" ? "accent2" : "accent";
	const i = seatIndex(id);
	return i < 0 ? "ink2" : i;
}
/** A bubble's own colour: its team's in TEAMS, its size's in free-for-all. */
function bubbleColour(b) {
	if (b.k === "g") return "warn";
	if (b.k === "x") return "danger";
	if (b.team) return b.team === "A" ? "accent" : "accent2";
	return b.pts >= 30 ? "good" : b.pts >= 20 ? "accent2" : "accent";
}

// ---------------------------------------------------------------- drawing

/** The field's size in CSS pixels. */
const size = () => ({ w: canvas.clientWidth, h: canvas.clientHeight });

/** Size the field: the largest 1 : 2 box the room allows, in whole CSS pixels. */
function fit() {
	const room = { w: field.clientWidth - 4, h: field.clientHeight - 4 }; // less the canvas's 2px border
	const w = Math.max(1, Math.floor(Math.min(room.w, room.h * R.FIELD_ASPECT)));
	const h = Math.max(1, Math.floor(w / R.FIELD_ASPECT));
	if (canvas.style.width !== `${w}px`) canvas.style.width = `${w}px`;
	if (canvas.style.height !== `${h}px`) canvas.style.height = `${h}px`;
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	const W = Math.max(1, Math.round(w * dpr));
	const H = Math.max(1, Math.round(h * dpr));
	if (canvas.width !== W || canvas.height !== H) {
		canvas.width = W;
		canvas.height = H;
	}
	c2d.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** A bubble's place and radius on this canvas, in CSS pixels. */
function onScreen(b, t, f = size()) {
	const p = R.position(b, t);
	return { px: p.x * f.w, py: p.y * f.h, pr: b.r * f.w };
}

/** Popped here and not yet settled by the host (its view drops the bubble, or acknowledges the tap). */
const isHidden = (id, at = performance.now()) => hidden.has(id) && at - hidden.get(id).at < HIDE_MAX_MS;

function drawBubble(b, s, t) {
	const name = bubbleColour(b);
	const still = reduced.matches;
	c2d.save();
	if (b.k === "x") {
		// Spikes, so a bomb reads as one before its colour does.
		c2d.strokeStyle = colour(name, 0.9);
		c2d.lineWidth = 2;
		c2d.beginPath();
		const spin = still ? 0 : t / 900;
		for (let i = 0; i < 10; i++) {
			const a = spin + (i / 10) * Math.PI * 2;
			c2d.moveTo(s.px + Math.cos(a) * s.pr * 0.8, s.py + Math.sin(a) * s.pr * 0.8);
			c2d.lineTo(s.px + Math.cos(a) * s.pr * 1.3, s.py + Math.sin(a) * s.pr * 1.3);
		}
		c2d.stroke();
	}
	c2d.shadowBlur = glows() ? 14 : 0;
	c2d.shadowColor = colour(name, 0.8);
	c2d.fillStyle = colour(name, b.k === "x" ? 0.35 : 0.18);
	c2d.strokeStyle = colour(name, 0.9);
	c2d.lineWidth = 2;
	c2d.beginPath();
	c2d.arc(s.px, s.py, s.pr, 0, Math.PI * 2);
	c2d.fill();
	c2d.stroke();
	c2d.shadowBlur = 0;
	// The glint that makes it a bubble rather than a disc.
	c2d.strokeStyle = colour(name, 0.7);
	c2d.lineWidth = Math.max(1.5, s.pr * 0.12);
	c2d.beginPath();
	c2d.arc(s.px, s.py, s.pr * 0.68, Math.PI * 1.1, Math.PI * 1.45);
	c2d.stroke();
	if (b.k === "g") {
		// Sparkles around it (turning, unless motion is reduced).
		c2d.fillStyle = colour(name, 0.9);
		for (let i = 0; i < 4; i++) {
			const a = (still ? 0 : t / 400) + (i / 4) * Math.PI * 2;
			const d = s.pr * 1.35;
			c2d.beginPath();
			c2d.arc(s.px + Math.cos(a) * d, s.py + Math.sin(a) * d, 2, 0, Math.PI * 2);
			c2d.fill();
		}
	}
	c2d.restore();
}

function effectFor(ev) {
	const at = performance.now();
	const name = ev.kind === "bomb" ? "danger" : ev.k === "g" ? "warn" : colourOf(ev.by);
	const text = ev.kind === "bomb" ? `${ev.pts}` : ev.kind === "deny" ? "DENIED" : `+${ev.pts}${ev.mult > 1 ? ` ×${ev.mult}` : ""}`;
	effects.push({ x: ev.x, y: ev.y, at, ring: true, r: ev.r, colour: name });
	effects.push({ x: ev.x, y: ev.y, at, text, colour: name });
	if (ev.kind === "bomb" && ev.by === me() && !reduced.matches) effects.push({ at, flash: true });
}

const LIFE = { text: 900, flash: 300, ring: 400 };
const lifeOf = (e) => (e.text ? LIFE.text : e.flash ? LIFE.flash : LIFE.ring);

function draw() {
	fit();
	const f = size();
	const t = now();
	const at = performance.now();
	const still = reduced.matches;
	c2d.clearRect(0, 0, f.w, f.h);
	if (!view || !arcade.theme) return;
	const font = (px, weight = "bold") => `${weight} ${px}px ${arcade.theme.fonts?.display || "sans-serif"}`;

	const frenzy = view.phase === "play" && t >= ROUND_MS - FRENZY_MS;
	if (frenzy) {
		c2d.strokeStyle = colour("danger", still ? 0.45 : 0.35 + 0.25 * Math.sin(at / 120));
		c2d.lineWidth = 6;
		c2d.strokeRect(3, 3, f.w - 6, f.h - 6);
	}

	if (view.phase === "play" || view.phase === "over") {
		for (const b of bubbles) {
			if (isHidden(b.id, at) || !R.alive(b, t)) continue;
			drawBubble(b, onScreen(b, t, f), t);
		}
	}

	// Pops: a ring, and the score rising off it. Reduced motion: no growth or rise, a fade.
	effects = effects.filter((e) => at - e.at < lifeOf(e));
	for (const e of effects) {
		const age = (at - e.at) / lifeOf(e);
		if (e.flash) {
			c2d.fillStyle = colour("danger", 0.25 * (1 - age));
			c2d.fillRect(0, 0, f.w, f.h);
		} else if (e.ring) {
			const r = e.r * Math.min(f.w, f.h) * (still ? 1 : 1 + age * 0.9);
			c2d.strokeStyle = colour(e.colour, 0.8 * (1 - age));
			c2d.lineWidth = 3 * (1 - age) + 1;
			c2d.beginPath();
			c2d.arc(e.x * f.w, e.y * f.h, r, 0, Math.PI * 2);
			c2d.stroke();
		} else {
			c2d.font = font(15);
			c2d.textAlign = "center";
			c2d.textBaseline = "middle";
			c2d.fillStyle = colour(e.colour, 1 - age * age);
			c2d.fillText(e.text, e.x * f.w, e.y * f.h - (still ? 0 : age * 40));
		}
	}

	c2d.textAlign = "center";
	c2d.textBaseline = "middle";
	const mine = me();
	if (paused && live()) {
		c2d.fillStyle = colour("bg", 0.5);
		c2d.fillRect(0, 0, f.w, f.h);
		c2d.font = font(22);
		c2d.fillStyle = colour("ink2");
		c2d.fillText("PAUSED", f.w / 2, f.h / 2);
	} else if (view.phase === "count") {
		c2d.font = font(Math.min(f.w, f.h) * 0.3);
		c2d.fillStyle = colour("accent");
		c2d.fillText(String(Math.max(1, Math.ceil(-t / 1000))), f.w / 2, f.h / 2);
		c2d.font = font(14, "normal");
		c2d.fillStyle = colour("ink2");
		c2d.fillText(modeLabel(view.mode), f.w / 2, f.h / 2 + Math.min(f.w, f.h) * 0.2);
	} else if (view.phase === "play" && mine && stunLeft(mine, t) > 0) {
		c2d.fillStyle = colour("danger", 0.12);
		c2d.fillRect(0, 0, f.w, f.h);
		c2d.font = font(22);
		c2d.fillStyle = colour("danger");
		c2d.fillText("STUNNED", f.w / 2, f.h / 2);
	} else if (frenzy) {
		c2d.font = font(16);
		c2d.fillStyle = colour("danger", 0.8);
		c2d.fillText("FRENZY", f.w / 2, 22);
	}
}

/** How long `id` stays stunned at round time `t`, from the view. */
function stunLeft(id, t) {
	const left = view?.stun?.[id];
	return left ? left - (t - view.t) : 0;
}

// -------------------------------------------------------------------- HUD

let lastBoard = "";
function renderHud() {
	if (!view) return;
	const t = now();
	const left = view.phase === "play" ? Math.max(0, ROUND_MS - t) : view.phase === "over" ? 0 : ROUND_MS;
	const frenzy = view.phase === "play" && left <= FRENZY_MS;
	const clockText = `${modeLabel(view.mode)} · ${Math.ceil(left / 1000)}s`;
	if (hudClock.textContent !== clockText) hudClock.textContent = clockText;
	hudClock.classList.toggle("is-frenzy", frenzy);
	bar.classList.toggle("is-frenzy", frenzy);
	barFill.style.width = `${(left / ROUND_MS) * 100}%`;

	const mine = me();
	const meText = mine ? String(view.scores[mine] ?? 0) : "WATCHING";
	const multText = mine && view.phase === "play" ? `×${R.multiplier(streakAt(mine, t))}` : "";
	if (hudMe.textContent !== meText) hudMe.textContent = meText;
	if (hudMult.textContent !== multText) hudMult.textContent = multText;

	// The scoreboard changes only when someone scores; rebuilt only then.
	const key = JSON.stringify([view.mode, view.scores, view.seats, mine, arcade.theme?.name, arcade.party?.members.length]);
	if (key === lastBoard) return;
	lastBoard = key;
	const chip = (text, name, isMe) => {
		const span = el("span", "br-chip" + (isMe ? " is-me" : ""), text);
		span.style.color = colour(name);
		return span;
	};
	if (view.mode === "teams") {
		const a = side("A");
		const b = side("B");
		const ts = view.avg ?? R.teamScores(view.scores, a, b);
		const [ta, tb] = R.averages(ts.A, ts.B);
		board.replaceChildren(chip(`TEAM A ${ta} (${a.length})`, "accent", teamOf(mine) === "A"), chip(`TEAM B ${tb} (${b.length})`, "accent2", teamOf(mine) === "B"));
	} else {
		const ids = seats().map(([id]) => id);
		const order = [...ids].sort((x, y) => (view.scores[y] ?? 0) - (view.scores[x] ?? 0));
		board.replaceChildren(...order.map((id) => chip(`${nameOf(id)} ${view.scores[id] ?? 0}`, ids.indexOf(id), id === mine)));
	}
}

// ---------------------------------------------------------- the next round

let lastSetup = "";
function renderSetup() {
	const on = view?.phase === "setup";
	setup.hidden = !on;
	if (!on) {
		lastSetup = "";
		return;
	}
	const host = arcade.isHost();
	const key = JSON.stringify([view.mode, view.teamsOk, host, arcade.party?.host, arcade.party?.members.length]);
	if (key === lastSetup) return;
	lastSetup = key;
	const h = el("h2", null, "BUBBLE RUSH");
	const p = el("p", null, "Pop bubbles. Small ones score most, gold more; dodge the spiky ones. A miss or a pause breaks your streak.");
	const parts = [h, p];
	if (host) {
		const modes = el("div", "br-modes");
		modes.setAttribute("role", "group");
		modes.setAttribute("aria-label", "Mode");
		for (const [mode, label] of [
			["ffa", "FREE-FOR-ALL"],
			["teams", "TEAMS"],
		]) {
			const btn = el("button", "neon-btn", label);
			btn.type = "button";
			btn.dataset.mode = mode;
			btn.setAttribute("aria-pressed", String(view.mode === mode));
			btn.disabled = mode === "teams" && !view.teamsOk;
			btn.onclick = () => arcade.act({ mode });
			modes.append(btn);
		}
		parts.push(modes);
		if (!view.teamsOk) parts.push(el("p", null, "For TEAMS, put players on Team A and Team B in the party."));
		const start = el("button", "neon-btn neon-btn--accent br-start", "START");
		start.type = "button";
		start.onclick = () => arcade.act({ start: true });
		parts.push(start);
	} else {
		parts.push(el("p", null, `${modeLabel(view.mode)} — waiting for ${nameOf(arcade.party?.host)} to start…`));
	}
	setup.replaceChildren(...parts);
}

// ------------------------------------------------------------------ input

canvas.addEventListener("pointerdown", (e) => {
	e.preventDefault();
	const mine = me();
	if (!mine || view?.phase !== "play" || paused) return;
	const at = performance.now();
	if (at - lastTap < TAP_MIN_MS) return;
	lastTap = at;
	const t = now();
	if (stunLeft(mine, t) > 0) return;
	// The content box: the bounding rect includes the canvas's border.
	const rect = canvas.getBoundingClientRect();
	const f = size();
	const x = (e.clientX - rect.left - canvas.clientLeft) / f.w;
	const y = (e.clientY - rect.top - canvas.clientTop) / f.h;
	const n = ++tapN;
	// Popped here at once; the host's word confirms it, or the bubble comes back.
	const hit = R.hitTest(
		bubbles.filter((b) => !isHidden(b.id, at)),
		x,
		y,
		t,
	);
	if (hit) hidden.set(hit.id, { at, n });
	else effects.push({ x, y, at, ring: true, r: 0.03, colour: "rule" });
	const r4 = (v) => Math.round(v * 1e4) / 1e4;
	arcade.act({ tap: { x: r4(x), y: r4(y), t: Math.round(t), n } });
});

addEventListener("keydown", (e) => {
	if (view?.phase !== "setup" || !arcade.isHost()) return;
	if (e.code === "Space" || e.code === "Enter") {
		e.preventDefault();
		arcade.act({ start: true });
	}
});

// ------------------------------------------------------------------- loop

let raf = 0;
function frame() {
	raf = 0;
	draw();
	renderHud();
	// Only while something moves: a round on, or an effect fading.
	if ((live() && !paused) || effects.length) raf = requestAnimationFrame(frame);
}
const wake = () => {
	if (!raf) raf = requestAnimationFrame(frame);
};

function onView(next) {
	const fresh = next.match !== lastMatch || (view?.phase === "over" && next.phase !== "over");
	if (fresh) {
		lastMatch = next.match;
		hidden.clear();
		effects = [];
		lastSeq = next.phase === "setup" || next.phase === "count" ? 0 : next.seq;
		clockT = next.t;
	}
	// Joined mid-round, or a new host carrying on from an older copy (its
	// count is behind this phone's): no burst of old pops, none missed after.
	if (lastSeq < 0 || next.seq < lastSeq) lastSeq = next.seq;
	if (view && view.phase !== next.phase) clockT = next.t;
	view = next;
	recvAt = performance.now();
	bubbles = next.bubbles.map(R.unpack);
	for (const ev of next.events) if (ev.seq > lastSeq) effectFor(ev);
	lastSeq = Math.max(lastSeq, next.seq);
	// Settled: the bubble is gone (ours, or someone's), or the host judged the
	// tap that hid it and the bubble is still there (a miss, or refused).
	for (const [id, h] of hidden) if (!bubbles.some((b) => b.id === id) || (next.ack ?? 0) >= h.n) hidden.delete(id);
	renderSetup();
	wake();
}

addEventListener("resize", wake);
arcade.on("view", ({ state }) => onView(state));
arcade.on("roster", () => {
	lastBoard = "";
	renderSetup();
	wake();
});
arcade.on("paused", ({ on }) => {
	paused = !!on;
	recvAt = performance.now();
	wake();
});
arcade.on("theme.set", () => {
	lastBoard = "";
	wake();
});
reduced.addEventListener?.("change", wake);
arcade.init.then(wake);

/** For the tests: the round as this phone sees it, bubbles where they are on the canvas now. */
arcade.debug = () => {
	const t = now();
	const f = size();
	const mine = me();
	return {
		phase: view?.phase ?? null,
		mode: view?.mode ?? null,
		match: view?.match ?? null,
		teamsOk: !!view?.teamsOk,
		t,
		you: mine,
		host: arcade.isHost(),
		paused,
		scores: { ...(view?.scores ?? {}) },
		teamScores: view?.avg ?? R.teamScores(view?.scores ?? {}, side("A"), side("B")),
		popped: { ...(view?.popped ?? {}) },
		misses: view?.mine?.misses ?? 0,
		ack: view?.ack ?? 0,
		taps: tapN,
		seq: view?.seq ?? 0,
		streak: mine ? streakAt(mine, t) : 0,
		stunned: mine ? stunLeft(mine, t) > 0 : false,
		field: f,
		bubbles: bubbles
			.filter((b) => R.alive(b, t) && R.surfaced(b, t) && !isHidden(b.id))
			.map((b) => ({ id: b.id, k: b.k, team: b.team, pts: b.pts, ...R.position(b, t), r: b.r, ...onScreen(b, t, f) })),
	};
};
