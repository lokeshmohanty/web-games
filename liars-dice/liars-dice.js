// liars-dice/liars-dice.js — Liar's Dice (Perudo). An SDK v2 game, on the
// protocol itself (Layer 1): hidden dice cannot be managed state.
//
// Five dice each, under a cup. A bid names a quantity and a face — "four
// fours" — and claims that many exist across *everyone's* dice. Each player in
// turn raises the bid or calls the last one a lie. When somebody calls, every
// cup lifts: if the bid was good the caller loses a die, otherwise the bidder
// does. Lose all five and you are out. **Ones are wild** and count as any face,
// which is why the numbers run higher than they look.
//
// ## Nobody deals
//
// The obvious build is that the host rolls everybody's dice and mails each
// player their own hand down a sealed channel. Do not do that: the host is a
// player, and a dealer who can read every cup is not a game of bluffing, it is
// a game with one person who cannot lose. A sealed message (the shell's
// `seal.send`) is sealed against the *peers relaying it*; it cannot seal
// anything against the sender — nor can managed state, which the host runs.
//
// So each player rolls **their own** dice, locally, and publishes a commitment
// to them before a single bid is made (the shell's `commit`). Nothing about
// anybody's hand crosses the wire until a call is made, and then everything
// does at once and every commitment is checked (`verify`). Same shape as
// battleship.js, same reason.
//
// A consequence worth stating: because the dice are self-rolled, a modified
// client could re-roll until it liked its hand. The commitment stops a player
// changing dice *after* seeing a bid, which is the cheat that decides rounds;
// it does not stop a biased roll, and nothing short of a shared random beacon
// would.
//
// ## Rounds
//
// The clock is the shell's (`timer.*`). Rolling is a `collect` phase —
// everyone commits at once, and it ends the moment they all have. Bidding is
// not, because it goes round the table; it runs as a long phase that `next`
// ends the instant somebody calls. Whose bid it is goes to the shell too
// (`wait.turn`), which says so when that player has gone quiet.


// ------------------------------------------------------------- the protocol
//
// The few things every v1 game had from its `ctx`, over the SDK v2 wire.

const isBot = (id) => typeof id === "string" && id.startsWith("bot_");
const self = () => arcade.party?.self ?? null;
const isHost = () => arcade.isHost();
const members = () => arcade.party?.members ?? [];
const nameOf = (id) => members().find((m) => m.id === id)?.name ?? "Player";
/** Everyone in a seat (not spectating), bots included, in join order. */
const players = () => members().filter((m) => m.team && m.team !== "spectator").map((m) => m.id);
const seatsOf = (team) => members().filter((m) => m.team === team).map((m) => m.id);

/**
 * The shell's round clock (`timer.*`, lib/rounds.js run by the shell). Every
 * phone opens the same clock and the host's runs it; the events come back as
 * the old callbacks did. `state()` is the last word on it, counted down here.
 */
function clock(name, { rounds = 1, phases, bots = false }, on) {
	let info = { round: 0, rounds, phase: null, index: 0, msLeft: 0, secondsLeft: 0, submitted: [], finished: false };
	let at = performance.now();
	let primed = false;
	const off = arcade.on("timer", (m) => {
		if (m.name !== name) return;
		info = m.info ?? info;
		at = performance.now();
		if (m.ev === "phase") {
			primed = true;
			info.finished = false;
			on.onPhase?.(info);
		} else if (m.ev === "tick") on.onTick?.(info);
		else if (m.ev === "finish") {
			info.finished = true;
			on.onFinish?.(info);
		} else if (m.ev === "collect") on.onCollect?.({ ...info, entries: new Map(Object.entries(m.entries ?? {})) });
		else if (m.ev === "bot") on.botSubmit?.(m.bot, info);
	});
	arcade.send("timer.open", { name, rounds, phases, bots });
	const op = (o, extra = {}) => arcade.send("timer.do", { name, op: o, ...extra });
	return {
		start: () => op("start"),
		submit: (value) => op("submit", { value }),
		submitFor: (bot, value) => op("submitFor", { bot, value }),
		next: () => op("next"),
		/** The crown moved here: run the clock from what this phone knew. False if there is nothing to run. */
		adopt(where = {}) {
			if (!primed || info.finished) return false;
			op("adopt", where);
			return true;
		},
		sync: () => op("sync"),
		close() {
			off();
			op("close");
		},
		state() {
			const msLeft = Math.max(0, (info.msLeft ?? 0) - (performance.now() - at));
			return { ...info, msLeft, secondsLeft: Math.ceil(msLeft / 1000) };
		},
	};
}

