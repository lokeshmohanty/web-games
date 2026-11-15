// bubble-rush/bubble-rush-rules.js — Bubble Rush's field, scoring, bot and round.
//
// No document here and no platform: bubble-rush.js (the page) hands `game()`
// to the platform as SDK v2 managed rules, and test-bubble-rush.mjs loads this
// file alone to exercise the round in Node.
//
// Bubbles rise from random points along the bottom of one shared field,
// wobbling as they go; tap one to pop it. A round is sixty seconds after a
// 3-2-1, and it speeds up as it goes, with a FRENZY for the last ten. It
// rewards aim rather than mashing:
//
//   - small bubbles are worth the most, golden ones more still and they are
//     quick, and spiky bombs cost points and stun you for a moment;
//   - every pop builds a streak and the streak a multiplier (up to ×5), but a
//     tap on empty field, a bomb or a pause between pops breaks it — so the
//     player who taps everywhere loses to the one who picks their bubbles.
//
// Free-for-all or teams, chosen by the host before each round. In TEAMS the
// bubbles come in the two sides' colours: yours score, theirs score nothing
// but popping one takes it away from them. A team's score is its players'
// average, so 1-against-3 still plays.
//
// ## Why this shape suits the transport
//
// A bubble's whole flight is decided when it spawns (where it starts, how
// fast it rises, how it wobbles), so its position is a function of the round
// clock alone. The host sends each bubble once per view as a few integers,
// and every phone draws it at 60 frames a second from its own copy of the
// round clock. The tick only has to keep that clock, spawn bubbles a little
// before they surface, run the bots and end the round: 10 a second is plenty.
//
// ## One field, the same shape on every phone
//
// The field is always FIELD_ASPECT wide for its height (1 : 2, a phone held
// upright), letterboxed into whatever room a phone has. So the host knows
// exactly where every bubble is drawn on every phone, as fractions of the
// field, and a phone has nothing to say about its screen that could stretch
// a bubble: the review of 2026-11-15 found that a claimed field size let a
// phone double a bubble's reach.
//
// ## Who popped what: the host decides
//
// A phone sends where the finger landed, as fractions of the field, and the
// round time it was drawing — never which bubble it thinks it hit. The host
// puts every bubble where it was at that time and takes the nearest one under
// the finger, a fingertip's slack around it. The time is trusted only within
// a window: a guest's clock is behind the host's (the view's trip out, the
// tap's trip back), never ahead, and only the host's own seat, whose clock
// runs on between ticks, may be a little ahead. A player's taps never go back
// in time, a bubble not yet born on the host or still below the field cannot
// be hit (the views carry bubbles before they surface: the review found them
// sniped before birth), a tap on a bubble someone popped first is refused
// without penalty, and a tap on empty field is a miss.

