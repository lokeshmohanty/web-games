// battleship/battleship.js — Battleship. An SDK v2 game, on the protocol itself
// (Layer 1): a fleet nobody may see cannot be managed state, which the host runs.
//
// This is the game the plumbing was built for. Everything else here is
// host-authoritative: one browser owns the truth and the rest render it. That
// cannot work when the truth is *where your ships are*, because the host is a
// player and would be holding the other player's fleet.
//
// So nobody holds anybody's fleet. Each player keeps their own board, answers
// hit-or-miss for shots aimed at it, and is bound to have told the truth by a
// **commitment** published before a shot was fired. At the end both fleets are
// revealed, every answer is re-checked against them, and a player whose answers
// do not match the fleet they committed to loses on the spot. The commitment
// and its check are the shell's `commit` and `verify`; mailing your fleet to
// the host is not private at all, since the host is your opponent.
//
// ## Both players fire at once
//
// Not alternating turns. A salvo round opens, both players pick a square, and
// the round resolves when both have — the shell's clock (`timer.*`) with
// `collect: true`.
// This is a real variant, and it is the one that suits this transport: nobody
// waits on anybody's turn, a slow link costs only its owner, and the host never
// has to decide who acted first. It also means both fleets can go down on the
// same volley, which is a draw and a good ending.
//
// ## What is public and what is not
//
//   public   the shots, the answers, both commitments, both fleets at the end
//   private  your fleet during play — and it never leaves your browser at all,
//            so there is nothing to intercept and nothing to relay
//
// The rules and the bot live in battleship-rules.js, so test-battleship.mjs
// can play whole games with no document.


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

const { SIZE, FLEET, FLEET_CELLS, inBounds, key, cellsOf, validateFleet, randomFleet, shipAt, answerShot, auditAnswers, botTarget } = battleshipRules;

// ------------------------------------------------------------------- markup

const style = document.createElement("style");
style.textContent = `
	/* Width is set by layout() rather than here: the two grids share a phone's
	   height with a ship rack and two rows of buttons, and only JS knows how
	   much is left. Without an explicit width a CSS grid in a centred flex
	   column collapses to a single cell — which is exactly what it did. */
	.bs-grid { display: grid; grid-template-columns: repeat(${SIZE}, 1fr);
		gap: 2px; background: var(--rule); padding: 2px; border-radius: 6px;
		border: 2px solid var(--rule); touch-action: manipulation; }
	.bs-cell { aspect-ratio: 1; background: var(--surface-2); border: none; padding: 0;
		border-radius: 2px; color: var(--muted); font-size: 0.7rem; line-height: 1;
		display: flex; align-items: center; justify-content: center;
		touch-action: manipulation; cursor: pointer; }
	.bs-cell:disabled { cursor: default; }
	.bs-cell.ship { background: color-mix(in oklch, var(--accent) 50%, var(--surface-2)); }
	.bs-cell.ghost { background: color-mix(in oklch, var(--accent) 25%, var(--surface-2)); }
	.bs-cell.bad { background: color-mix(in oklch, var(--danger) 35%, var(--surface-2)); }
	.bs-cell.miss { background: var(--surface); color: var(--ink-3); }
	.bs-cell.hit { background: var(--danger); }
	.bs-cell.sunk { background: color-mix(in oklch, var(--danger) 55%, var(--bg)); }
	.bs-cell.aim { outline: 2px solid var(--accent); outline-offset: -2px; }
	/* The latest shot on each board: ringed, with a dot in the corner (a shape,
	   not colour alone). Every board's history is in order, so it is its last. */
	.bs-cell.last { position: relative; box-shadow: inset 0 0 0 2px var(--ink); }
	.bs-cell.last::after { content: ""; position: absolute; top: 2px; right: 2px; width: 18%;
		aspect-ratio: 1; border-radius: 50%; background: var(--ink); }
	.bs-label { font-size: 0.62rem; letter-spacing: 0.16em; color: var(--muted);
		margin-bottom: 2px; }
	.bs-panel { display: flex; flex-direction: column; align-items: center; width: 100%; }
	.bs-ships { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; }
	.bs-ship { background: var(--panel); border: 2px solid var(--border);
		border-radius: 6px; padding: 6px 9px; font-size: 0.62rem; letter-spacing: 0.1em;
		color: var(--muted); min-height: 44px; cursor: pointer; }
	.bs-ship.sel { border-color: var(--accent); color: var(--accent); }
	.bs-ship.done { opacity: 0.45; }
	.bs-actions { display: flex; gap: 8px; flex-wrap: wrap; justify-content: center; }
	.bs-actions .neon-btn { padding: 10px 16px; font-size: 14px;
		/* Narrower than the default button so three fit on one row of a 390px
		   screen — but not shorter. Trimming the padding alone took these to
		   36px, under the tap minimum. */
		min-height: 44px; }
	.bs-notice { font-size: 0.68rem; color: var(--warn); min-height: 1.2em; text-align: center; }
	.bs-verdict { font-size: 0.66rem; color: var(--muted); text-align: center;
		max-width: 34ch; }
`;
document.head.append(style);

