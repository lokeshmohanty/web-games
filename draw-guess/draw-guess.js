// draw-guess/draw-guess.js — Draw & Guess. An SDK v2 managed game, with a
// stream of strokes beside it.
//
// Free-for-all: everyone takes turns drawing while the rest guess. The rounds,
// the word, the guesses and the scores are draw-guess-rules.js `game()`, which
// the platform runs on the host: each phone gets its view (the drawer's has the
// word), the end card and PLAY AGAIN are the platform's, and the heir carries
// the game on — word and all — if the host leaves. Party spectators are left
// out of the drawing rotation but still see the board and the chat.
//
// The strokes are not state. The drawer streams them to everyone on a channel
// (SDK v2 Layer 1), stamped with the round they belong to, and each phone keeps
// the picture so far; the host replays it to anyone who comes back mid-round.
//
// No bots. A bot that draws would be replaying a canned doodle, and a bot that
// guesses would be reading the word it was already told — neither is an
// opponent, and both make the round worse for the people actually playing.

const { PHASES } = drawGuessRules;

const rules = drawGuessRules.game();
arcade.managed(rules);

const style = document.createElement("style");
style.textContent = `
      #game {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        /* Top padding clears the fixed "all games" pill; the canvas is flex:1
           so it simply takes the remaining height. */
        padding: 52px 8px 8px;
        gap: 8px;
        box-sizing: border-box;
      }
      #hud {
        display: flex;
        flex-wrap: wrap;
        gap: 8px 16px;
        align-items: center;
        justify-content: space-between;
        font-size: 0.85rem;
        min-height: 2.5em;
      }
      #hud .info {
        color: var(--accent);
        text-shadow: 0 0 6px var(--accent-glow);
      }
      #hud .scores {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
      }
      #hud .score-pill {
        background: var(--panel);
        border: 1px solid var(--border);
        border-radius: 20px;
        padding: 2px 12px;
        font-size: 0.8rem;
      }
      #hud .score-pill.me {
        border-color: var(--accent);
        box-shadow: 0 0 8px var(--accent-glow);
      }
      #hud .timer {
        font-size: 1.1rem;
        font-weight: bold;
        color: var(--accent2);
        text-shadow: 0 0 8px var(--glow);
      }
      #word-display {
        text-align: center;
        font-size: clamp(1.2rem, 4vw, 1.8rem);
        letter-spacing: 4px;
        color: var(--accent);
        text-shadow: 0 0 10px var(--accent-glow);
        min-height: 1.5em;
        font-weight: bold;
      }
      #canvas-wrap {
        flex: 1;
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 0;
      }
      #board {
        border: 2px solid var(--accent);
        border-radius: 8px;
        box-shadow: 0 0 20px var(--accent-glow);
        background: var(--surface-2);
        touch-action: none;
        max-width: 100%;
        max-height: 100%;
      }
      #tools {
        display: flex;
        gap: 6px;
        align-items: center;
        justify-content: center;
        flex-wrap: wrap;
        min-height: 2em;
      }
      /* 44px to tap (a thumb's floor): the colour is the inner 32px, inside
         a ring that shows which pen is in hand. */
      .swatch {
        width: 44px;
        height: 44px;
        padding: 3px;
        border-radius: 50%;
        border: 3px solid transparent;
        background-clip: content-box;
        cursor: pointer;
      }
      .swatch.active {
        border-color: var(--ink);
      }
      .size-btn {
        width: 44px;
        height: 44px;
        padding: 0;
        border-radius: 50%;
        border: 2px solid var(--border);
        background: var(--panel);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .size-btn.active {
        border-color: var(--accent);
      }
      .size-btn .dot {
        border-radius: 50%;
        background: var(--ink);
      }
      #clear-btn {
        font-size: 0.75rem;
        padding: 6px 12px;
        min-height: 44px;
      }
      #chat-area {
        height: 128px;
        display: flex;
        flex-direction: column;
        border: 1px solid var(--border);
        border-radius: 8px;
        background: var(--panel);
        overflow: hidden;
      }
      #chat-log {
        flex: 1;
        overflow-y: auto;
        padding: 6px 10px;
        font-size: 0.85rem;
        line-height: 1.4;
      }
      #chat-log .line {
        margin: 2px 0;
        word-break: break-word;
      }
      #chat-log .line.correct {
        color: var(--good);
        font-weight: bold;
      }
      #chat-log .line.system {
        color: var(--accent2);
        font-style: italic;
      }
      #chat-log .line .name {
        color: var(--accent);
      }
      #chat-input-row {
        display: flex;
        gap: 6px;
        padding: 6px;
        border-top: 1px solid var(--border);
      }
      #chat-input {
        flex: 1;
        background: var(--bg);
        border: 1px solid var(--border);
        border-radius: 6px;
        color: var(--ink);
        padding: 8px 12px;
        min-height: 44px;
        font-size: 0.9rem;
        font-family: var(--font);
      }
      #chat-input:focus {
        outline: none;
        border-color: var(--accent);
      }
      #chat-input:disabled {
        opacity: 0.5;
      }
      #chat-send {
        padding: 8px 16px;
        min-height: 44px;
      }
`;
document.head.append(style);

