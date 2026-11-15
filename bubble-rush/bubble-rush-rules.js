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
// ## Who popped what: the host decides
//
// A phone sends where the finger landed, as fractions of its field, with the
// field's size and the round time it was drawing — never which bubble it
// thinks it hit. The host puts every bubble where it was at that time and
// takes the nearest one under the finger, a fingertip's slack around it.
// The time is trusted only within a window behind the host's clock (the
// view's trip out plus the tap's trip back), so a phone cannot name a bubble,
// cannot pop one that was never under its finger, and cannot reach far back
// in time; a tap on a bubble someone popped first is refused without
// penalty, and a tap on empty field is a miss.

(() => {
	const ROUND_MS = 60_000;
	const COUNT_MS = 3000;
	const FRENZY_MS = 10_000; // the last ten seconds
	const FRENZY_SPAWN = 1.5;
	const HZ = 10; // game.json "tick"

	// r is a fraction of the field's shorter side — on a phone held upright,
	// its width, where the smallest is still a fingertip across. speed scales
	// the rise time.
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
	const AHEAD_MS = 150; // and ahead: the host's clock moves on between ticks
	const SLACK_PX = 10; // a fingertip is not a pixel
	const MIN_FIELD_PX = 240; // a claimed field smaller than this is taken as this (no giant slack)
	const MAX_FIELD_PX = 4000;
	const TAPS_PER_TICK = 3; // per player: a double tap is fine, a flood is not
	// Spawned this far ahead of their birth, so every phone has a bubble
	// before it surfaces from below the field.
	const LEAD_MS = 400;

	// Bots. Supply is what these are tuned against: two players see 3.5–7
	// bubbles a second — enough that the field stays full and choosing which
	// to pop matters — a bot takes about 1.3 of them, and someone paying
	// attention takes more. A bot does not see a bubble until it has been on
	// screen a moment, and now and then it misses or hits a bomb.
	const BOT_EVERY_MS = [600, 900];
	const BOT_REACT_MS = 400;
	const BOT_MISS = 0.08;
	const BOT_BOMB = 0.06;
	const BOT_DENY = 0.3;

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

	/**
	 * The bubble under a finger at (x, y) — fractions of a w × h field (CSS
	 * pixels) — at round time `t`: the nearest one within its radius and a
	 * fingertip's slack, or null. The host judges taps with this; a phone uses
	 * the same to pop its own bubble at once while the host's word is on its way.
	 */
	function hitTest(bubbles, x, y, t, w, h) {
		const side = Math.min(w, h);
		let hit = null;
		let best = Infinity;
		for (const b of bubbles) {
			if (!alive(b, t)) continue;
			const p = position(b, t);
			const d = Math.hypot((p.x - x) * w, (p.y - y) * h);
			if (d <= b.r * side + SLACK_PX && d < best) {
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
		const seen = bubbles.filter((b) => t - b.born >= BOT_REACT_MS && alive(b, t) && progress(b, t) < 0.97);
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
		const teamsOk = () => side("A").length > 0 && side("B").length > 0;
		const players = () => s.seats.filter((p) => !s.left.includes(p.id)).map((p) => p.id);
		const nameOf = (id) => s.seats.find((p) => p.id === id)?.name ?? "Player";
		/** A player's streak as it stands at `t` — a pause between pops has broken it. */
		const streakAt = (id, t) => (t - (s.lastPop[id] ?? -Infinity) > STREAK_MS ? 0 : (s.streaks[id] ?? 0));
		const rnd = () => nextRandom(s);
		const nextBot = () => BOT_EVERY_MS[0] + rnd() * (BOT_EVERY_MS[1] - BOT_EVERY_MS[0]);

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

		/** The host's word on a person's tap: nothing (popped or missed), or why it was refused. */
		function tap(by, a) {
			if (s.phase !== "play") return "the round is not on";
			if (!seated(by)) return "you are watching";
			if ((s.stun[by] ?? -Infinity) > s.t) return "stunned";
			const { x, y, t } = a;
			if (![x, y, t, a.w, a.h].every(Number.isFinite)) return "not a tap";
			if (x < -0.1 || x > 1.1 || y < -0.1 || y > 1.1) return "not on the field";
			if ((s.taps[by] ?? 0) >= TAPS_PER_TICK) return "too fast";
			s.taps[by] = (s.taps[by] ?? 0) + 1;
			const w = clamp(a.w, MIN_FIELD_PX, MAX_FIELD_PX);
			const h = clamp(a.h, MIN_FIELD_PX, MAX_FIELD_PX);
			// When the phone drew what was tapped: trusted only within the window.
			const when = clamp(t, Math.max(0, s.t - LAG_MS), s.t + AHEAD_MS);
			const b = hitTest(s.bubbles, x, y, when, w, h);
			if (b) return void pop(by, b);
			// Someone got there first (or this phone, a moment ago): no penalty.
			if (hitTest(s.gone.map((g) => g.b), x, y, when, w, h)) return "someone popped it first";
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
			 * each side one slot (kind "teams"); free-for-all: by score, ties
			 * sharing (kind "ffa"); alone: played, with the score (kind "coop").
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
				if (ids.length === 1 && !s.seats.find((p) => p.id === ids[0])?.bot) {
					details.push({ label: "Misses", value: total(s.stats.misses) });
					return { kind: "coop", ranking: [ids], scores, title: `${scores[ids[0]]} POINTS`, details };
				}
				if (s.mode === "teams" && teamsOk()) {
					const a = side("A");
					const b = side("B");
					const ts = teamScores(s.scores, a, b);
					details.push({ label: "Denied", value: s.stats.denied });
					details.push({ label: "Team A average", value: `${Math.round(ts.A)} (${a.length})` });
					details.push({ label: "Team B average", value: `${Math.round(ts.B)} (${b.length})` });
					const r = teamRanking(s.scores, a, b);
					return { kind: "teams", ranking: r, scores, ...(r.length === 1 ? { title: "A TIE" } : {}), details };
				}
				const r = ranking(s.scores, ids);
				return { kind: "ffa", ranking: r, scores, ...(r.length === 1 && ids.length > 1 ? { title: "A TIE" } : {}), details };
			},

			/** A player who left the party is out of the round; what they scored no longer counts. */
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
		ROUND_MS, COUNT_MS, FRENZY_MS, HZ, SIZES, GOLDEN, BOMB, STREAK_MS, STUN_MS, MAX_MULT, LAG_MS, AHEAD_MS, SLACK_PX, LEAD_MS,
		BOT_EVERY_MS, BOT_REACT_MS, TAPS_PER_TICK,
		rngFrom, riseMs, bombChance, spawnInterval, makeBubble, pack, unpack, progress, position, alive, multiplier, popPoints,
		hitTest, teamScores, ranking, teamRanking, botPick, game,
	};
})();