const fill = el("div", "g-fill");
const notice = el("div", "bs-notice");
const theirPanel = el("div", "bs-panel");
const theirLabel = el("div", "bs-label");
const theirGrid = el("div", "bs-grid");
theirPanel.append(theirLabel, theirGrid);
const myPanel = el("div", "bs-panel");
const myLabel = el("div", "bs-label");
const myGrid = el("div", "bs-grid");
myPanel.append(myLabel, myGrid);
const ships = el("div", "bs-ships");
const actions = el("div", "bs-actions");
const verdict = el("div", "bs-verdict");
fill.append(notice, theirPanel, myPanel, ships, actions, verdict);
stage.append(fill);

const cellsFor = (grid) => {
	const out = [];
	for (let r = 0; r < SIZE; r++) {
		for (let c = 0; c < SIZE; c++) {
			const b = el("button", "bs-cell");
			b.type = "button";
			b.dataset.r = r;
			b.dataset.c = c;
			// "D4" reads better than "row 3 column 4" to anyone who has played the
			// game on paper, and it is what the labels on the grid say.
			b.setAttribute("aria-label", `${String.fromCharCode(65 + c)}${r + 1}`);
			grid.append(b);
			out.push(b);
		}
	}
	return out;
};
const theirCells = cellsFor(theirGrid);
const myCells = cellsFor(myGrid);
theirGrid.dataset.board = "theirs";
myGrid.dataset.board = "mine";

// -------------------------------------------------------------------- state

let phase = "waiting"; // waiting | place | fire | resolve | over
let seats = [null, null]; // [A, B] — memberId
let myFleet = [];
let myCommit = null; // { digest, nonce, value }
let digests = {}; // playerId -> digest
let boards = {}; // playerId -> [{ at, hit, sunk }] — shots fired AT them
let reveals = {}; // playerId -> { fleet, nonce }
let audits = {}; // playerId -> null (clean) | string (what was wrong)
let over = null; // { winner, reason, match }
let matchNo = 0; // games in this run: the host's count, sent with the state
let reportedOver = null;
let placing = FLEET[0].id;
let dir = "h";
let hover = null;
let aim = null;
let submittedFire = false;
let botFleets = {}; // botId -> { fleet, commit } — held by the host that plays them
let autoCommitTimer = null;
let lastVolley = []; // host: the latest volley, for a player who reloads through it

/** Tell the platform how it ended (every peer does; it counts once). */
function reportOver() {
	if (!over || reportedOver?.match === over.match) return;
	reportedOver = over;
	const [a, b] = seats;
	const loser = over.winner === a ? b : a;
	const ranking = over.winner
		? [[over.winner], [loser]].map((s) => s.filter(Boolean)).filter((s) => s.length)
		: [[a, b].filter(Boolean)];
	if (ranking.length) arcade.result({ kind: "duel", match: over.match ?? 1, ranking, reason: over.reason ?? undefined });
}

const mySeat = () => seats.indexOf(self());
const opponentOf = (id) => seats.find((s) => s && s !== id) ?? null;
const opponent = () => opponentOf(self());
const isSpectator = () => mySeat() < 0;
const teamSeats = () => [seatsOf("A")[0] ?? null, seatsOf("B")[0] ?? null];

const shotsAt = (id) => boards[id] ?? [];
/** The square of the latest shot at `id`'s board, or null. */
const lastShotAt = (id) => shotsAt(id).at(-1)?.at ?? null;
/** Mark `cell` as the latest shot on its board, or not; the label says so too. */
function markLast(cell, r, c, at) {
	const is = !!at && at[0] === r && at[1] === c;
	if (is) cell.className += " last";
	cell.setAttribute("aria-label", `${String.fromCharCode(65 + c)}${r + 1}${is ? ", the last shot" : ""}`);
}
const hitsOn = (id) => shotsAt(id).filter((s) => s.hit).length;
const isDown = (id) => hitsOn(id) >= FLEET_CELLS;