/** A commitment (the shell's `commit`): `{ digest, nonce, value }`, or null without WebCrypto. */
async function commit(value) {
	try {
		const { digest, nonce } = await arcade.request("commit", { value });
		return { digest, nonce, value };
	} catch {
		return null;
	}
}
const verify = ({ digest, nonce, value }) =>
	arcade.request("verify", { digest, nonce, value }).then((r) => !!r.valid, () => false);

// A reload keeps the seat but not the page: a commitment is kept in this tab's
// session (the shell's `session.*`), so a cup or a fleet committed before the
// reload can still be opened after it.
let session = {};
const keptKey = (key) => `kept.${self()}.${key}`;
const keep = (key, data) => {
	session[keptKey(key)] = JSON.stringify(data);
	arcade.send("session.set", { key: keptKey(key), value: session[keptKey(key)] });
};
const kept = (key) => {
	try {
		return JSON.parse(session[keptKey(key)] ?? "null");
	} catch {
		return null;
	}
};

// Whose move it is, for the shell's turn-wait banner (sent on change only).
let waitingOn;
const waitTurn = (who) => {
	if (who === waitingOn) return;
	waitingOn = who;
	arcade.send("wait.turn", { who });
};

// --------------------------------------------------------------- the chrome

const el = (tag, className, text) => {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text != null) node.textContent = text;
	return node;
};
const shellStyle = document.createElement("style");
shellStyle.textContent = `
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
	.g-hud .g-warn { color: var(--danger); text-shadow: 0 0 8px var(--glow); }
`;
document.head.append(shellStyle);
const stage = el("div", "g-stage");
const hud = el("div", "g-hud");
hud.setAttribute("role", "status");
hud.setAttribute("aria-live", "polite");
stage.append(hud);
document.body.append(stage);

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

const { DICE, FACES, bidBeats, raisesAfter, resolveCall, rollDice, botAction, nextOpener } = liarsDiceRules;
const PIPS = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

// ------------------------------------------------------------------- markup