(() => {
	const ROUND_MS = 60_000;
	const COUNT_MS = 3000;
	const FRENZY_MS = 10_000; // the last ten seconds
	const FRENZY_SPAWN = 1.5;
	const HZ = 10; // game.json "tick"

	// The field's width over its height: a phone held upright. Everything is
	// placed in fractions of it; r is a fraction of its width, where the
	// smallest bubble is still a fingertip across. speed scales the rise time.
	const FIELD_ASPECT = 0.5;
	const SIZES = [
		{ r: 0.045, pts: 30, speed: 0.85 },
		{ r: 0.065, pts: 20, speed: 1 },
		{ r: 0.09, pts: 10, speed: 1 },
	];
	const GOLDEN = { r: 0.055, pts: 50, speed: 0.6 };
	const BOMB = { r: 0.07, pts: -25, speed: 1 };
	const GOLDEN_CHANCE = 0.05;

	const STREAK_MS = 1500; // a pause this long between pops breaks a streak
	const STUN_MS = 1200;
	const MAX_MULT = 5;

	// Taps, judged on the host.
	const LAG_MS = 500; // how far behind the host's clock a tap may say it was made
	// And ahead, for the host's own seat only: its phone carries the clock on
	// between ticks, up to bubble-rush.js EXTRA_MS (250) past the last view.
	const AHEAD_MS = 250;
	const SLACK = 0.03; // a fingertip is not a point: a fraction of the field's width (~11 px on a phone)
	const EDGE = 0.01; // how far outside the field a tap may land and still count as on it
	const TAPS_PER_TICK = 3; // per player: a double tap is fine, a flood is not
	// Spawned this far ahead of their birth, so every phone has a bubble
	// before it surfaces from below the field.
	const LEAD_MS = 400;

	// Bots. A bot does not see a bubble until it has been on screen a moment,
	// goes for golden first and then the richest bubble it may score, and
	// leaves bombs alone, barely ever slipping. What keeps it beatable is
	// lapses: now and then it loses the thread for longer than a streak lasts,
	// so its multiplier keeps falling back, as a person's does (Lokesh,
	// 2026-11-15: soften the bots, so a competent player can win). Tuned
	// against a scripted competent player (500 ms to react, a tap every
	// 0.65–1 s, 6% misses, 2% bombs) in one-on-one rounds: it wins 106 of 200
	// seeded rounds; test-bubble-rush.mjs asserts that stays between 35% and
	// 65%. The old bot (no lapses, 8% misses, 6% bombs, a tap every 0.6–0.9 s)
	// lost 51 of 60 to that player but broke its streak on luck alone.
	const BOT_EVERY_MS = [450, 750];
	const BOT_REACT_MS = 400;
	const BOT_MISS = 0.02;
	const BOT_BOMB = 0.01;
	const BOT_DENY = 0.3;
	const BOT_HESITATE = 0.07;
	const BOT_HESITATE_MS = [STREAK_MS + 100, STREAK_MS + 1100];

	const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
	const frac = (t) => clamp(t / ROUND_MS, 0, 1);
	const round4 = (v) => Math.round(v * 1e4) / 1e4;

	/** mulberry32 over a number kept in the state, so the heir carries on the same stream. */
	function nextRandom(st) {
		st.rng = (st.rng + 0x6d2b79f5) >>> 0;
		let t = st.rng;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	}
	/** A generator from a seed, for the tests and anything outside a round. */
	function rngFrom(seed) {
		const st = { rng: seed >>> 0 };
		return () => nextRandom(st);
	}

	/** How long a bubble takes to cross the field, at round time `t`. */
	const riseMs = (t) => 5200 - 2000 * frac(t);

	/** Bombs grow commoner as the round goes on. */
	const bombChance = (t) => 0.08 + 0.08 * frac(t);

	/** Time to the next spawn: faster later, faster with more players, faster still in the frenzy. */
	function spawnInterval(t, players) {
		// Nearly in proportion to the players: each of them needs bubbles of
		// their own to choose between, or it is a race to the bottom edge.
		const base = (450 - 210 * frac(t)) / (0.4 + 0.6 * Math.max(1, players));
		const frenzy = t >= ROUND_MS - FRENZY_MS ? FRENZY_SPAWN : 1;
		return Math.max(90, base / frenzy);
	}

	/**
	 * One bubble, its whole flight decided now. `team` is set only in TEAMS
	 * mode and only on plain bubbles — golden and bombs belong to nobody.
	 * `s` is the size's index for a plain one (what the wire carries).
	 */
	function makeBubble(rng, id, t, mode) {
		const roll = rng();
		const bomb = bombChance(t);
		const k = roll < bomb ? "x" : roll < bomb + GOLDEN_CHANCE ? "g" : "n";
		const s = k === "n" ? Math.floor(rng() * SIZES.length) : null;
		const size = k === "x" ? BOMB : k === "g" ? GOLDEN : SIZES[s];
		const team = k === "n" && mode === "teams" ? (rng() < 0.5 ? "A" : "B") : null;
		// Its whole wobble stays on the field — exactly so on a phone held
		// upright, where r is a fraction of the width.
		const amp = 0.02 + rng() * 0.04;
		const margin = size.r + amp + 0.01;
		return {
			id,
			k,
			s,
			team,
			r: size.r,
			pts: size.pts,
			born: Math.round(t),
			dur: Math.round(riseMs(t) * size.speed),
			x0: round4(margin + rng() * (1 - 2 * margin)),
			amp: round4(amp),
			freq: round4(1 + rng() * 1.5),
			ph: round4(rng() * Math.PI * 2),
		};
	}

	/**
	 * A bubble as the view carries it: [id, kind, team, born, dur, x0, amp,
	 * freq, ph], the fractions in ten-thousandths. kind 0–2 is a plain
	 * bubble's size, 3 golden, 4 a bomb; team 0 none, 1 A, 2 B.
	 */
	const pack = (b) => [b.id, b.k === "g" ? 3 : b.k === "x" ? 4 : b.s, b.team === "A" ? 1 : b.team === "B" ? 2 : 0, b.born, b.dur, Math.round(b.x0 * 1e4), Math.round(b.amp * 1e4), Math.round(b.freq * 1e4), Math.round(b.ph * 1e4)];
	function unpack([id, kind, team, born, dur, x0, amp, freq, ph]) {
		const k = kind === 3 ? "g" : kind === 4 ? "x" : "n";
		const size = k === "g" ? GOLDEN : k === "x" ? BOMB : SIZES[kind];
		return { id, k, s: k === "n" ? kind : null, team: team === 1 ? "A" : team === 2 ? "B" : null, r: size.r, pts: size.pts, born, dur, x0: x0 / 1e4, amp: amp / 1e4, freq: freq / 1e4, ph: ph / 1e4 };
	}

	/** How far through its flight a bubble is: 0 at the bottom, 1 gone off the top. */
	const progress = (b, t) => (t - b.born) / b.dur;

	/** Where a bubble is, as fractions of the field (y = 0 is the top). */
	function position(b, t) {
		const p = progress(b, t);
		return { x: b.x0 + b.amp * Math.sin(b.ph + p * b.freq * Math.PI * 2), y: 1.08 - 1.16 * p };
	}

	const alive = (b, t, grace = 0) => {
		const p = progress(b, t);
		return p >= 0 && p <= 1 + grace / b.dur;
	};

	const multiplier = (streak) => Math.min(MAX_MULT, 1 + Math.floor(streak / 4));

	/**
	 * What popping `b` is worth to a player on `team` holding `streak`
	 * (counted before this pop). `kind` is what happened: a pop, a denial
	 * (the other side's colour, worth nothing) or a bomb.
	 */
	function popPoints(b, mode, team, streak) {
		if (b.k === "x") return { pts: b.pts, mult: 1, kind: "bomb" };
		if (mode === "teams" && b.team && b.team !== team) return { pts: 0, mult: 1, kind: "deny" };
		const mult = multiplier(streak);
		return { pts: b.pts * mult, mult, kind: "pop" };
	}

	/** Whether any of `b` shows above the field's bottom edge at `t` (r is in widths; y in heights). */
	const surfaced = (b, t) => position(b, t).y - b.r * FIELD_ASPECT < 1;

	/**
	 * The bubble under a finger at (x, y) — fractions of the field — at round
	 * time `t`: the nearest one on the field within its radius and a
	 * fingertip's slack, or null. Distances are in field widths, the field's
	 * shape being fixed. The host judges taps with this; a phone uses the same
	 * to pop its own bubble at once while the host's word is on its way.
	 */
	function hitTest(bubbles, x, y, t) {
		let hit = null;
		let best = Infinity;
		for (const b of bubbles) {
			if (!alive(b, t) || !surfaced(b, t)) continue;
			const p = position(b, t);
			const d = Math.hypot(p.x - x, (p.y - y) / FIELD_ASPECT);
			if (d <= b.r + SLACK && d < best) {
				hit = b;
				best = d;
			}
		}
		return hit;
	}

	/** A team's score is its players' average, so a small side is not simply outnumbered. */
	function teamScores(scores, seatsA, seatsB) {
		const avg = (ids) => (ids.length ? ids.reduce((s, id) => s + (scores[id] ?? 0), 0) / ids.length : 0);
		return { A: avg(seatsA), B: avg(seatsB) };
	}

	/** Places, best first; equal scores share a place. */
	function ranking(scores, ids) {
		const sorted = [...ids].sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
		const out = [];
		for (const id of sorted) {
			const last = out.at(-1);
			if (last && (scores[last[0]] ?? 0) === (scores[id] ?? 0)) last.push(id);
			else out.push([id]);
		}
		return out;
	}

	/** Teams' places: the winners, then the losers; a tie is one place. Empty sides are left out. */
	function teamRanking(scores, seatsA, seatsB) {
		const ts = teamScores(scores, seatsA, seatsB);
		if (!seatsA.length || !seatsB.length || ts.A === ts.B) {
			const all = [...seatsA, ...seatsB];
			return all.length ? [all] : [];
		}
		return ts.A > ts.B ? [seatsA, seatsB] : [seatsB, seatsA];
	}

	/**
	 * A bot's next tap: `{ id }` a bubble, `{ miss: true }`, or null for
	 * nothing it can see yet. It goes for golden first, then the most valuable
	 * bubble it may score (the one nearest escaping, among equals), and in
	 * TEAMS sometimes takes one of the other side's instead. It leaves bombs
	 * alone, but now and then slips — a person does too.
	 */
	function botPick(bubbles, t, team, mode, rng) {
		const seen = bubbles.filter((b) => t - b.born >= BOT_REACT_MS && alive(b, t) && surfaced(b, t) && progress(b, t) < 0.97);
		if (!seen.length) return null;
		if (rng() < BOT_MISS) return { miss: true };
		const bombs = seen.filter((b) => b.k === "x");
		if (bombs.length && rng() < BOT_BOMB) return { id: bombs[Math.floor(rng() * bombs.length)].id };
		const golden = seen.filter((b) => b.k === "g");
		if (golden.length) return { id: golden[0].id };
		const theirs = mode === "teams" ? seen.filter((b) => b.k === "n" && b.team && b.team !== team) : [];
		if (theirs.length && rng() < BOT_DENY) return { id: theirs[Math.floor(rng() * theirs.length)].id };
		const mine = seen.filter((b) => b.k === "n" && !theirs.includes(b));
		if (!mine.length) return theirs.length ? { id: theirs[0].id } : null;
		mine.sort((a, b) => b.pts - a.pts || progress(b, t) - progress(a, t));
		return { id: mine[0].id };
	}

	// ------------------------------------------------------------ the round
	//
	// SDK v2 managed state with a fixed tick. The platform calls `tick` HZ
	// times a second on the host, with each bot's latest input (`bot()`); a
	// person's tap is an action (`apply`), judged against the host's own
	// bubbles. Time is the tick's `dt`: no clock is read, so a host out of the
	// app (the platform stops ticking) stops spawns, bots, stuns and the
	// countdown at once, and a snapshot carries the whole round to the heir.

	/** Two averages as shown: whole numbers, or one decimal when the whole numbers would look equal. */
	function averages(a, b) {
		const one = Math.round(a) === Math.round(b) && a !== b;
		const show = (v) => (one ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v)));
		return [show(a), show(b)];
	}

	/** "Free-for-all" / "Teams", for the end card. */
	const modeName = (mode) => (mode === "teams" ? "Teams" : "Free-for-all");

	/**
	 * The round as managed rules. `isHost(id)`: whether that player may pick
	 * the mode and start (the page passes the party's host; tests may leave it
	 * out, and then anyone may). `sideOf(id)`: the party's side for a player
	 * now ("A" | "B"), read while the next round is being set up, so moving
	 * someone to Team B in the party makes TEAMS possible at once rather than
	 * one round later (the seats `init` got are the party as the round opened).
	 */
	function game({ isHost = () => true, sideOf = () => null } = {}) {
		let s = null;

		const seated = (id) => s.seats.some((p) => p.id === id && !s.left.includes(id));
		const teamOf = (id) => s.seats.find((p) => p.id === id)?.team ?? null;
		const side = (team) => s.seats.filter((p) => p.team === team && !s.left.includes(p.id)).map((p) => p.id);
		/** Everyone who played on a side, leavers too: a side's average counts what they scored. */
		const sideAll = (team) => s.seats.filter((p) => p.team === team).map((p) => p.id);
		const teamsOk = () => side("A").length > 0 && side("B").length > 0;
		const players = () => s.seats.filter((p) => !s.left.includes(p.id)).map((p) => p.id);
		const nameOf = (id) => s.seats.find((p) => p.id === id)?.name ?? "Player";
		/** A player's streak as it stands at `t` — a pause between pops has broken it. */
		const streakAt = (id, t) => (t - (s.lastPop[id] ?? -Infinity) > STREAK_MS ? 0 : (s.streaks[id] ?? 0));
		const rnd = () => nextRandom(s);
		const between = ([lo, hi]) => lo + rnd() * (hi - lo);
		/** A bot's next tap: its usual beat, or now and then a lapse long enough to break its streak. */
		const nextBot = () => (rnd() < BOT_HESITATE ? between(BOT_HESITATE_MS) : between(BOT_EVERY_MS));

		/**
		 * The mode the round would be played in: TEAMS needs both sides;
		 * otherwise the host's pick, or TEAMS if they have not made one.
		 */
		const fitMode = (wanted) => (!teamsOk() ? "ffa" : s.chosen ? wanted : "teams");

		/** While the host sets up: the party's sides as they are now. */
		function resync() {
			if (s.phase !== "setup") return;
			for (const p of s.seats) {
				const now = sideOf(p.id);
				if (now === "A" || now === "B") p.team = now;
			}
			s.mode = fitMode(s.want);
		}

		/** Pop `b` for `id`, now (host round time). The one place scores change. */
		function pop(id, b) {
			const streak = streakAt(id, s.t);
			const got = popPoints(b, s.mode, teamOf(id), streak);
			s.bubbles = s.bubbles.filter((x) => x !== b);
			s.gone.push({ b, at: s.t });
			s.scores[id] = (s.scores[id] ?? 0) + got.pts;
			if (got.kind === "bomb") {
				s.streaks[id] = 0;
				s.stun[id] = s.t + STUN_MS;
				s.stats.bombs[id] = (s.stats.bombs[id] ?? 0) + 1;
			} else {
				s.streaks[id] = streak + 1;
				s.lastPop[id] = s.t;
				s.pops++;
				s.stats.popped[id] = (s.stats.popped[id] ?? 0) + 1;
				if (b.k === "g") s.stats.golden++;
				if (got.kind === "deny") s.stats.denied++;
				if (s.streaks[id] > (s.stats.best[id] ?? 0)) s.stats.best[id] = s.streaks[id];
			}
			const at = position(b, clamp(s.t, b.born, b.born + b.dur));
			const ev = { seq: ++s.seq, by: id, kind: got.kind, k: b.k, team: b.team, pts: got.pts, mult: got.mult, x: round4(at.x), y: round4(at.y), r: b.r };
			s.events = [...s.events.slice(-11), ev];
		}

		/** A miss: the streak breaks, nothing else. */
		function miss(id) {
			s.streaks[id] = 0;
			s.stats.misses[id] = (s.stats.misses[id] ?? 0) + 1;
		}

		function spawn() {
			const n = Math.max(1, s.seats.length);
			while (s.spawnAt <= s.t + LEAD_MS && s.spawnAt < ROUND_MS) {
				s.bubbles.push(makeBubble(rnd, s.nextId++, s.spawnAt, s.mode));
				s.spawnAt += spawnInterval(s.spawnAt, n);
			}
			// Kept a little past the top: a tap made as one escaped may still be on its way.
			s.bubbles = s.bubbles.filter((b) => b.born > s.t || s.t - (b.born + b.dur) <= LAG_MS);
			s.gone = s.gone.filter((g) => s.t - g.at <= LAG_MS + AHEAD_MS);
		}

		/**
		 * The host's word on a person's tap `{ x, y, t, n? }`: nothing (popped
		 * or missed), or why it was refused. Every judged tap is acknowledged
		 * (`n`, in that player's view), so their phone knows when to stop
		 * hiding a bubble it popped on its own.
		 */
		function tap(by, a) {
			if (s.phase !== "play") return "the round is not on";
			if (!seated(by)) return "you are watching";
			const { x, y, t } = a;
			if (![x, y, t].every((v) => typeof v === "number" && Number.isFinite(v))) return "not a tap";
			if (Number.isSafeInteger(a.n) && a.n > (s.ack[by] ?? 0)) s.ack[by] = a.n;
			if ((s.stun[by] ?? -Infinity) > s.t) return "stunned";
			if (x < -EDGE || x > 1 + EDGE || y < -EDGE || y > 1 + EDGE) return "not on the field";
			if ((s.taps[by] ?? 0) >= TAPS_PER_TICK) return "too fast";
			s.taps[by] = (s.taps[by] ?? 0) + 1;
			// When the phone drew what was tapped: trusted only within the
			// window — behind the host's clock for a guest, a little ahead for
			// the host's own seat — and never earlier than this player's last tap.
			const ahead = isHost(by) ? AHEAD_MS : 0;
			const when = Math.max(clamp(t, Math.max(0, s.t - LAG_MS), s.t + ahead), s.lastT[by] ?? -Infinity);
			s.lastT[by] = when;
			// Only bubbles born on the host by now: the views carry them earlier.
			const live = s.bubbles.filter((b) => b.born <= s.t);
			const gone = s.gone.map((g) => g.b);
			const b = hitTest([...live, ...gone], x, y, when);
			if (b && live.includes(b)) return void pop(by, b);
			// The nearest bubble under the finger went to someone a moment before
			// (or to this phone's own earlier tap): no penalty.
			if (b) return "someone popped it first";
			miss(by);
		}

		function endRound() {
			s.t = ROUND_MS;
			s.phase = "over";
		}

		/** The bot's input, as `tick` takes it: numbered, so it is applied once. */
		function botTap(id, inp) {
			if (!inp || inp.n !== (s.botN[id] ?? 0) + 1) return;
			s.botN[id] = inp.n;
			s.botDue[id] = s.t + nextBot();
			if ((s.stun[id] ?? -Infinity) > s.t) return;
			if (inp.miss) return miss(id);
			const b = s.bubbles.find((x) => x.id === inp.b);
			// Gone by the time it landed (someone else's, or escaped): a bot just tries again.
			if (b && alive(b, s.t)) pop(id, b);
		}

		return {
			init({ seats, seed, match }) {
				const was = s;
				s = {
					match,
					phase: "setup", // "setup" | "count" | "play" | "over"
					mode: "ffa",
					chosen: !!was?.chosen, // the host picked a mode: kept between rounds
					want: was?.want ?? "teams", // which one they picked
					t: -COUNT_MS, // round time: −COUNT_MS through the countdown to ROUND_MS
					seats: seats.map((p) => ({ id: p.id, name: p.name ?? "Player", team: p.team === "B" ? "B" : "A", bot: !!p.bot })),
					left: [],
					bubbles: [],
					gone: [], // popped a moment ago: { b, at }
					nextId: 1,
					spawnAt: 0,
					scores: {},
					streaks: {},
					lastPop: {},
					stun: {},
					taps: {}, // taps this tick, per player
					events: [], // the last few pops, for effects on every phone
					seq: 0,
					pops: 0,
					stats: { popped: {}, best: {}, bombs: {}, misses: {}, golden: 0, denied: 0 },
					botDue: {},
					botN: {},
					lastT: {}, // per player: the time their last tap was judged at (taps never go back)
					ack: {}, // per player: the number of their last judged tap
					alone: seats.length === 1 && !seats[0].bot, // played alone from the start: a solo run
					rng: seed >>> 0,
				};
				s.mode = fitMode(s.want);
			},

			apply({ action, by }) {
				if (!action || typeof action !== "object") return "no such move";
				if (action.tap && typeof action.tap === "object") return tap(by, action.tap);
				if (action.mode !== undefined || action.start) {
					if (s.phase !== "setup") return "the round has started";
					if (!isHost(by)) return "the host picks";
					resync();
					if (action.mode !== undefined) {
						if (action.mode !== "ffa" && action.mode !== "teams") return "no such mode";
						if (action.mode === "teams" && !teamsOk()) return "TEAMS needs players on Team A and Team B";
						s.mode = s.want = action.mode;
						s.chosen = true;
						return;
					}
					if (!players().length) return "nobody is playing";
					s.phase = "count";
					return;
				}
				return "no such move";
			},

			tick({ inputs, dt }) {
				resync();
				if (s.phase !== "count" && s.phase !== "play") return;
				s.t = Math.min(ROUND_MS, s.t + dt * 1000);
				s.taps = {};
				if (s.phase === "count") {
					if (s.t < 0) return;
					s.phase = "play";
					for (const p of s.seats) if (p.bot) s.botDue[p.id] = s.t + nextBot();
				}
				spawn();
				for (const p of s.seats) if (p.bot && !s.left.includes(p.id)) botTap(p.id, inputs?.[p.id]);
				if (s.t >= ROUND_MS) endRound();
			},

			view({ seat }) {
				const st = {};
				for (const id of players()) st[id] = [s.streaks[id] ?? 0, s.lastPop[id] ?? null];
				const stun = {};
				for (const [id, until] of Object.entries(s.stun)) if (until > s.t) stun[id] = Math.round(until - s.t);
				return {
					match: s.match,
					phase: s.phase,
					mode: s.mode,
					teamsOk: teamsOk(),
					t: Math.round(s.t),
					seats: s.seats.filter((p) => !s.left.includes(p.id)).map((p) => [p.id, p.team]),
					scores: { ...s.scores },
					st,
					stun,
					bubbles: s.bubbles.filter((b) => s.t <= b.born + b.dur).map(pack),
					events: s.events,
					seq: s.seq,
					you: seat && seated(seat) ? seat : null,
					// This seat's own count: its last judged tap, pops, misses, bombs.
					ack: (seat && s.ack[seat]) || 0,
					mine: seat ? { popped: s.stats.popped[seat] ?? 0, misses: s.stats.misses[seat] ?? 0, bombs: s.stats.bombs[seat] ?? 0 } : null,
					popped: { ...s.stats.popped },
					// Team averages, leavers' scores included (they still count for their side).
					...(s.mode === "teams" ? { avg: teamScores(s.scores, sideAll("A"), sideAll("B")) } : {}),
				};
			},

			// Real time: nobody is waited on, so no turn-wait banner.
			turn: () => [],

			/** Only when its next tap is due: what it would tap now. */
			bot({ seat }) {
				if (s.phase !== "play" || !seated(seat)) return null;
				if (s.t < (s.botDue[seat] ?? Infinity) || (s.stun[seat] ?? -Infinity) > s.t) return null;
				const pick = botPick(s.bubbles, s.t, teamOf(seat), s.mode, rnd);
				if (!pick) return null;
				const n = (s.botN[seat] ?? 0) + 1;
				return pick.miss ? { n, miss: true } : { n, b: pick.id };
			},

			/**
			 * The round's places. Teams: the side with the higher average first,
			 * each side one slot (kind "teams"), leavers counted in their side's
			 * average but out of the places; free-for-all: by score, ties sharing
			 * (kind "ffa"); a round begun alone: played, with the score (kind
			 * "coop", never below zero: the arcade's server refuses that).
			 */
			result() {
				if (s.phase !== "over") return null;
				const ids = players();
				const scores = Object.fromEntries(ids.map((id) => [id, s.scores[id] ?? 0]));
				const total = (o) => Object.values(o).reduce((a, b) => a + b, 0);
				const bestId = ids.reduce((a, id) => ((s.stats.best[id] ?? 0) > (s.stats.best[a] ?? 0) ? id : a), ids[0]);
				const best = s.stats.best[bestId] ?? 0;
				const details = [
					{ label: "Mode", value: modeName(s.mode) },
					{ label: "Bubbles popped", value: s.pops },
					{ label: "Best streak", value: best ? `${best} (×${multiplier(best - 1)})${ids.length > 1 ? ` by ${nameOf(bestId)}` : ""}` : "none" },
					{ label: "Golden caught", value: s.stats.golden },
					{ label: "Bombs hit", value: total(s.stats.bombs) },
				];
				if (s.alone && ids.length === 1) {
					details.push({ label: "Misses", value: total(s.stats.misses) });
					const mine = scores[ids[0]];
					return { kind: "coop", ranking: [ids], scores: { [ids[0]]: Math.max(0, mine) }, title: `${mine} POINTS`, details };
				}
				if (s.mode === "teams") {
					const ts = teamScores(s.scores, sideAll("A"), sideAll("B"));
					const [ta, tb] = averages(ts.A, ts.B);
					details.push({ label: "Denied", value: s.stats.denied });
					details.push({ label: "Team A average", value: `${ta} (${sideAll("A").length})` });
					details.push({ label: "Team B average", value: `${tb} (${sideAll("B").length})` });
					const first = ts.A > ts.B ? "A" : ts.B > ts.A ? "B" : null;
					const here = { A: side("A"), B: side("B") };
					const r = (first ? [here[first], here[first === "A" ? "B" : "A"]] : [[...here.A, ...here.B]]).filter((x) => x.length);
					// Both sides still here: the card says YOU WIN / X & Y WIN itself.
					// A side that has emptied is not in the places, so the title says who won.
					const title = !first ? "A TIE" : here.A.length && here.B.length ? null : `TEAM ${first} WINS`;
					return { kind: "teams", ranking: r, scores, ...(title ? { title } : {}), details };
				}
				const r = ranking(s.scores, ids);
				return { kind: "ffa", ranking: r, scores, ...(r.length === 1 && ids.length > 1 ? { title: "A TIE" } : {}), details };
			},

			/**
			 * A player who left the party is out of the round: no more taps, out
			 * of the places. In TEAMS what they scored still counts for their
			 * side, so leaving cannot raise a side's average.
			 */
			leave({ seat }) {
				if (!s.seats.some((p) => p.id === seat) || s.left.includes(seat)) return false;
				s.left.push(seat);
				return true;
			},

			// The state is plain JSON, the generator's included: the heir carries
			// the round on from the copy (at most a second old), mid-flight.
			snapshot: () => s,
			restore({ snapshot }) {
				s = JSON.parse(JSON.stringify(snapshot));
				s.taps = {};
			},
		};
	}

	globalThis.bubbleRushRules = {
		ROUND_MS, COUNT_MS, FRENZY_MS, HZ, FIELD_ASPECT, SIZES, GOLDEN, BOMB, STREAK_MS, STUN_MS, MAX_MULT, LAG_MS, AHEAD_MS, SLACK, EDGE, LEAD_MS,
		BOT_EVERY_MS, BOT_REACT_MS, BOT_HESITATE, BOT_HESITATE_MS, TAPS_PER_TICK,
		rngFrom, riseMs, bombChance, spawnInterval, makeBubble, pack, unpack, progress, position, alive, surfaced, multiplier, popPoints,
		hitTest, teamScores, averages, ranking, teamRanking, botPick, game,
	};
})();