const setNotice = (text) => {
	notice.textContent = text ?? "";
};

// ----------------------------------------------------------------- the wire

const stateCh = arcade.channel("bsState", (msg, from) => {
	if (isHost() || from !== arcade.party.host || !msg) return;
	if (msg.match !== matchNo) openGame(msg.match);
	seats = msg.seats;
	digests = msg.digests ?? {};
	boards = msg.boards ?? {};
	restoreFleet();
	over = msg.over ?? null;
	if (over) {
		reportOver();
		phase = "over";
		closeClocks();
		doReveal();
	}
	render();
});

const shotsCh = arcade.channel("bsShots", (volley, from) => {
	if (isHost() || from !== arcade.party.host || !Array.isArray(volley)) return;
	applyVolley(volley);
});

const reportCh = arcade.channel("bsReport", (rep, from) => {
	// Only the owner of a board may answer for it. Without this check any peer
	// could call its opponent's ships sunk.
	const owner = rep?.target;
	const allowed = from === owner || (from === arcade.party.host && isBot(owner));
	if (!allowed) return;
	recordReport(rep);
	render();
});

const revealCh = arcade.channel("bsReveal", (payload, from) => {
	if (!payload) return;
	const who = payload.as ?? from;
	if (payload.as && (from !== arcade.party.host || !isBot(payload.as))) return;
	recordReveal(who, { fleet: payload.fleet, nonce: payload.nonce });
});

function pushState(to) {
	if (!isHost()) return;
	stateCh.send({ seats, digests, boards, over, match: matchNo }, to);
}

// ------------------------------------------------------------------- phases
//
// Two clocks, which is what a clock's name is for. Placement is one collecting
// phase that ends the moment both fleets are committed; the battle is many,
// each of which ends the moment both players have picked a square. Neither
// ever waits on a turn order. Each game opens its own pair (named for it), so
// a finished game's clocks are simply closed.

let setup = null;
let battle = null;

function closeClocks() {
	setup?.close();
	battle?.close();
	setup = battle = null;
}

/** This phone joins game `match`: its clocks, a board laid out to commit. */
function openGame(match) {
	closeClocks();
	matchNo = match;
	digests = {};
	boards = {};
	reveals = {};
	audits = {};
	over = null;
	// A fleet already laid out, not an empty grid: COMMIT works immediately
	// and rearranging is the option rather than the obligation.
	myFleet = randomFleet();
	myCommit = null;
	placing = FLEET[0].id;
	submittedFire = false;
	aim = null;
	setNotice("");
	armAutoCommit();

	setup = clock(`bsSetup${match}`, { rounds: 1, phases: [{ name: "place", ms: 150_000, collect: true }], bots: true }, {
		botSubmit: (botId) => botFleets[botId] && setup.submitFor(botId, botFleets[botId].commit.digest),
		onPhase: () => {
			phase = "place";
			render();
		},
		onCollect: ({ entries }) => {
			// Host side. Everyone who committed in time is in `entries`; a seat
			// that is not there never deployed, and the game cannot start.
			if (!isHost() || over) return;
			const missing = players().filter((id) => !entries.has(id));
			if (missing.length) {
				finish(null, `${missing.map(nameOf).join(" and ")} never deployed a fleet.`);
				return;
			}
			digests = Object.fromEntries(entries);
			pushState();
			battle.start();
		},
		onTick: () => phase === "place" && renderHud(),
	});

	battle = clock(`bsFire${match}`, {
		rounds: SIZE * SIZE,
		phases: [
			{ name: "fire", ms: 60_000, collect: true },
			// Long enough to read the splash, short enough that clearing a fleet
			// is a minute rather than three: a full game is ~35 volleys.
			{ name: "resolve", ms: 900 },
		],
		bots: true,
	}, {
		botSubmit: (botId) => {
			const target = opponentOf(botId);
			battle.submitFor(botId, target ? botTarget(shotsAt(target)) : null);
		},
		onPhase: (info) => {
			if (over) return;
			phase = info.phase;
			if (info.phase === "fire") {
				submittedFire = false;
				aim = null;
			}
			render();
		},
		onTick: () => renderHud(),
		onCollect: ({ entries }) => {
			// Host side. Publish both shots together — that is what makes the
			// round simultaneous rather than a race — and then everybody answers
			// for their own board.
			if (!isHost() || over) return;
			const volley = [];
			for (const [by, at] of entries) {
				if (!at) continue;
				const target = opponentOf(by);
				if (!target) continue;
				volley.push({ by, target, at });
			}
			lastVolley = volley;
			shotsCh.send(volley);
			applyVolley(volley);
		},
	});
}

