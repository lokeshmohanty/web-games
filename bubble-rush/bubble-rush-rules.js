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
// ## Who popped what: the tapping phone decides
//
// Lokesh, 2026-11-21: "the tap is registered after a delay costing
// experience of the game, register whether the tap succeeded on the player's
// device itself". So a tap is judged where it lands: the phone hit-tests the
// finger against the frame it was showing (`hitTest`), and scores it at once
// with `judgeTap` — the pop, the points, the streak, a bomb's stun, a miss
// breaking the streak — then tells the host which bubble it popped (or that
// it missed) and at what round time. The host takes its word: no window, no
// check that the finger was on the bubble (casual play among friends: the
// arcade does not spend a player's time on anti-cheat). It runs the same
// `judgeTap` on the same numbers, so its score for that player is the one
// their phone already showed, and relays the pop: the bubble goes from
// everyone else's field with the next view.
//
// After a handover the heir's field is respawned from the copy and its
// random stream drifts (a bot's draws land elsewhere), so bubble N there is
// born when it was on the old host (spawn times draw nothing) but is another
// bubble. A pop also says the bubble's birth, kind and starting place (x0,
// drawn from the stream): when the named bubble is not that one, the host
// takes what was under the finger instead.
//
// The round's end: at the bell the field freezes for GRACE_MS, taking taps
// made before the bell that are still on their way (none made after it:
// the phone takes no touch on the frozen field), and only then ends. Every tap is acknowledged, refused ones
// too, so a phone always settles on the host's score.
//
// Two phones on one bubble: both keep the pop. A bubble popped a moment ago
// by someone else is still known to the host (`gone`, KEEP_MS), and a second
// player's pop of it scores for them too. Nothing is taken back from a phone
// that showed a pop, so nobody sees points vanish; the cost is a bubble that
// once in a while scores twice, which a casual round can afford. A pop the
// host cannot place at all (the bubble long gone, the round over, a watcher)
// is refused, and that phone's score quietly settles on the host's.

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

	// Taps, judged on the tapping phone.
	const SLACK = 0.03; // a fingertip is not a point: a fraction of the field's width (~11 px on a phone)
	// How long the host keeps a bubble after it escaped or was popped, so a
	// pop of it still on its way (a slow link, a busy phone) can be placed.
	// Bookkeeping, not a judgement: no tap is refused for its time.
	const KEEP_MS = 3000;
	// At the bell the field freezes and the round stays open this long, so a
	// pop a phone made in its last frame (its tap still on the way) is
	// counted before the end card: nothing a phone showed is taken back.
	const GRACE_MS = 400;
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
	 * shape being fixed. The tapping phone judges its own tap with this.
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

	/**
	 * One tap, judged: by the tapping phone at once, and by the host again
	 * with the same numbers, so both come to the same score. `me` is that
	 * player's own ledger, { streak, lastPop, stun } (their streak as it was
	 * last set, the round time of their last pop, and when a bomb's stun ends:
	 * nobody else's taps change it); `b` the bubble popped, or null for a miss;
	 * `t` the round time the finger landed on; `team` the tapper's side.
	 * Returns null while stunned (the tap does nothing), else { kind: "pop" |
	 * "deny" | "bomb" | "miss", pts, mult, me: the ledger after it }.
	 */
	function judgeTap(me, b, t, mode, team) {
		if ((me.stun ?? -Infinity) > t) return null;
		// A pause between pops has broken the streak by now.
		const streak = t - (me.lastPop ?? -Infinity) > STREAK_MS ? 0 : (me.streak ?? 0);
		if (!b) return { kind: "miss", pts: 0, mult: 1, me: { ...me, streak: 0 } };
		const got = popPoints(b, mode, team, streak);
		if (got.kind === "bomb") return { ...got, me: { ...me, streak: 0, stun: t + STUN_MS } };
		return { ...got, me: { ...me, streak: streak + 1, lastPop: t } };
	}

	/**
	 * The round time a tap names, kept on the round: the phone sends it so,
	 * the host reads it so. Rounded down, so a tap before the bell stays
	 * before it.
	 */
	const tapTime = (t) => Math.floor(clamp(t, 0, ROUND_MS));

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
	// person's tap is an action (`apply`), already judged on their phone.
	// Time is the tick's `dt`: no clock is read, so a host out of the
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
		/** A player's own ledger, as judgeTap takes it. */
		const ledger = (id) => ({ streak: s.streaks[id] ?? 0, lastPop: s.lastPop[id] ?? null, stun: s.stun[id] ?? null });
		const rnd = () => nextRandom(s);
		const between = ([lo, hi]) => lo + rnd() * (hi - lo);
		/** A bot's next tap: its usual beat, or now and then a lapse long enough to break its streak. */
		const nextBot = () => (rnd() < BOT_HESITATE ? between(BOT_HESITATE_MS) : between(BOT_EVERY_MS));

		/**
		 * The mode the round would be played in: TEAMS needs both sides, so
		 * without them it is FREE-FOR-ALL; otherwise the host's pick, or null
		 * until they make one. Lokesh (2026-11-18): the game asks every round,
		 * with no default and nothing kept from the last one.
		 */
		const fitMode = (wanted) => (!teamsOk() ? "ffa" : wanted);

		/** While the host sets up: the party's sides as they are now. */
		function resync() {
			if (s.phase !== "setup") return;
			for (const p of s.seats) {
				const now = sideOf(p.id);
				if (now === "A" || now === "B") p.team = now;
			}
			s.mode = fitMode(s.want);
		}

		/**
		 * `id` pops `b` (or misses: b null) at round time `t` — a bot now, a
		 * person when their finger landed. The one place scores change. False
		 * when it did nothing (stunned).
		 */
		function score(id, b, t) {
			const got = judgeTap(ledger(id), b, t, s.mode, teamOf(id));
			if (!got) return false;
			s.streaks[id] = got.me.streak;
			s.lastPop[id] = got.me.lastPop;
			s.stun[id] = got.me.stun;
			if (!b) {
				s.stats.misses[id] = (s.stats.misses[id] ?? 0) + 1;
				return true;
			}
			const was = s.gone.find((g) => g.b.id === b.id);
			// The first pop takes it off the field; a second player's pop of
			// the same bubble (both phones showed it) scores for them as well,
			// but the round's counts (pops, golden, denied) are of bubbles.
			if (was) was.by.push(id);
			else {
				s.bubbles = s.bubbles.filter((x) => x.id !== b.id);
				s.gone.push({ b, at: s.t, by: [id] });
			}
			s.scores[id] = (s.scores[id] ?? 0) + got.pts;
			if (got.kind === "bomb") {
				s.stats.bombs[id] = (s.stats.bombs[id] ?? 0) + 1;
			} else {
				if (!was) s.pops++;
				s.stats.popped[id] = (s.stats.popped[id] ?? 0) + 1;
				if (!was && b.k === "g") s.stats.golden++;
				if (!was && got.kind === "deny") s.stats.denied++;
				if (s.streaks[id] > (s.stats.best[id] ?? 0)) s.stats.best[id] = s.streaks[id];
			}
			const at = position(b, clamp(t, b.born, b.born + b.dur));
			const ev = { seq: ++s.seq, by: id, kind: got.kind, k: b.k, team: b.team, pts: got.pts, mult: got.mult, x: round4(at.x), y: round4(at.y), r: b.r };
			s.events = [...s.events.slice(-11), ev];
			return true;
		}

		function spawn() {
			const n = Math.max(1, s.seats.length);
			while (s.spawnAt <= s.t + LEAD_MS && s.spawnAt < ROUND_MS) {
				s.bubbles.push(makeBubble(rnd, s.nextId++, s.spawnAt, s.mode));
				s.spawnAt += spawnInterval(s.spawnAt, n);
			}
			// Kept a while past the top: a pop of one as it escaped may still be on its way.
			s.bubbles = s.bubbles.filter((b) => b.born > s.t || s.t - (b.born + b.dur) <= KEEP_MS);
			s.gone = s.gone.filter((g) => s.t - g.at <= KEEP_MS);
		}

		/**
		 * A person's tap, already judged on their phone: `{ b, born?, k?, x0?, x,
		 * y, t, n? }`, `b` the id of the bubble it popped (with its birth, kind
		 * and starting place)
		 * or null for a miss, `t` the round time the finger landed on, x and y
		 * where. Taken as said and scored with judgeTap, as the phone scored it;
		 * refused only when it cannot be placed. Every tap is acknowledged
		 * (`n`, in that player's view), refused ones too, so their phone knows
		 * when the host's score holds it — or that it never will.
		 */
		function tap(by, a) {
			if (Number.isSafeInteger(a.n) && a.n > (s.ack[by] ?? 0)) s.ack[by] = a.n;
			if (s.phase !== "play") return "the round is not on";
			if (!seated(by)) return "you are watching";
			if (typeof a.t !== "number" || !Number.isFinite(a.t)) return "not a tap";
			// Made at the bell or after, on the frozen field: the grace is for
			// taps made before it.
			if (a.t >= ROUND_MS) return "the round is over";
			const t = tapTime(a.t);
			const onField = (x, y) => typeof x === "number" && typeof y === "number";
			// Still here, or popped a moment ago by someone else (both keep it).
			const known = [...s.bubbles, ...s.gone.filter((g) => !g.by.includes(by)).map((g) => g.b)];
			let b = null;
			if (!("b" in a) && onField(a.x, a.y)) {
				// A phone on the old rules sends only where the finger landed:
				// the host hit-tests it at that time, as that phone drew it.
				b = hitTest(s.bubbles, a.x, a.y, t);
			} else if (a.b != null) {
				b = known.find((x) => x.id === a.b) ?? null;
				// Not the bubble the phone popped (an heir's ids drift from the old
				// host's): the one under the finger then, if any.
				const same = b && (a.born === undefined || b.born === a.born) && (a.k === undefined || b.k === a.k) && (a.x0 === undefined || Math.abs(b.x0 - a.x0) < 1e-3);
				if (!same) b = onField(a.x, a.y) ? hitTest(known, a.x, a.y, t) : null;
				// Long gone, or popped by this player already: nothing to place.
				if (!b) return "that bubble is gone";
			}
			if (!score(by, b, t)) return "stunned";
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
			if (inp.miss) return void score(id, null, s.t);
			const b = s.bubbles.find((x) => x.id === inp.b);
			// Gone by the time it landed (someone else's, or escaped): a bot just tries again.
			if (b && alive(b, s.t)) score(id, b, s.t);
		}

		return {
			init({ seats, seed, match }) {
				s = {
					match,
					phase: "setup", // "setup" | "count" | "play" | "over"
					mode: "ffa",
					want: null, // the host's pick this round: asked anew every round
					t: -COUNT_MS, // round time: −COUNT_MS through the countdown to ROUND_MS
					seats: seats.map((p) => ({ id: p.id, name: p.name ?? "Player", team: p.team === "B" ? "B" : "A", bot: !!p.bot })),
					left: [],
					bubbles: [],
					gone: [], // popped a moment ago: { b, at, by: [who popped it] }
					nextId: 1,
					spawnAt: 0,
					scores: {},
					streaks: {},
					lastPop: {},
					stun: {},
					events: [], // the last few pops, for effects on every phone
					seq: 0,
					pops: 0,
					stats: { popped: {}, best: {}, bombs: {}, misses: {}, golden: 0, denied: 0 },
					botDue: {},
					botN: {},
					ack: {}, // per player: the number of their last tap taken
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
						return;
					}
					if (!s.mode) return "pick FREE-FOR-ALL or TEAMS first";
					if (!players().length) return "nobody is playing";
					s.phase = "count";
					return;
				}
				return "no such move";
			},

			tick({ inputs, dt }) {
				resync();
				if (s.phase !== "count" && s.phase !== "play") return;
				const was = s.t;
				s.t = Math.min(ROUND_MS, s.t + dt * 1000);
				// The bell has gone: the field stays frozen for the grace, taking
				// the taps made by then, and then the round is over.
				if (was >= ROUND_MS) {
					s.grace = (s.grace ?? 0) + dt * 1000;
					if (s.grace >= GRACE_MS - 1e-6) endRound();
					return;
				}
				if (s.phase === "count") {
					if (s.t < 0) return;
					s.phase = "play";
					for (const p of s.seats) if (p.bot) s.botDue[p.id] = s.t + nextBot();
				}
				spawn();
				for (const p of s.seats) if (p.bot && !s.left.includes(p.id)) botTap(p.id, inputs?.[p.id]);
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
					// This seat's own: its last tap taken, its ledger (its phone
					// carries it on from here between taps), pops, misses, bombs.
					ack: (seat && s.ack[seat]) || 0,
					mine: seat ? { ...ledger(seat), popped: s.stats.popped[seat] ?? 0, misses: s.stats.misses[seat] ?? 0, bombs: s.stats.bombs[seat] ?? 0 } : null,
					popped: { ...s.stats.popped },
					// Team averages, leavers' scores included (they still count for their side).
					...(s.mode === "teams" ? { avg: teamScores(s.scores, sideAll("A"), sideAll("B")), avgOf: { A: sideAll("A").length, B: sideAll("B").length } } : {}),
				};
			},

			// Real time: nobody is waited on, so no turn-wait banner.
			turn: () => [],

			/** Only when its next tap is due: what it would tap now. */
			bot({ seat }) {
				if (s.phase !== "play" || !seated(seat) || s.t >= ROUND_MS) return null;
				if (s.t < (s.botDue[seat] ?? Infinity) || (s.stun[seat] ?? -Infinity) > s.t) return null;
				const pick = botPick(s.bubbles, s.t, teamOf(seat), s.mode, rnd);
				if (!pick) return null;
				const n = (s.botN[seat] ?? 0) + 1;
				return pick.miss ? { n, miss: true } : { n, b: pick.id };
			},

			/**
			 * The round's places. Teams: the side with the higher average first,
			 * each side one slot (kind "teams"), leavers counted in their side's
			 * average but out of the places (except a tie, whose one slot holds
			 * everyone who played); free-for-all: by score, ties sharing
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
					// Each side keeps its place even when everyone on it has left (an
					// empty slot): one slot would read as a draw, or as a win for the
					// side still here (lib/stats.js, the card's series).
					// A tie on the averages is one place for everyone who played, the
					// leavers too: left out, a 1-against-1 tie whose other player had
					// gone would be one player alone in the place, read as a win.
					const r = first ? [here[first], here[first === "A" ? "B" : "A"]] : [[...sideAll("A"), ...sideAll("B")]];
					// Both sides still here: the card says YOU WIN / X & Y WIN itself.
					// A side that has emptied has nobody to name, so the title says who won.
					const title = !first ? "A TIE" : here.A.length && here.B.length ? null : `TEAM ${first} WINS`;
					// Every score that counted for a side, leavers' too (one may share the tied place).
					const all = Object.fromEntries([...sideAll("A"), ...sideAll("B")].map((id) => [id, s.scores[id] ?? 0]));
					return { kind: "teams", ranking: r, scores: all, ...(title ? { title } : {}), details };
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
				// From a host on the old rules: who popped what was not kept.
				for (const g of s.gone ?? []) g.by ??= [];
				delete s.taps;
				delete s.lastT;
				// From a host on the old rules (before 2026-11-18), whose setup kept a
				// default of TEAMS: with nothing picked yet, the heir asks instead.
				if ("chosen" in s) {
					if (s.phase === "setup" && !s.chosen) {
						s.want = null;
						s.mode = teamsOk() ? null : "ffa";
					}
					delete s.chosen;
				}
			},
		};
	}

	globalThis.bubbleRushRules = {
		ROUND_MS, COUNT_MS, FRENZY_MS, HZ, FIELD_ASPECT, SIZES, GOLDEN, BOMB, STREAK_MS, STUN_MS, MAX_MULT, SLACK, KEEP_MS, GRACE_MS, LEAD_MS,
		BOT_EVERY_MS, BOT_REACT_MS, BOT_HESITATE, BOT_HESITATE_MS,
		rngFrom, riseMs, bombChance, spawnInterval, makeBubble, pack, unpack, progress, position, alive, surfaced, multiplier, popPoints,
		hitTest, judgeTap, tapTime, teamScores, averages, ranking, teamRanking, botPick, game,
	};
})();