const markup = document.createElement("div");
markup.innerHTML = `<div id="game">
  <div id="hud"></div>
  <div id="word-display"></div>
  <div id="canvas-wrap">
    <canvas id="board"></canvas>
  </div>
  <div id="tools"></div>
  <div id="chat-area">
    <div id="chat-log"></div>
    <div id="chat-input-row">
      <input id="chat-input" type="text" placeholder="Type your guess…" autocomplete="off" maxlength="60" />
      <button id="chat-send" class="neon-btn">SEND</button>
    </div>
  </div>
</div>
<div id="overlay" class="overlay" hidden></div>`;
document.body.append(...markup.children);

// ── Config ──────────────────────────────────────────────
const CANVAS_W = 600;
const CANVAS_H = 400;
// Pens are the theme's colours, sent as an index so every phone draws a
// stroke in its own theme: "ink" reads on any board, light or dark.
const PENS = ["ink", 2, 3, 4, 1, 0]; // a token, or a player colour (0-based)
const penColor = (i) => {
	const t = arcade.theme;
	const k = PENS[i] ?? PENS[0];
	return typeof k === "string" ? t?.tokens[k] : t?.players[k];
};
const glows = () => !/,\s*0\)$/.test(arcade.theme?.tokens.glow ?? ", 0)");
const SIZES = [3, 6, 12];

// ── DOM ──────────────────────────────────────────────────
const hudEl = document.getElementById("hud");
const wordEl = document.getElementById("word-display");
const canvas = document.getElementById("board");
const c2d = canvas.getContext("2d");
const toolsEl = document.getElementById("tools");
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const chatSend = document.getElementById("chat-send");
const overlayEl = document.getElementById("overlay");
canvas.width = CANVAS_W;
canvas.height = CANVAS_H;

// ── State ────────────────────────────────────────────────
// `view` is the host's word on the game; the picture is this phone's own.
let view = { match: 0, phase: "choosing", round: 0, totalRounds: 0, drawer: null, hint: "", word: null, guessed: [], scores: {}, chat: [], players: [] };
let deadline = 0; // performance.now() when this phase ends, from the view's msLeft
let timeLeft = 0;
let chatSeen = 0; // the last chat line shown
let chatMatch = 0;
let drawPen = 1;
let drawSize = SIZES[1];
let drawing = false;
let lastPt = null;
let strokeThrottle = 0;
let pendingStrokes = [];
let canvasEpoch = -1; // which round's picture the canvas holds
// Every segment on the canvas since it was last cleared: for a theme change,
// and for replaying to a player who comes back mid-drawing.
const strokeLog = [];

const self = () => arcade.party?.self ?? null;
const phase = () => view.phase;
const amDrawer = () => view.drawer === self();
/** A round's picture: a newer round's stroke clears the old one. */
const epochOf = (v) => v.match * 1000 + v.round;

function nameOf(id) {
	const m = arcade.party?.members.find((x) => x.id === id);
	if (m?.name) return m.name;
	const i = view.players.indexOf(id);
	return i >= 0 ? `Player ${i + 1}` : String(id ?? "").slice(0, 6);
}

// ── Canvas ───────────────────────────────────────────────
function clearCanvas() {
	c2d.fillStyle = arcade.theme?.tokens.surface2 ?? "transparent"; // theme-exempt: before the theme arrives
	c2d.fillRect(0, 0, CANVAS_W, CANVAS_H);
	strokeLog.length = 0;
}

/** The picture again, in the current theme (strokes keep their pen). */
function repaint() {
	const all = strokeLog.slice();
	clearCanvas();
	for (const seg of all) drawSegment(seg);
}

