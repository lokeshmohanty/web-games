// snakes-and-ladders/snakes-and-ladders-rules.js — Snakes & Ladders' rules:
// the board each game deals, the die, the moves.
//
// No document here and no platform: snakes-and-ladders.js (the page) hands
// `game()` to the platform as SDK v2 managed rules, and
// test-snakes-and-ladders.mjs loads this file straight into Node.
//
// ## The board
//
// A 10 x 10 board, 1 at the bottom left, the rows winding up to 100 at the
// top left. Every game deals a new board from the platform's seed (`layout`),
// so the snakes and ladders are never where they were last time. A board is
// kept only if it is fair:
//
//   - every snake and ladder runs between two different rows, at least
//     MIN_SPAN squares, a ladder at most MAX_LADDER and a snake at most
//     MAX_SNAKE, and leans at most MAX_LEAN columns, so they run up the
//     board rather than across it and the board stays readable;
//   - no square holds two ends, so no ladder ends on a snake's head, no snake
//     drops onto a ladder's foot, and nothing chains;
//   - 1 and 100 hold nothing: no snake on 100, no ladder to it;
//   - no six squares in a row hold more than two snake heads, so a roll can
//     always get past;
//   - ladders start low and high (one foot at most 40, one at least 50), and
//     snakes bite low and high (one head at most 60, one at least 80);
//   - one token climbs it in about as many rolls as wanted (below).
//
// ## How long a game lasts
//
// Play goes on for places (Lokesh, 2026-11-23: "play on for places"): when
// someone reaches 100 the others keep rolling until second place is decided
// too, and third at four players or more (`placesOf`). With two players the
// first home decides everything, so that game ends there.
//
// So a board is balanced on one token's climb alone, the same at every
// table: about ROLLS rolls from the start to 100 (measured by playing it,
// SIMS climbs on the board's own dice), with snakes and ladders in roughly
// equal numbers (8 and 7 to begin with; one more or fewer as the measure
// asks, within SNAKES and LADDERS). Bigger tables run longer by themselves,
// because more places are played for. At about SECONDS_PER_TURN a turn
// (measured 2026-11-22: one person, three bots whose rolls wait for the last
// move to play, snakes-and-ladders.js BOT_PACE_MS) test-snakes-and-ladders.mjs
// prints each table's minutes. Up to TRIES boards are dealt and the one
// nearest the target kept, so the deal always ends; it takes a few
// milliseconds, once a match.

// ## The moves
//
// The die is rolled on the host (its state travels in the snapshot, so an
// heir rolls on from it). A roll moves the token that many squares; the
// tokens start off the board, so a first roll of 4 lands on 4. A foot of a
// ladder climbs it, a snake's head slides down it. **100 needs the exact
// roll**: a roll that would pass it leaves the token where it is (no bounce).
// No extra turn for a 6. Tokens share squares; nobody is knocked off. A
// token home on 100 rolls no more. The places go in the order tokens reach
// 100; everyone still on the board is placed by how far up they got; a
// player who left the game is placed last.