/**
 * Answer the shot aimed at our own board — and nothing else.
 *
 * Every player is the sole authority on their own water, because they are the
 * only one holding the fleet. That is only safe because the answer is checked
 * against a commitment afterwards; without the audit this is just an honour
 * system.
 */
function applyVolley(volley) {
	for (const shot of volley) {
		const iAnswer = shot.target === self() || (isHost() && isBot(shot.target));
		if (!iAnswer) continue;
		const fleet = shot.target === self() ? myFleet : botFleets[shot.target]?.fleet;
		if (!fleet) continue;
		const hits = new Set(shotsAt(shot.target).filter((s) => s.hit).map((s) => key(s.at[0], s.at[1])));
		const truth = answerShot(fleet, hits, shot.at[0], shot.at[1]);
		const rep = { target: shot.target, at: shot.at, hit: truth.hit, sunk: truth.sunk };
		reportCh.send(rep);
		recordReport(rep);
	}
	render();
}

function recordReport(rep) {
	const list = (boards[rep.target] ??= []);
	// A report can arrive twice if a peer re-sends; the board is a history and
	// a duplicate would corrupt the hit count the sinking test depends on.
	if (list.some((s) => s.at[0] === rep.at[0] && s.at[1] === rep.at[1])) return;
	list.push({ at: rep.at, hit: rep.hit, sunk: rep.sunk ?? null });
	if (isHost()) checkForEnd();
}

function checkForEnd() {
	if (!isHost() || over) return;
	const down = players().filter(isDown);
	if (!down.length) return;
	const alive = players().filter((id) => !isDown(id));
	finish(alive.length === 1 ? alive[0] : null, alive.length === 1 ? null : "Both fleets went down on the same volley.");
}

/** Host side. Stop the clocks and ask everyone to open their commitment. */
function finish(winner, reason) {
	if (over) return;
	over = { winner, reason: reason ?? null, match: matchNo };
	// Set the phase by hand: the clocks are closed, and a closed clock says no
	// more phases.
	phase = "over";
	closeClocks();
	pushState();
	reportOver();
	doReveal();
}

// ------------------------------------------------------------ commit/reveal

/**
 * After a reload, take back the fleet committed before it — if the digest the
 * host published for us is that fleet's. The page lost it, and a new fleet
 * would answer shots against the wrong water and fail the audit.
 */
function restoreFleet() {
	const digest = digests[self()];
	if (myCommit || !digest) return;
	const held = kept("battleship");
	if (held?.digest !== digest) return;
	myCommit = held;
	myFleet = held.value;
	clearTimeout(autoCommitTimer);
}

function doReveal() {
	// Everybody opens at once. Nobody can wait to see the other fleet first,
	// because the digests were published before a shot was fired and a late
	// reveal proves nothing extra.
	if (myCommit) {
		const payload = { fleet: myCommit.value, nonce: myCommit.nonce };
		revealCh.send(payload);
		recordReveal(self(), payload);
	}
	if (isHost()) {
		for (const [botId, held] of Object.entries(botFleets)) {
			const payload = { fleet: held.commit.value, nonce: held.commit.nonce };
			revealCh.send({ ...payload, as: botId });
			recordReveal(botId, payload);
		}
	}
}

async function recordReveal(playerId, payload) {
	reveals[playerId] = payload;
	const digest = digests[playerId];
	const okDigest = digest ? await verify({ digest, nonce: payload.nonce, value: payload.fleet }) : false;
	audits[playerId] = !okDigest ? "the fleet revealed is not the fleet committed to" : auditAnswers(payload.fleet, shotsAt(playerId));
	render();
}

// ---------------------------------------------------------------- placement