function drawSegment(s) {
	strokeLog.push(s);
	const color = penColor(s.pen);
	c2d.strokeStyle = color;
	c2d.lineWidth = s.size;
	c2d.lineCap = "round";
	c2d.lineJoin = "round";
	c2d.shadowBlur = glows() ? 6 : 0;
	c2d.shadowColor = color;
	c2d.beginPath();
	c2d.moveTo(s.x0, s.y0);
	c2d.lineTo(s.x1, s.y1);
	c2d.stroke();
	c2d.shadowBlur = 0;
}

function drawDot(x, y, color, size) {
	c2d.fillStyle = color;
	c2d.shadowBlur = glows() ? 6 : 0;
	c2d.shadowColor = color;
	c2d.beginPath();
	c2d.arc(x, y, size / 2, 0, Math.PI * 2);
	c2d.fill();
	c2d.shadowBlur = 0;
}

/** Make the canvas round `e`'s: a fresh picture when that round is newer. */
function toEpoch(e) {
	if (e === canvasEpoch) return true;
	if (e < canvasEpoch) return false; // a straggler from a round that has gone
	canvasEpoch = e;
	clearCanvas();
	return true;
}

function pointerPos(e) {
	const rect = canvas.getBoundingClientRect();
	const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
	const cy = (e.touches ? e.touches[0].clientY : e.clientY) - rect.top;
	return { x: (cx / rect.width) * CANVAS_W, y: (cy / rect.height) * CANVAS_H };
}

// ── The stroke stream (SDK v2 Layer 1 channels) ──────────
const strokeCh = arcade.channel("stroke", (seg) => {
	if (seg && Number.isFinite(seg.e) && toEpoch(seg.e)) drawSegment(seg);
});
const clearCh = arcade.channel("clear", (d) => {
	if (Number.isFinite(d?.e) && d.e >= canvasEpoch) {
		canvasEpoch = d.e;
		clearCanvas();
	}
});
const replayCh = arcade.channel("strokes", (d, from) => {
	if (from !== arcade.party?.host || !Number.isFinite(d?.e)) return;
	if (d.first && d.e >= canvasEpoch) {
		canvasEpoch = d.e;
		clearCanvas();
	}
	if (d.e !== canvasEpoch) return;
	for (const seg of d.segs ?? []) drawSegment(seg);
});

function flushStrokes() {
	if (pendingStrokes.length === 0) return;
	for (const s of pendingStrokes) strokeCh.send(s);
	pendingStrokes = [];
}

/** Host: the canvas so far, to one player, in chunks a data channel takes. */
function replayTo(who) {
	const all = strokeLog.slice();
	for (let i = 0; i === 0 || i < all.length; i += 200) {
		replayCh.send({ first: i === 0, e: canvasEpoch, segs: all.slice(i, i + 200) }, who);
	}
}

function setupDrawing() {
	const onDown = (e) => {
		if (phase() !== "drawing" || !amDrawer()) return;
		e.preventDefault();
		toEpoch(epochOf(view));
		drawing = true;
		lastPt = pointerPos(e);
		drawDot(lastPt.x, lastPt.y, penColor(drawPen), drawSize);
		const dot = { e: canvasEpoch, x0: lastPt.x, y0: lastPt.y, x1: lastPt.x, y1: lastPt.y, pen: drawPen, size: drawSize };
		pendingStrokes.push(dot);
		strokeLog.push(dot);
	};
	const onMove = (e) => {
		if (!drawing) return;
		e.preventDefault();
		const pt = pointerPos(e);
		const seg = { e: canvasEpoch, x0: lastPt.x, y0: lastPt.y, x1: pt.x, y1: pt.y, pen: drawPen, size: drawSize };
		drawSegment(seg);
		pendingStrokes.push(seg);
		lastPt = pt;
		const now = performance.now();
		if (now - strokeThrottle > 33) {
			flushStrokes();
			strokeThrottle = now;
		}
	};
	const onUp = () => {
		if (!drawing) return;
		drawing = false;
		flushStrokes();
	};
	canvas.addEventListener("mousedown", onDown);
	canvas.addEventListener("mousemove", onMove);
	canvas.addEventListener("mouseup", onUp);
	canvas.addEventListener("mouseleave", onUp);
	canvas.addEventListener("touchstart", onDown, { passive: false });
	canvas.addEventListener("touchmove", onMove, { passive: false });
	canvas.addEventListener("touchend", onUp);
}