const style = document.createElement("style");
style.textContent = `
	.ld-table { display: flex; flex-wrap: wrap; gap: 6px 12px; justify-content: center;
		font-size: 0.75rem; letter-spacing: 0.06em; }
	.ld-seat { display: flex; align-items: center; gap: 4px; color: var(--muted); }
	.ld-seat.turn { color: var(--accent); text-shadow: 0 0 8px var(--accent-glow); }
	.ld-seat.out { opacity: 0.4; text-decoration: line-through; }
	.ld-cups { letter-spacing: -0.1em; font-size: 0.95rem; color: var(--ink-3); }
	.ld-bid { font-size: clamp(1.4rem, 7vw, 2.1rem); text-align: center;
		color: var(--accent); text-shadow: 0 0 14px var(--accent-glow); min-height: 1.4em; }
	.ld-bid small { display: block; font-size: max(0.75rem, 0.42em); letter-spacing: 0.14em;
		color: var(--muted); text-shadow: none; }
	.ld-mine { display: flex; gap: 4px; justify-content: center; flex-wrap: wrap;
		font-size: clamp(2rem, 11vw, 3rem); line-height: 1; color: var(--ink); }
	.ld-mine .wild { color: var(--warn); }
	.ld-faces { display: flex; gap: 6px; justify-content: center; flex-wrap: wrap; }
	.ld-face { min-width: 46px; min-height: 46px; font-size: 1.5rem; line-height: 1;
		background: var(--panel); border: 2px solid var(--border); border-radius: 8px;
		color: var(--muted); cursor: pointer; }
	.ld-face.sel { border-color: var(--accent); color: var(--accent); }
	.ld-count { display: flex; gap: 8px; align-items: center; justify-content: center; }
	.ld-count button { min-width: 46px; min-height: 46px; font-size: 1.2rem;
		background: var(--panel); border: 2px solid var(--border); border-radius: 8px;
		color: var(--accent); cursor: pointer; }
	.ld-count span { font-size: 1.5rem; min-width: 2ch; text-align: center; color: var(--ink); }
	.ld-actions { display: flex; gap: 8px; justify-content: center; flex-wrap: wrap; }
	.ld-actions .neon-btn { padding: 11px 18px; font-size: 14px; min-height: 44px; }
	.ld-actions .liar { background: var(--danger); color: var(--on-accent); }
	.ld-reveal { display: flex; flex-direction: column; gap: 3px; align-items: center;
		font-size: 0.78rem; color: var(--muted); }
	.ld-reveal .row { display: flex; gap: 6px; align-items: center; }
	.ld-reveal .dice { font-size: 1.15rem; color: var(--ink); letter-spacing: -0.05em; }
	.ld-notice { font-size: 0.75rem; color: var(--warn); min-height: 1.2em; text-align: center; }
`;
document.head.append(style);

const fill = el("div", "g-fill");
const notice = el("div", "ld-notice");
const table = el("div", "ld-table");
const bidEl = el("div", "ld-bid");
const revealEl = el("div", "ld-reveal");
const mine = el("div", "ld-mine");
const faces = el("div", "ld-faces");
const count = el("div", "ld-count");
const actions = el("div", "ld-actions");
fill.append(notice, table, bidEl, revealEl, mine, faces, count, actions);
stage.append(fill);

// -------------------------------------------------------------------- state

let phase = "waiting"; // waiting | roll | bid | reveal | over
let seats = []; // [{ id, dice, out }]
let bid = null; // { count, face, by }
let turn = null;
let starter = null;
// Who opened this game's first round ({ id, at }): the next game opens with
// the seat after, so the same player does not always bid first. In every
// state message, so an heir's NEW GAME goes on round the table.
let opener = null;
let digests = {};
let reveals = {}; // id -> { hand, nonce }
let verdicts = {}; // id -> null (clean) | string
let lastCall = null; // { caller, bid, actual, bidderWasRight, loser }
let over = null; // { winner, match }
let matchNo = 0; // host: games started in this run
let reportedMatch = null;
let myHand = [];
let myCommit = null;
let botHands = {}; // botId -> { hand, commit } — held only by the host
let draftFace = 2;
let draftCount = 1;
let botTimer = null;

/** Tell the platform how it ended: the last cup standing, then the rest. */
function reportOver() {
	if (!over || reportedMatch === over.match) return;
	reportedMatch = over.match;
	const rest = seats.map((s) => s.id).filter((id) => id !== over.winner);
	const ranking = over.winner ? [[over.winner], rest].filter((s) => s.length) : [rest];
	if (ranking[0]?.length) arcade.result({ kind: "ffa", match: over.match ?? 1, ranking });
}

const seatOf = (id) => seats.find((s) => s.id === id) ?? null;
const alive = () => seats.filter((s) => !s.out);
const myDiceCount = () => seatOf(self())?.dice ?? 0;
const amPlaying = () => !!seatOf(self()) && !seatOf(self()).out;
const isMyTurn = () => phase === "bid" && turn === self() && amPlaying();
const totalDice = () => alive().reduce((n, s) => n + s.dice, 0);