function placeAt(r, c) {
	const spec = FLEET.find((s) => s.id === placing);
	if (!spec) return;
	const candidate = { id: spec.id, r, c, dir };
	const rest = myFleet.filter((s) => s.id !== spec.id);
	// Only complain about *this* ship: a half-placed fleet is not an invalid
	// fleet, it is an unfinished one.
	const cells = cellsOf(candidate);
	if (cells.some(([cr, cc]) => !inBounds(cr, cc))) return setNotice("That hangs off the edge.");
	const taken = new Set(rest.flatMap(cellsOf).map(([cr, cc]) => key(cr, cc)));
	if (cells.some(([cr, cc]) => taken.has(key(cr, cc)))) return setNotice("That overlaps another ship.");
	myFleet = [...rest, candidate];
	setNotice("");
	const next = FLEET.find((s) => !myFleet.some((p) => p.id === s.id));
	placing = next?.id ?? spec.id;
	render();
}

async function submitFleet(fleet) {
	const bad = validateFleet(fleet);
	if (bad) return setNotice(bad);
	clearTimeout(autoCommitTimer);
	setNotice("");
	const c = await commit(fleet);
	if (!c) return setNotice("This browser cannot make a sealed commitment, so Battleship cannot be played honestly here.");
	myFleet = fleet;
	myCommit = c;
	keep("battleship", myCommit);
	setup?.submit(c.digest);
	render();
}

// ------------------------------------------------------------------- render

function paintTheirs() {
	const them = opponent();
	const history = them ? shotsAt(them) : [];
	const byCell = new Map(history.map((s) => [key(s.at[0], s.at[1]), s]));
	const sunkIds = new Set(history.filter((s) => s.sunk).map((s) => s.sunk));
	const revealed = them && reveals[them] ? reveals[them].fleet : null;
	const latest = them ? lastShotAt(them) : null;

	for (const cell of theirCells) {
		const r = +cell.dataset.r;
		const c = +cell.dataset.c;
		const shot = byCell.get(key(r, c));
		let cls = "bs-cell";
		let text = "";
		if (shot?.hit) {
			const ship = revealed ? shipAt(revealed, r, c) : null;
			cls += ship && sunkIds.has(ship.id) ? " sunk" : " hit";
			text = "✕";
		} else if (shot) {
			cls += " miss";
			text = "·";
		} else if (revealed && shipAt(revealed, r, c)) {
			// Only after the reveal: this is where their ships actually were.
			cls += " ship";
		}
		if (aim && aim[0] === r && aim[1] === c) cls += " aim";
		cell.className = cls;
		markLast(cell, r, c, latest);
		cell.textContent = text;
		cell.disabled = phase !== "fire" || submittedFire || isSpectator() || !!shot;
	}
}

function paintMine() {
	const history = shotsAt(self());
	const shotMap = new Map(history.map((s) => [key(s.at[0], s.at[1]), s]));
	const ghost = phase === "place" && hover ? previewCells() : null;
	const latest = lastShotAt(self());

	for (const cell of myCells) {
		const r = +cell.dataset.r;
		const c = +cell.dataset.c;
		const shot = shotMap.get(key(r, c));
		let cls = "bs-cell";
		let text = "";
		if (shot?.hit) {
			cls += " hit";
			text = "✕";
		} else if (shot) {
			cls += " miss";
			text = "·";
		} else if (shipAt(myFleet, r, c)) {
			cls += " ship";
		}
		if (ghost && ghost.cells.some(([gr, gc]) => gr === r && gc === c)) cls += ghost.ok ? " ghost" : " bad";
		cell.className = cls;
		markLast(cell, r, c, latest);
		cell.textContent = text;
		cell.disabled = phase !== "place";
	}
}

function previewCells() {
	const spec = FLEET.find((s) => s.id === placing);
	if (!spec || !hover) return null;
	const cells = cellsOf({ id: spec.id, r: hover[0], c: hover[1], dir });
	const rest = myFleet.filter((s) => s.id !== spec.id);
	const taken = new Set(rest.flatMap(cellsOf).map(([r, c]) => key(r, c)));
	const ok = cells.every(([r, c]) => inBounds(r, c)) && !cells.some(([r, c]) => taken.has(key(r, c)));
	return { cells: cells.filter(([r, c]) => inBounds(r, c)), ok };
}