(() => {
	const SIZE = 100;
	const MIN_SPAN = 9;
	const MAX_LADDER = 40;
	const MAX_SNAKE = 50;
	const MAX_LEAN = 4;
	const SECONDS_PER_TURN = 1.9;
	const ROLLS = [37, 43]; // the wanted average rolls for one token, start to 100
	const MIN_ROLLS = 35; // what a board's true climb is held to (the measure is noisy)
	const MAX_ROLLS = 45;
	const SNAKES = [6, 10];
	const LADDERS = [5, 9];
	const SIMS = 240;
	const TRIES = 30;

	/** A seeded generator: its state is one integer, so it can be kept in a snapshot. */
	function rng(state) {
		let a = state >>> 0;
		const next = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = Math.imul(a ^ (a >>> 15), 1 | a);
			t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), state: () => a };
	}

	const rowOf = (sq) => Math.floor((sq - 1) / 10);
	/** The square's column, 0 at the left: rows wind, so odd rows run right to left. */
	const colOf = (sq) => (rowOf(sq) % 2 ? 9 - ((sq - 1) % 10) : (sq - 1) % 10);

	/** Where a token on `pos` ends after rolling `roll` on `jumps` (Map from → to). */
	function step(pos, roll, jumps) {
		const land = pos + roll;
		if (land > SIZE) return { land: pos, to: pos, via: "over" };
		const to = jumps.get(land);
		if (to === undefined) return { land, to: land, via: null };
		return { land, to, via: to > land ? "ladder" : "snake" };
	}
	const jumpsOf = (layout) => new Map([...layout.ladders, ...layout.snakes]);
	const leans = (a, b) => Math.abs(colOf(a) - colOf(b)) > MAX_LEAN;

	/** What is wrong with a board, as a sentence; null when it is fair (the length aside). */
	function unfair(layout) {
		const ends = [...layout.ladders.flat(), ...layout.snakes.flat()];
		if (new Set(ends).size !== ends.length) return "two ends share a square";
		if (ends.some((sq) => !Number.isInteger(sq) || sq <= 1 || sq >= SIZE)) return "an end on 1, on 100 or off the board";
		for (const [a, b] of layout.ladders) {
			if (b <= a || b - a < MIN_SPAN || b - a > MAX_LADDER || rowOf(a) === rowOf(b) || leans(a, b)) return `ladder ${a}→${b} is the wrong length`;
		}
		for (const [h, t] of layout.snakes) {
			if (t >= h || h - t < MIN_SPAN || h - t > MAX_SNAKE || rowOf(h) === rowOf(t) || leans(h, t)) return `snake ${h}→${t} is the wrong length`;
		}
		const heads = new Set(layout.snakes.map(([h]) => h));
		for (let sq = 2; sq + 5 < SIZE; sq++) {
			let n = 0;
			for (let d = 0; d < 6; d++) if (heads.has(sq + d)) n++;
			if (n > 2) return `three snake heads within six squares from ${sq}`;
		}
		if (!layout.ladders.some(([a]) => a <= 40) || !layout.ladders.some(([a]) => a >= 50)) return "ladders all at one end";
		if (!layout.snakes.some(([h]) => h <= 60) || !layout.snakes.some(([h]) => h >= 80)) return "snakes all at one end";
		return null;
	}

	/** How many places a game of `players` plays for: two, three from four players, never all of them. */
	const placesOf = (players) => Math.max(1, Math.min(players - 1, players >= 4 ? 3 : 2));

	/** One token's average rolls from the start to 100 on `layout`, on dice from `r`. */
	function climb(layout, r, sims = SIMS) {
		const jumps = jumpsOf(layout);
		let rolls = 0;
		for (let g = 0; g < sims; g++) {
			let at = 0;
			let n = 0;
			while (at < SIZE && n < 5000) {
				n++;
				at = step(at, r.int(1, 6), jumps).to;
			}
			rolls += n;
		}
		return rolls / sims;
	}

	/**
	 * How long a board plays, on dice from `r`: `rolls`, one token's average
	 * climb, and `turns`, the average turns of a whole game of `players`
	 * played for its places (placesOf).
	 */
	function measure(layout, players, r, sims = SIMS) {
		const jumps = jumpsOf(layout);
		const need = placesOf(players);
		let turns = 0;
		for (let g = 0; g < sims; g++) {
			const pos = new Array(players).fill(0);
			let home = 0;
			let t = 0;
			while (home < need && t < 20000) {
				for (let i = 0; i < players && home < need; i++) {
					if (pos[i] === SIZE) continue;
					t++;
					pos[i] = step(pos[i], r.int(1, 6), jumps).to;
					if (pos[i] === SIZE) home++;
				}
			}
			turns += t;
		}
		return { turns: turns / sims, rolls: climb(layout, r, sims) };
	}

	/** One candidate board: `snakes` and `ladders` of them, placed at random until they fit the rules. */
	function deal(r, snakes, ladders) {
		for (let attempt = 0; attempt < 200; attempt++) {
			const used = new Set();
			const out = { snakes: [], ladders: [] };
			const place = (list, n, make) => {
				for (let i = 0; i < n; i++) {
					let k = 0;
					for (; k < 200; k++) {
						const [a, b] = make();
						if (a <= 1 || b <= 1 || a >= SIZE || b >= SIZE || used.has(a) || used.has(b) || rowOf(a) === rowOf(b) || leans(a, b)) continue;
						used.add(a);
						used.add(b);
						list.push([a, b]);
						break;
					}
					if (k === 200) return false;
				}
				return true;
			};
			const ok =
				place(out.ladders, ladders, () => {
					const a = r.int(2, SIZE - 1 - MIN_SPAN);
					return [a, a + r.int(MIN_SPAN, MAX_LADDER)];
				}) &&
				place(out.snakes, snakes, () => {
					const h = r.int(2 + MIN_SPAN, SIZE - 1);
					return [h, h - r.int(MIN_SPAN, MAX_SNAKE)];
				});
			if (ok && !unfair(out)) {
				out.ladders.sort((a, b) => a[0] - b[0]);
				out.snakes.sort((a, b) => b[0] - a[0]);
				return out;
			}
		}
		return null;
	}

	/**
	 * A fair board from `seed`: { snakes: [[head, tail]…], ladders:
	 * [[foot, top]…], rolls } — rolls as measured. The same seed always deals
	 * the same board. (The table's size no longer changes it: play goes on
	 * for places instead.)
	 */
	function layout(seed) {
		const r = rng(Math.floor(Number(seed) || 0) ^ 0x51ab1e);
		let snakes = 8;
		let ladders = 7;
		let best = null;
		const [lo, hi] = ROLLS;
		const mid = (lo + hi) / 2;
		for (let i = 0; i < TRIES; i++) {
			const board = deal(r, snakes, ladders);
			if (!board) {
				[snakes, ladders] = [8, 7];
				continue;
			}
			const rolls = climb(board, r);
			const off = rolls < lo ? lo - rolls : rolls > hi ? rolls - hi : 0;
			if (!best || off < best.off || (off === best.off && Math.abs(rolls - mid) < Math.abs(best.rolls - mid))) best = { ...board, rolls, off };
			if (off === 0) break;
			// Too short: a snake more or a ladder fewer, keeping them near level; too long, the other way.
			// Never more than 3 apart: past that, the next deal keeps the counts.
			if (rolls < lo) {
				if (snakes < SNAKES[1] && snakes + 1 - ladders <= 3 && (snakes <= ladders + 1 || ladders <= LADDERS[0])) snakes++;
				else if (ladders > LADDERS[0] && snakes - (ladders - 1) <= 3) ladders--;
			} else if (ladders < LADDERS[1] && ladders + 1 - snakes <= 3 && (ladders <= snakes || snakes <= SNAKES[0])) ladders++;
			else if (snakes > SNAKES[0] && ladders - (snakes - 1) <= 3) snakes--;
		}
		const { off, ...board } = best;
		return { ...board, rolls: Math.round(board.rolls) };
	}

	// ----------------------------------------------------------- the rules

	/** The managed rules (docs/sdk-v2.md, Layer 2). */
	function game() {
		let s = null; // { match, seats, out, pos, home, need, over, turn, opener, board, dice, last, rolls, snakes, ladders }

		const seatOf = (id) => s.seats.indexOf(id);
		/** Still rolling: seated, not left, not home. */
		const rolling = (i) => !s.out[i] && s.pos[i] !== SIZE;
		const rollers = () => s.seats.map((_, i) => i).filter(rolling);
		const after = (i) => {
			for (let k = 1; k <= s.seats.length; k++) {
				const j = (i + k) % s.seats.length;
				if (rolling(j)) return j;
			}
			return i;
		};
		/** Decided: the places played for are taken, or nobody is left to race. */
		const settle = () => {
			if (s.home.length >= s.need || rollers().length <= 1) s.over = true;
		};

		return {
			init({ seats, seed, match, first }) {
				const ids = seats.map((p) => p.id);
				// Who rolls first (docs/sdk-v2.md "Who starts"): the platform's
				// `first`; from an older shell, the seat after the last match's
				// opener, or a draw from the seed for a run's first match.
				let opener = ids.indexOf(first);
				if (opener < 0 && s?.opener != null) {
					const prev = ids.indexOf(s.opener);
					opener = prev >= 0 ? (prev + 1) % ids.length : Math.max(0, s.seats.indexOf(s.opener)) % ids.length;
				}
				const sd = Math.abs(Math.floor(Number(seed) || 0));
				if (opener < 0) opener = sd % Math.max(1, ids.length);
				s = {
					match: match + 1,
					seats: ids,
					out: ids.map(() => false),
					pos: ids.map(() => 0),
					home: [], // seats in the order they reached 100
					need: placesOf(ids.length),
					over: false,
					turn: opener,
					opener: ids[opener] ?? null,
					board: layout(sd),
					dice: rng(sd ^ 0xd1ce).state(),
					last: null,
					rolls: 0,
					snakes: 0,
					ladders: 0,
					mine: {}, // id → { rolls, snakes, ladders }: each player's own, for achievements
				};
			},

			apply({ action, by }) {
				if (s.over) return "the game is over";
				const me = seatOf(by);
				if (me < 0 || s.out[me]) return "you are not playing";
				if (s.pos[me] === SIZE) return "you are home";
				if (me !== s.turn) return "not your turn";
				if (action?.roll !== true) return "tap the die to roll";
				const r = rng(s.dice);
				const roll = r.int(1, 6);
				s.dice = r.state();
				const from = s.pos[me];
				const move = step(from, roll, jumpsOf(s.board));
				s.pos[me] = move.to;
				s.rolls++;
				if (move.via === "snake") s.snakes++;
				if (move.via === "ladder") s.ladders++;
				const m = s.mine?.[by] ?? { rolls: 0, snakes: 0, ladders: 0 };
				s.mine = { ...(s.mine ?? {}), [by]: { rolls: m.rolls + 1, snakes: m.snakes + (move.via === "snake" ? 1 : 0), ladders: m.ladders + (move.via === "ladder" ? 1 : 0) } };
				let place = null;
				if (move.to === SIZE) {
					s.home.push(me);
					place = s.home.length;
				}
				s.last = { seat: me, roll, from, land: move.land, to: move.to, via: move.via, n: s.rolls, place };
				settle();
				if (!s.over) s.turn = after(me);
			},

			view: ({ seat }) => ({
				match: s.match,
				seats: [...s.seats],
				out: [...s.out],
				pos: [...s.pos],
				home: [...s.home],
				need: s.need,
				over: s.over,
				turn: s.turn,
				you: seat == null ? -1 : seatOf(seat),
				board: { snakes: s.board.snakes.map((x) => [...x]), ladders: s.board.ladders.map((x) => [...x]) },
				last: s.last && { ...s.last },
				// The first home, or (nobody home when the others all left) the one left racing.
				winner: s.over ? (s.home[0] ?? rollers()[0] ?? null) : null,
				rolls: s.rolls,
			}),

			turn: () => (!s.over ? [s.seats[s.turn]] : []),

			// A bot has nothing to decide: it rolls.
			bot: ({ seat }) => (seatOf(seat) === s.turn && !s.over ? { roll: true } : null),

			/** The places in the order they were taken, then the rest by how far up they got, then whoever left. */
			result() {
				if (!s.over) return null;
				const ids = (list) => list.map((i) => s.seats[i]);
				const rest = rollers();
				const levels = [...new Set(rest.map((i) => s.pos[i]))].sort((a, b) => b - a);
				const gone = s.seats.map((_, i) => i).filter((i) => s.out[i] && !s.home.includes(i));
				const ranking = [...s.home.map((i) => [s.seats[i]]), ...levels.map((p) => ids(rest.filter((i) => s.pos[i] === p))), ...(gone.length ? [ids(gone)] : [])];
				return {
					kind: "ffa",
					ranking,
					// Each player's own rolls, snakes and ladders, which game.json's
					// achievements and records read (the arcade's docs/platform.md).
					seatFacts: Object.fromEntries(s.seats.filter(Boolean).map((id) => [id, { rolls: 0, snakes: 0, ladders: 0, ...(s.mine?.[id] ?? {}) }])),
					details: [
						{ label: "Rolls", value: s.rolls },
						{ label: "Ladders climbed", value: s.ladders },
						{ label: "Snakes slid down", value: s.snakes },
					],
				};
			},

			/** The host chose SKIP TURN for someone away: their roll is passed. */
			skip() {
				if (s.over) return false;
				s.turn = after(s.turn);
				return true;
			},

			/**
			 * A player left for good: their token comes off and they are placed
			 * last (a place already taken on 100 is kept). If one player or none
			 * is left racing, the game is decided.
			 */
			leave({ seat }) {
				const i = seatOf(seat);
				if (i < 0 || s.out[i] || s.over) return false;
				s.out[i] = true;
				settle();
				if (!s.over && s.turn === i) s.turn = after(i);
				return true;
			},

			snapshot: () => JSON.parse(JSON.stringify(s)),
			restore({ snapshot }) {
				s = JSON.parse(JSON.stringify(snapshot));
			},
		};
	}

	globalThis.snakesAndLaddersRules = { SIZE, MIN_SPAN, MAX_LADDER, MAX_SNAKE, MAX_LEAN, ROLLS, MIN_ROLLS, MAX_ROLLS, SNAKES, LADDERS, SECONDS_PER_TURN, rng, rowOf, colOf, step, jumpsOf, unfair, placesOf, climb, measure, deal, layout, game };
})();