const setNotice = (t) => {
	notice.textContent = t ?? "";
};

// ----------------------------------------------------------------- the wire

const publicState = () => ({
	seats, bid, turn, starter, opener, digests, over, lastCall, match: matchNo,
	reveals: phase === "reveal" || over ? reveals : {},
});

/**
 * Publish the state **and redraw our own screen**.
 *
 * The redraw is the part that is easy to leave out and hard to see: a guest
 * repaints because the state message tells it to, but the host sends that
 * message and never receives it. Publishing without redrawing left the host's
 * own UI frozen on the opening position — still offering the first legal bid
 * several bids later, with no LIAR button — and every move it then made was
 * silently refused as illegal.
 */
function pushState(to) {
	if (isHost()) stateCh.send(publicState(), to);
	render();
}

const stateCh = arcade.channel("ldState", (msg, from) => {
	if (isHost() || from !== arcade.party.host || !msg) return;
	seats = msg.seats;
	bid = msg.bid;
	turn = msg.turn;
	starter = msg.starter;
	if (msg.opener) opener = msg.opener;
	digests = msg.digests ?? {};
	matchNo = msg.match ?? matchNo;
	// Back from a reload: the cup this round was committed to, if the digest
	// on the table is its. Without it there is nothing to bid from and
	// nothing to open, and an unopened cup reads as cheating.
	const held = myCommit ? null : kept("liars-dice");
	if (held && held.digest === digests[self()]) {
		myCommit = held;
		myHand = held.value;
	}
	lastCall = msg.lastCall ?? null;
	if (msg.reveals && Object.keys(msg.reveals).length) reveals = msg.reveals;
	over = msg.over ?? null;
	if (over) {
		phase = "over";
		reportOver();
	}
	render();
});

const moveCh = arcade.channel("ldMove", (move, from) => {
	if (isHost() && move) hostMove(from, move);
});

const revealCh = arcade.channel("ldReveal", (payload, from) => {
	if (!payload) return;
	if (payload.open) {
		// The host is asking everyone to open. Only the host may ask.
		if (from === arcade.party.host) openMyCup();
		return;
	}
	// A bot's cup is opened by the host that rolled it, and only by the host.
	if (payload.as && (!isBot(payload.as) || from !== arcade.party.host)) return;
	if (Array.isArray(payload.hand)) takeReveal(payload.as ?? from, { hand: payload.hand, nonce: payload.nonce });
});

// ------------------------------------------------------------------- rounds

const rounds = clock("ldRound", {
	rounds: 400,
	phases: [
		// Everyone rolls and commits at once; the phase ends the moment they
		// all have, which is usually well inside a second.
		{ name: "roll", ms: 12_000, collect: true },
		// Bidding goes round the table, so it cannot end on a clock. The
		// deadline is a backstop; `next` ends it when somebody calls a bluff.
		{ name: "bid", ms: 600_000 },
		// Long enough to read four hands and the count, short enough that a
		// game of nine rounds is not ten minutes.
		{ name: "reveal", ms: 3500 },
	],
}, {
	onPhase: (info) => {
		if (over) return;
		phase = info.phase;
		if (info.phase === "roll") beginRoll();
		else if (info.phase === "bid") beginBid();
		render();
	},
	onTick: () => renderHud(),
	onCollect: ({ entries }) => {
		// Host side, end of the roll phase.
		if (!isHost()) return;
		digests = Object.fromEntries(entries);
		pushState();
	},
});

// --------------------------------------------------------------------- roll