function renderControls() {
	ships.replaceChildren();
	actions.replaceChildren();
	verdict.textContent = "";

	if (phase === "place" && !isSpectator()) {
		const committed = !!myCommit;
		for (const spec of FLEET) {
			const placed = myFleet.some((s) => s.id === spec.id);
			const btn = el("button", "bs-ship" + (placing === spec.id ? " sel" : "") + (placed ? "" : " done"), `${spec.name} ${spec.len}`);
			btn.type = "button";
			btn.disabled = committed;
			btn.addEventListener("click", () => {
				placing = spec.id;
				render();
			});
			ships.append(btn);
		}
		const add = (label, onClick, disabled = false) => {
			const b = el("button", "neon-btn", label);
			b.type = "button";
			b.disabled = disabled;
			b.addEventListener("click", onClick);
			actions.append(b);
			return b;
		};
		add(dir === "h" ? "ACROSS" : "DOWN", () => {
			dir = dir === "h" ? "v" : "h";
			render();
		}, committed);
		add("RANDOMISE", () => {
			myFleet = randomFleet();
			placing = FLEET[0].id;
			setNotice("");
			render();
		}, committed);
		add(committed ? "COMMITTED" : "COMMIT FLEET", () => submitFleet(myFleet), committed || myFleet.length !== FLEET.length);
		return;
	}

	if (phase === "over" || over) {
		const lines = [];
		for (const id of players()) {
			const a = audits[id];
			if (a === undefined) lines.push(`${nameOf(id)}: waiting for their reveal…`);
			else if (a === null) lines.push(`${nameOf(id)}: fleet verified ✓`);
			else lines.push(`${nameOf(id)}: CHEATED — ${a}`);
		}
		verdict.textContent = lines.join("  ·  ");
		if (isHost()) {
			const b = el("button", "neon-btn", "NEW GAME");
			b.type = "button";
			b.addEventListener("click", () => newGame());
			actions.append(b);
		}
	}
}

function renderHud() {
	const parts = [];
	const them = opponent();
	if (phase === "place") {
		const left = setup?.state().secondsLeft ?? 0;
		parts.push(myCommit ? { key: "s", text: "Fleet committed — waiting for them", className: "g-muted" } : { key: "s", text: "Place your fleet" });
		if (left > 0 && left < 100000) parts.push({ key: "t", text: `${left}s`, className: "g-muted" });
	} else if (phase === "fire") {
		parts.push(submittedFire
			? { key: "s", text: "Locked in — waiting for them", className: "g-muted" }
			: { key: "s", text: isSpectator() ? "Spectating" : "Pick a square" });
		parts.push({ key: "n", text: `${battle?.state().submitted.length ?? 0}/2 ready`, className: "g-muted" });
	} else if (phase === "resolve") {
		parts.push({ key: "s", text: "Incoming…", className: "g-muted" });
	} else if (over) {
		const cheat = players().find((id) => audits[id]);
		if (cheat) parts.push({ key: "s", text: `${nameOf(cheat)} was caught cheating`, className: "g-warn" });
		else if (over.winner === self()) parts.push({ key: "s", text: "You win" });
		else if (over.winner) parts.push({ key: "s", text: `${nameOf(over.winner)} wins` });
		else parts.push({ key: "s", text: over.reason ?? "Draw" });
	} else {
		parts.push({ key: "s", text: "Getting ready…", className: "g-muted" });
	}
	if (them && phase !== "place") parts.push({ key: "h", text: `${hitsOn(them)}/${FLEET_CELLS} hit`, className: "g-muted" });
	setHud(parts);
}

/**
 * Size the two boards. During placement there is only one and it gets
 * everything; in battle the enemy's is the one being aimed at, so it takes the
 * larger share and your own drops to a readable reminder.
 */
function layout() {
	const w = stage.clientWidth;
	const availH = stage.clientHeight - hud.offsetHeight - 24;
	if (phase === "place") {
		const size = Math.max(200, Math.min(w * 0.96, availH - 160));
		myGrid.style.width = `${Math.floor(size)}px`;
	} else {
		const size = Math.max(180, Math.min(w * 0.96, (availH - 90) * 0.6));
		theirGrid.style.width = `${Math.floor(size)}px`;
		myGrid.style.width = `${Math.floor(Math.min(w * 0.62, size * 0.66))}px`;
	}
}

function render() {
	const them = opponent();
	theirLabel.textContent = them ? `${nameOf(them).toUpperCase()}'S WATERS` : "THEIR WATERS";
	myLabel.textContent = "YOUR WATERS";
	// During placement the enemy grid is nothing but noise, and the board you
	// are working on needs every pixel a phone has.
	theirPanel.hidden = phase === "place";
	paintTheirs();
	paintMine();
	renderControls();
	renderHud();
	layout();
}