function setupTools() {
	toolsEl.replaceChildren();
	const pick = (cls, btn) => {
		toolsEl.querySelectorAll(cls).forEach((b) => {
			b.classList.toggle("active", b === btn);
			b.setAttribute("aria-pressed", String(b === btn));
		});
	};
	PENS.forEach((_, i) => {
		const sw = document.createElement("button");
		sw.type = "button";
		sw.className = "swatch" + (i === drawPen ? " active" : "");
		sw.setAttribute("aria-label", `Pen ${i + 1}`);
		sw.setAttribute("aria-pressed", String(i === drawPen));
		sw.style.backgroundColor = penColor(i); // not `background`: it would reset the clip
		sw.onclick = () => {
			drawPen = i;
			pick(".swatch", sw);
		};
		toolsEl.append(sw);
	});
	const sep = document.createElement("span");
	sep.style.width = "1px";
	sep.style.height = "24px";
	sep.style.background = "var(--border)";
	toolsEl.append(sep);
	SIZES.forEach((s) => {
		const btn = document.createElement("button");
		btn.type = "button";
		btn.className = "size-btn" + (s === drawSize ? " active" : "");
		btn.setAttribute("aria-label", `Brush ${s}px`);
		btn.setAttribute("aria-pressed", String(s === drawSize));
		const dot = document.createElement("div");
		dot.className = "dot";
		dot.style.width = s + "px";
		dot.style.height = s + "px";
		btn.append(dot);
		btn.onclick = () => {
			drawSize = s;
			pick(".size-btn", btn);
		};
		toolsEl.append(btn);
	});
	const sep2 = document.createElement("span");
	sep2.style.width = "1px";
	sep2.style.height = "24px";
	sep2.style.background = "var(--border)";
	toolsEl.append(sep2);
	const clearBtn = document.createElement("button");
	clearBtn.className = "neon-btn";
	clearBtn.id = "clear-btn";
	clearBtn.textContent = "CLEAR";
	clearBtn.onclick = () => {
		if (phase() === "drawing" && amDrawer()) {
			toEpoch(epochOf(view));
			clearCanvas();
			clearCh.send({ e: canvasEpoch });
		}
	};
	toolsEl.append(clearBtn);
}

// ── The screen ───────────────────────────────────────────
function updateHud() {
	hudEl.replaceChildren();
	const info = document.createElement("div");
	info.className = "info";
	const p = phase();
	if (p === "gameover") info.textContent = "GAME OVER";
	else if (view.totalRounds) info.textContent = `Round ${Math.min(view.round + 1, view.totalRounds)} / ${view.totalRounds}`;
	const timerEl = document.createElement("div");
	timerEl.className = "timer";
	if (p === "drawing" || p === "reveal") timerEl.textContent = timeLeft + "s";
	const scoresEl = document.createElement("div");
	scoresEl.className = "scores";
	const sorted = Object.entries(view.scores).sort((a, b) => b[1] - a[1]);
	for (const [id, sc] of sorted) {
		const pill = document.createElement("div");
		pill.className = "score-pill" + (id === self() ? " me" : "");
		pill.textContent = `${nameOf(id)}: ${sc}`;
		scoresEl.append(pill);
	}
	hudEl.append(info, timerEl, scoresEl);
}

function updateWordDisplay() {
	const p = phase();
	if (p === "drawing" && amDrawer()) {
		wordEl.textContent = (view.word ?? "").toUpperCase();
		wordEl.style.color = "var(--good)";
		wordEl.style.textShadow = "0 0 10px var(--glow)";
	} else if (p === "drawing") {
		wordEl.textContent = view.hint;
		wordEl.style.color = "var(--accent)";
		wordEl.style.textShadow = "0 0 10px var(--accent-glow)";
	} else if (p === "reveal" || p === "gameover") {
		wordEl.textContent = view.word ? view.word.toUpperCase() : "";
		wordEl.style.color = "var(--accent2)";
		wordEl.style.textShadow = "0 0 10px var(--glow)";
	} else {
		wordEl.textContent = "";
	}
}

function updateInputState() {
	const guessed = view.guessed.includes(self());
	const canGuess = phase() === "drawing" && !amDrawer() && !guessed;
	chatInput.disabled = !canGuess;
	chatInput.placeholder = canGuess ? "Type your guess…" : amDrawer() ? "You are drawing!" : guessed ? "You guessed it! 🎉" : "Waiting…";
	chatSend.disabled = !canGuess;
}

function addChatLine(name, text, kind) {
	const line = document.createElement("div");
	line.className = "line" + (kind ? " " + kind : "");
	if (kind === "correct") {
		line.textContent = `🎉 ${name} guessed it!`;
	} else if (kind === "system") {
		line.textContent = text;
	} else {
		const nameSpan = document.createElement("span");
		nameSpan.className = "name";
		nameSpan.textContent = name + ": ";
		line.append(nameSpan, document.createTextNode(text));
	}
	chatLog.append(line);
	chatLog.scrollTop = chatLog.scrollHeight;
}