async function beginRoll() {
	bid = null;
	lastCall = null;
	reveals = {};
	verdicts = {};
	myCommit = null;
	myHand = [];
	setNotice("");

	if (amPlaying()) {
		// Rolled here, committed here. Nobody deals — see the note at the top
		// of this file for why a sealed channel would not help.
		const hand = rollDice(myDiceCount());
		myHand = hand;
		const c = await commit(hand);
		if (!c || phase !== "roll") return;
		myCommit = c;
		keep("liars-dice", myCommit);
		rounds.submit(myCommit.digest);
		render();
	}

	if (isHost()) {
		botHands = {};
		for (const seat of alive()) {
			if (!isBot(seat.id)) continue;
			const hand = rollDice(seat.dice);
			const c = await commit(hand);
			if (!c) return;
			botHands[seat.id] = { hand, commit: c };
			// `submitFor` rather than a cached digest: the number of dice changes
			// every round, so a bot's hand cannot be prepared before the phase
			// opens the way Battleship's fleets can.
			rounds.submitFor(seat.id, c.digest);
		}
	}
}

// ---------------------------------------------------------------------- bid

function beginBid() {
	if (!isHost()) return;
	const living = alive();
	turn = living.some((s) => s.id === starter) ? starter : living[0]?.id ?? null;
	bid = null;
	pushState();
	nudgeBot();
}

function nextTurn() {
	const living = alive();
	const i = living.findIndex((s) => s.id === turn);
	turn = living[(i + 1) % living.length]?.id ?? null;
}

/** Host side. The only place a bid or a call is ever accepted. */
function hostMove(fromId, move) {
	if (!isHost() || phase !== "bid" || over) return;
	if (fromId !== turn) return;
	const seat = seatOf(fromId);
	if (!seat || seat.out) return;

	if (move.type === "liar") {
		if (!bid) return; // nothing to call
		callBluff(fromId);
		return;
	}
	const next = { count: move.count, face: move.face };
	if (!bidBeats(next, bid)) return;
	if (next.count > totalDice()) return;
	bid = { ...next, by: fromId };
	nextTurn();
	pushState();
	nudgeBot();
}

function nudgeBot() {
	clearTimeout(botTimer);
	if (!isHost() || phase !== "bid" || over || !turn) return;
	if (!isBot(turn)) return;
	// A pause, so a table of bots is watchable rather than instantaneous.
	botTimer = setTimeout(() => {
		if (phase !== "bid") return;
		const id = turn;
		const hand = botHands[id]?.hand ?? [];
		const unknown = totalDice() - (seatOf(id)?.dice ?? 0);
		hostMove(id, botAction(hand, bid, unknown));
	}, 750);
}

// ----------------------------------------------------------------- the call

let pendingCall = null;

/**
 * Host side. Somebody called. Everyone opens their cup, every commitment is
 * checked, and only then is the round settled.
 */
function callBluff(callerId) {
	pendingCall = { caller: callerId, bid: { ...bid } };
	revealCh.send({ open: true });
	openMyCup();
	// Bots are opened by the host that rolled them, for everyone to check.
	for (const [botId, held] of Object.entries(botHands)) {
		const payload = { hand: held.hand, nonce: held.commit.nonce };
		revealCh.send({ ...payload, as: botId });
		takeReveal(botId, payload);
	}
	// A peer that never answers must not hang the table.
	setTimeout(() => settleCall(), 4000);
}

function openMyCup() {
	if (!myCommit) return;
	const payload = { hand: myCommit.value, nonce: myCommit.nonce };
	revealCh.send(payload);
	takeReveal(self(), payload);
}

async function takeReveal(playerId, payload) {
	reveals[playerId] = payload;
	const digest = digests[playerId];
	// Snapshot the seat **before** awaiting. `settleCall` takes a die off the
	// loser, and it can run while this verification is still in flight — so
	// reading the count afterwards compares the hand that was rolled against
	// the number of dice the player has *now*, and accuses an honest player of
	// opening the wrong number. A false cheating accusation is the worst thing
	// this game can do.
	const expected = seatOf(playerId)?.dice ?? 0;
	const ok = digest ? await verify({ digest, nonce: payload.nonce, value: payload.hand }) : false;
	// A hand that does not match what was committed before the bidding is a
	// hand that was changed after seeing the bids.
	verdicts[playerId] = ok ? null : "these are not the dice they committed to";
	if (payload.hand.length !== expected) verdicts[playerId] = "they opened the wrong number of dice";
	render();
	if (isHost()) maybeSettle();
}