// -------------------------------------------------------------------- input

theirGrid.addEventListener("click", (ev) => {
	const cell = ev.target.closest(".bs-cell");
	if (!cell || cell.disabled) return;
	aim = [+cell.dataset.r, +cell.dataset.c];
	submittedFire = true;
	battle?.submit(aim);
	render();
});

myGrid.addEventListener("click", (ev) => {
	const cell = ev.target.closest(".bs-cell");
	if (!cell || phase !== "place" || myCommit) return;
	placeAt(+cell.dataset.r, +cell.dataset.c);
});

myGrid.addEventListener("pointermove", (ev) => {
	if (phase !== "place" || myCommit) return;
	const cell = ev.target.closest(".bs-cell");
	const next = cell ? [+cell.dataset.r, +cell.dataset.c] : null;
	if (JSON.stringify(next) === JSON.stringify(hover)) return;
	hover = next;
	paintMine();
});
myGrid.addEventListener("pointerleave", () => {
	hover = null;
	paintMine();
});

// -------------------------------------------------------------------- start

async function newGame() {
	if (!isHost()) return;
	seats = teamSeats();
	openGame(matchNo + 1);
	// Bot fleets are made and committed here, before the phase opens, so a
	// bot's turn to commit is answered at once.
	botFleets = {};
	for (const id of players()) {
		if (!isBot(id)) continue;
		const fleet = randomFleet();
		const c = await commit(fleet);
		if (c) botFleets[id] = { fleet, commit: c };
	}
	pushState();
	setup.start();
	render();
}

/**
 * Commit whatever is on the board — filling in anything unplaced — a few
 * seconds before the deadline.
 *
 * The alternative is a game that cannot start because somebody put their phone
 * down. It happens on the player's own device, so the fleet still never leaves
 * it.
 */
function armAutoCommit() {
	clearTimeout(autoCommitTimer);
	autoCommitTimer = setTimeout(() => {
		if (myCommit || phase !== "place" || isSpectator()) return;
		const filled = validateFleet(myFleet) ? randomFleet() : [...myFleet];
		setNotice("Out of time — your fleet was committed as it stood.");
		submitFleet(filled);
	}, 142_000);
}

// ---------------------------------------------------------- the party's news

arcade.on("join", ({ who, info }) => {
	if (!isHost()) return;
	seats = teamSeats();
	pushState(who);
	setup?.sync();
	battle?.sync();
	// Back from a reload: a volley that went out while they were away still
	// wants their answer. Answers are deduplicated by square.
	if (info?.back && lastVolley.length) shotsCh.send(lastVolley, who);
	render();
});
arcade.on("leave", () => {
	if (!isHost()) return;
	const left = seats.filter(Boolean).filter((id) => !players().includes(id));
	if (left.length && !over) finish(opponentOf(left[0]), `${nameOf(left[0])} left.`);
});
arcade.on("roster", () => render());
arcade.on("unmount", () => clearTimeout(autoCommitTimer));
addEventListener("resize", layout);
addEventListener("orientationchange", layout);
// No takeOver answer: the fleets the old host played for its bots, and its
// clocks' collections, left with it — the game ends, and says so.

arcade.init.then(async (init) => {
	session = init.session ?? {};
	seats = teamSeats();
	myFleet = randomFleet();
	render();
	arcade.ready();
	// A commitment needs a hash. Without WebCrypto there is no honest game to
	// play here, and pretending otherwise is worse than saying so.
	if (!(await commit(0))) {
		setNotice("This browser cannot make a sealed commitment, so Battleship cannot be played honestly here.");
		return;
	}
	if (isHost()) newGame();
});

/** For the tests. */
arcade.debug = () => ({
	phase,
	seats: [...seats],
	committed: !!myCommit,
	digests: Object.keys(digests).length,
	myFleetCells: myFleet.flatMap(cellsOf).length,
	hitsOnMe: hitsOn(self()),
	shotsAtMe: shotsAt(self()).length,
	myBoard: shotsAt(self()).map((s) => ({ ...s })),
	theirBoard: opponent() ? shotsAt(opponent()).map((s) => ({ ...s })) : [],
	shotsAtThem: opponent() ? shotsAt(opponent()).length : 0,
	hitsOnThem: opponent() ? hitsOn(opponent()) : 0,
	over: over ? { ...over } : null,
	audits: { ...audits },
	fleetsRevealed: Object.keys(reveals).length,
});