/** The final scores, under the platform's end card (SEE THE BOARD shows them). */
function showGameOver() {
	overlayEl.replaceChildren();
	const h1 = document.createElement("h1");
	h1.textContent = "GAME OVER";
	overlayEl.append(h1);
	const sorted = Object.entries(view.scores).sort((a, b) => b[1] - a[1]);
	if (sorted.length) {
		const p = document.createElement("p");
		p.textContent = `${nameOf(sorted[0][0])} wins with ${sorted[0][1]} points!`;
		overlayEl.append(p);
	}
	if (!arcade.isHost()) {
		const b = document.createElement("button");
		b.className = "neon-btn";
		b.textContent = "HOST A NEW GAME";
		b.onclick = () => arcade.send("hostNew");
		overlayEl.append(b);
	}
	overlayEl.hidden = false;
}

function render() {
	updateHud();
	updateWordDisplay();
	updateInputState();
}

// ── The round clock ──────────────────────────────────────
// The host's page asks the rules to move on when a deadline passes; the rules
// refuse a move that is early or for a phase that has gone.
let clockTimer = null;
function driveClock() {
	clearTimeout(clockTimer);
	if (!arcade.isHost() || phase() === "gameover") return;
	const key = view.clock;
	clockTimer = setTimeout(() => arcade.act({ clock: key }), Math.max(0, deadline - performance.now()) + 30);
}
arcade.on("rejected", ({ a, reason }) => {
	if (a && "clock" in a && reason === "not yet" && a.clock === view.clock) clockTimer = setTimeout(() => arcade.act({ clock: a.clock }), 100);
});
setInterval(() => {
	const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
	if (left !== timeLeft) {
		timeLeft = left;
		updateHud();
	}
}, 200);

// ── The host's word ──────────────────────────────────────
function onView(next) {
	const prev = view;
	view = next;
	deadline = performance.now() + (next.msLeft ?? 0);
	timeLeft = Math.max(0, Math.ceil((next.msLeft ?? 0) / 1000));
	// A new game: a clean chat and canvas.
	if (next.match !== chatMatch) {
		chatMatch = next.match;
		chatSeen = 0;
		chatLog.replaceChildren();
		overlayEl.hidden = true;
	}
	for (const line of next.chat) {
		if (line.n <= chatSeen) continue;
		chatSeen = line.n;
		addChatLine(nameOf(line.id), line.text ?? "", line.kind === "correct" ? "correct" : "");
	}
	// The drawing starts on a clean canvas (or the drawer's first stroke got
	// here first and already cleared it).
	if (next.phase === "drawing") toEpoch(epochOf(next));
	if (next.phase === "gameover") showGameOver();
	else if (prev.phase === "gameover") overlayEl.hidden = true;
	render();
	driveClock();
}

// ── Guessing ─────────────────────────────────────────────
const sendGuess = () => {
	const text = chatInput.value.trim();
	if (!text) return;
	chatInput.value = "";
	arcade.act({ guess: text });
};
chatSend.onclick = sendGuess;
chatInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") sendGuess();
});

// ── The party's news ─────────────────────────────────────
arcade.on("view", ({ state }) => onView(state));
arcade.on("join", ({ who, info }) => {
	if (!arcade.isHost()) return;
	// The picture so far, to someone who (re)joined mid-round.
	if (phase() === "drawing" || phase() === "reveal") replayTo(who);
	if (!info?.back) addChatLine("", `${nameOf(who)} joined`, "system");
	updateHud();
});
arcade.on("leave", ({ who }) => {
	if (arcade.isHost()) addChatLine("", `${nameOf(who)} left`, "system");
	updateHud();
});
// The crown may move here: the clock is then this page's to drive.
arcade.on("roster", () => {
	driveClock();
	updateHud();
});
// A new theme: pens, swatches and the picture so far follow it.
arcade.on("theme.set", () => {
	setupTools();
	repaint();
});

arcade.init.then(() => {
	setupTools();
	setupDrawing();
	clearCanvas();
	render();
});

/** The live round, for the tests. */
arcade.debug = () => ({
	phase: view.phase,
	drawerId: view.drawer,
	scores: { ...view.scores },
	// As in v1: the host knows the word (it picked it); its live rules say so.
	word: view.word ?? (arcade.isHost() ? rules.hostWord() : null) ?? "",
	hint: view.hint,
	strokes: strokeLog.length,
});