function maybeSettle() {
	if (!pendingCall) return;
	const need = alive().map((s) => s.id);
	if (need.every((id) => reveals[id] && id in verdicts)) settleCall();
}

function settleCall() {
	if (!isHost() || !pendingCall) return;
	const call = pendingCall;
	pendingCall = null;

	const living = alive();
	const hands = living.map((s) => reveals[s.id]?.hand ?? []);
	const { actual, bidderWasRight } = resolveCall(hands, call.bid);

	// A caught cheat loses the die regardless of the count — there is no
	// honest reading of a round somebody lied in.
	const cheat = living.map((s) => s.id).find((id) => verdicts[id]);
	const loser = cheat ?? (bidderWasRight ? call.caller : call.bid.by);

	const seat = seatOf(loser);
	if (seat) {
		seat.dice = Math.max(0, seat.dice - 1);
		if (seat.dice === 0) seat.out = true;
	}
	lastCall = { caller: call.caller, bid: call.bid, actual, bidderWasRight, loser, cheat: cheat ?? null };
	// Whoever lost a die opens the next round; if they are out, the caller does.
	starter = seat && !seat.out ? loser : call.caller;

	const left = alive();
	if (left.length <= 1) {
		endGame(left[0]?.id ?? null);
		return;
	}
	pushState();
	// Ends the bidding phase now rather than at its backstop deadline.
	rounds.next();
}

function endGame(winner) {
	over = { winner, match: matchNo };
	phase = "over";
	clearTimeout(botTimer);
	pushState();
	reportOver();
}

// -------------------------------------------------------------------- input

function send(move) {
	if (move.type === "bid" && !bidBeats(move, bid)) {
		setNotice("That does not raise the bid.");
		return;
	}
	if (move.type === "liar" && !bid) {
		setNotice("There is nothing to call yet.");
		return;
	}
	setNotice("");
	if (isHost()) hostMove(self(), move);
	else moveCh.send(move, arcade.party.host);
}

/** The cheapest legal raise, used to seed the bid builder each turn. */
function minimumRaise() {
	const options = raisesAfter(bid, totalDice());
	return options[0] ?? { count: 1, face: 2 };
}

function resetDraft() {
	const min = minimumRaise();
	draftCount = min.count;
	draftFace = min.face;
}

// ------------------------------------------------------------------- render

function renderTable() {
	table.replaceChildren(
		...seats.map((s) => {
			const seat = el("div", "ld-seat" + (s.id === turn && phase === "bid" ? " turn" : "") + (s.out ? " out" : ""));
			const cups = el("span", "ld-cups", s.out ? "—" : "●".repeat(s.dice));
			cups.setAttribute("aria-label", `${s.dice} dice`);
			seat.append(el("span", null, nameOf(s.id)), cups);
			return seat;
		}),
	);
}

function renderMine() {
	if (!amPlaying() || !myHand.length || phase === "roll") {
		mine.replaceChildren();
		return;
	}
	mine.replaceChildren(
		...myHand.map((d) => {
			// Ones are wild, and at a glance that is the only thing about your
			// own hand you need to see instantly.
			const die = el("span", d === 1 ? "wild" : null, PIPS[d]);
			die.setAttribute("aria-label", d === 1 ? "one, wild" : String(d));
			return die;
		}),
	);
}

function renderBid() {
	revealEl.replaceChildren();
	if (phase === "reveal" || over) {
		if (lastCall) {
			revealEl.append(el("div", null, lastCall.cheat
				? `${nameOf(lastCall.cheat)} was caught cheating`
				: `${nameOf(lastCall.caller)} called ${lastCall.bid.count}×${PIPS[lastCall.bid.face]} — there were ${lastCall.actual}`));
		}
		for (const s of seats) {
			const opened = reveals[s.id];
			if (!opened) continue;
			const row = el("div", "row");
			row.append(el("span", null, nameOf(s.id)), el("span", "dice", opened.hand.map((d) => PIPS[d]).join("")));
			if (verdicts[s.id]) row.append(el("span", null, "⚠"));
			revealEl.append(row);
		}
	}

	if (over) {
		bidEl.textContent = "";
		return;
	}
	if (bid) {
		bidEl.replaceChildren(document.createTextNode(`${bid.count} × ${PIPS[bid.face]}`), el("small", null, `${nameOf(bid.by)} bid`));
	} else if (phase === "bid") {
		bidEl.replaceChildren(document.createTextNode("—"), el("small", null, "no bid yet"));
	} else {
		bidEl.textContent = "";
	}
}

function renderControls() {
	faces.replaceChildren();
	count.replaceChildren();
	actions.replaceChildren();

	if (over) {
		if (isHost()) {
			const b = el("button", "neon-btn", "NEW GAME");
			b.type = "button";
			b.addEventListener("click", newGame);
			actions.append(b);
		}
		return;
	}
	if (!isMyTurn()) return;

	for (let f = 2; f <= FACES; f++) {
		const b = el("button", "ld-face" + (draftFace === f ? " sel" : ""), PIPS[f]);
		b.type = "button";
		b.setAttribute("aria-label", `bid on ${f}s`);
		b.addEventListener("click", () => {
			draftFace = f;
			// Keep the draft legal: raising the face may allow the same count,
			// lowering it may not.
			if (!bidBeats({ count: draftCount, face: f }, bid)) {
				const fit = raisesAfter(bid, totalDice()).find((o) => o.face === f);
				if (fit) draftCount = fit.count;
			}
			render();
		});
		faces.append(b);
	}

	const step = (label, delta) => {
		const b = el("button", null, label);
		b.type = "button";
		b.setAttribute("aria-label", delta > 0 ? "more dice" : "fewer dice");
		b.addEventListener("click", () => {
			const next = draftCount + delta;
			if (next < 1 || next > totalDice()) return;
			draftCount = next;
			render();
		});
		return b;
	};
	count.append(step("−", -1), el("span", null, String(draftCount)), step("+", 1));

	const legal = bidBeats({ count: draftCount, face: draftFace }, bid) && draftCount <= totalDice();
	const bidBtn = el("button", "neon-btn", `BID ${draftCount} × ${PIPS[draftFace]}`);
	bidBtn.type = "button";
	bidBtn.disabled = !legal;
	bidBtn.addEventListener("click", () => send({ type: "bid", count: draftCount, face: draftFace }));
	actions.append(bidBtn);

	if (bid) {
		const liar = el("button", "neon-btn liar", "LIAR!");
		liar.type = "button";
		liar.addEventListener("click", () => send({ type: "liar" }));
		actions.append(liar);
	}
}

function renderHud() {
	const parts = [];
	if (over) {
		parts.push({ key: "s", text: over.winner === self() ? "You win" : `${nameOf(over.winner)} wins` });
	} else if (phase === "roll") {
		parts.push({ key: "s", text: "Rolling…", className: "g-muted" });
	} else if (phase === "reveal") {
		parts.push({ key: "s", text: "Cups up", className: "g-muted" });
	} else if (phase === "bid") {
		if (!amPlaying()) parts.push({ key: "s", text: "Out — watching", className: "g-muted" });
		else if (isMyTurn()) parts.push({ key: "s", text: bid ? "Raise, or call it" : "Open the bidding" });
		else parts.push({ key: "s", text: `${nameOf(turn)} is thinking…`, className: "g-muted" });
		parts.push({ key: "n", text: `${totalDice()} dice on the table`, className: "g-muted" });
	} else {
		parts.push({ key: "s", text: "Getting ready…", className: "g-muted" });
	}
	setHud(parts);
}

let lastTurnSeen = null;
function render() {
	// Re-seed the bid builder once per turn, not on every repaint, or it would
	// snap back while somebody was still adjusting it.
	if (isMyTurn() && lastTurnSeen !== `${turn}:${bid?.count}:${bid?.face}`) {
		lastTurnSeen = `${turn}:${bid?.count}:${bid?.face}`;
		resetDraft();
	}
	// The bidder to move lost connection: the shell says so; the host may pass them over.
	waitTurn(phase === "bid" && !over ? turn : null);
	renderTable();
	renderBid();
	renderMine();
	renderControls();
	renderHud();
}

// -------------------------------------------------------------------- start

function freshSeats() {
	seats = players().map((id) => ({ id, dice: DICE, out: false }));
	// The host picks who opens: at random for the party's first game, then
	// the next seat each NEW GAME (a guest's pick here is replaced by the
	// host's state).
	if (isHost()) opener = nextOpener(opener, seats.map((s) => s.id));
	starter = opener?.id ?? seats[0]?.id ?? null;
}

function newGame() {
	if (!isHost()) return;
	freshSeats();
	matchNo++;
	bid = null;
	turn = null;
	over = null;
	lastCall = null;
	reveals = {};
	verdicts = {};
	digests = {};
	phase = "waiting";
	pushState();
	rounds.adopt({ round: 0, index: 0 }) || rounds.start();
}

// ---------------------------------------------------------- the party's news

arcade.on("wait", (m) => {
	// SKIP TURN on the shell's banner (the host's).
	if (m.ev !== "skip" || !isHost() || phase !== "bid" || over || m.who !== turn) return;
	nextTurn();
	pushState();
	nudgeBot();
});
arcade.on("join", ({ who }) => {
	if (!isHost()) return;
	pushState(who);
	rounds.sync();
});
arcade.on("leave", () => {
	if (!isHost()) return;
	const gone = seats.filter((s) => !players().includes(s.id) && !s.out);
	for (const s of gone) {
		s.out = true;
		s.dice = 0;
	}
	if (gone.length && turn && gone.some((s) => s.id === turn)) {
		nextTurn();
		nudgeBot();
	}
	if (alive().length <= 1 && !over) return endGame(alive()[0]?.id ?? null);
	pushState();
});
arcade.on("roster", () => render());
/**
 * The crown moved to us mid-game. Dice counts and turns came with every
 * broadcast, but the bots' cups lived on the old host, and a bid against cups
 * nobody can open settles nothing — so the round is rolled again (Lokesh,
 * 2026-11-13), everyone keeping their dice.
 */
arcade.answer("takeOver", () => {
	if (over) {
		pushState();
		return true;
	}
	if (!rounds.adopt({ index: 0 })) return false;
	pushState();
	return true;
});
arcade.on("unmount", () => clearTimeout(botTimer));

arcade.init.then(async (init) => {
	session = init.session ?? {};
	freshSeats();
	render();
	arcade.ready();
	// A commitment needs a hash. Without WebCrypto there is no honest game to
	// play here, and pretending otherwise is worse than saying so.
	if (!(await commit(0))) {
		setNotice("This browser cannot make a sealed commitment, so there is no way to keep the dice honest here.");
		return;
	}
	if (isHost()) {
		matchNo = 1;
		pushState();
		rounds.start();
	}
});

/** For the tests. */
arcade.debug = () => ({
	phase,
	seats: seats.map((s) => ({ ...s })),
	bid: bid ? { ...bid } : null,
	turn,
	myDice: myHand.length,
	committed: !!myCommit,
	digests: Object.keys(digests).length,
	revealed: Object.keys(reveals).length,
	verdicts: { ...verdicts },
	lastCall: lastCall ? { ...lastCall } : null,
	totalDice: totalDice(),
	over: over ? { ...over } : null,
});
