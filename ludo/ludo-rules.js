// ludo/ludo-rules.js — Ludo's rules, its two boards and its bot.
//
// No document here and no platform: ludo.js (the page) hands `game()` to the
// platform as SDK v2 managed rules. The platform runs them on the host — the
// die is rolled there, from a seeded generator whose state is part of the
// snapshot, so an heir rolls on — and sends each phone its view.
//
// ## The boards
//
// Both boards are one shape: a polygon in the middle (a square of 3 x 3, or a
// hexagon with sides of 3), an arm on each side three squares wide, and a
// yard in each corner between two arms. The 4-player board has four arms of
// six squares (the classic 15 x 15 cross, 52 squares round); the 6-player
// board has six arms of five (66 squares round). `geometry(size)` gives every
// square's centre in square units, the middle of the board at 0, 0.
//
// Each arm is three lanes. Seen from the middle looking out, the lane on the
// clockwise side runs in, the other runs out, and the middle lane is that
// arm's colour's home column; the end square of the middle lane, at the tip,
// is on the track. A token starts on the second square of its own arm's
// in-lane, goes clockwise round every other arm, comes up its own arm's
// out-lane to the tip, and turns in up the home column to the middle.
//
// A token's place is its progress: -1 in the yard, 0 (its start) to T - 2 on
// the track, then T - 1 … T + L - 3 up the home column, and T + L - 2 home
// (T squares round, arms L long): 56 on the 4-player board, as the classic.
//
// ## The rules (Lokesh, 2026-11-21: classic)
//
// - A 6 to leave the yard; a 6 rolls again; a third 6 in a row loses the turn.
// - Landing on another player's token sends it back to its yard — never on a
//   safe square: every start, and the star a few squares on from each.
// - An exact roll to go home: a roll that would go past it cannot be played.
// - Tokens of one player may share a square, and so may anyone's on a safe
//   square. There are no blocks: anyone may pass anyone.
// - Only one move possible (or several that come to the same thing: any of
//   the tokens in the yard on a 6) and it is made for you.
// - Teams: on the 4-player board partners sit opposite, 2 v 2; on the
//   6-player board 3 teams of 2 (opposite) or 2 teams of 3 (every other arm).
//   Partners never capture each other. A team wins when all its partners are
//   home, and a player whose tokens are all home rolls on their turn and
//   moves a partner's (Lokesh, 2026-11-23). A partner who leaves leaves
//   their tokens too: the others on the team move them on their own turns.
// - Free-for-all plays on for places, as Snakes & Ladders does: one place
//   with two players, two with three, three with four or more; the rest are
//   placed by how far round they got.

(() => {
	const TOKENS = 4;
	/** Each board: arms, how long each arm is, and the first arm's direction (degrees, screen: y down). */
	const BOARDS = {
		4: { n: 4, L: 6, theta0: 180 },
		6: { n: 6, L: 5, theta0: 150 },
	};
	const MODES = ["ffa", "pairs", "trios"];
	const LOG = 24; // events a view carries, for a phone to play through
	// Where a table of each size sits with no teams: spread round the board,
	// so two people on the 4-player board are opposite each other.
	const ARMS = {
		4: { 1: [0], 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] },
		6: { 1: [0], 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 3, 4], 6: [0, 1, 2, 3, 4, 5] },
	};

	// ------------------------------------------------------------- geometry

	const geoms = {};
	/**
	 * Board `size` (4 or 6): { n, L, T, HOME, STEP, h, track, safe, starts,
	 * stars, cell(arm, b, i), axes(arm), spot(arm, p, k), globalOf(arm, p),
	 * yard(arm), centre(arm) } in square units, the middle at 0, 0.
	 * cell(arm, b, i): lane b (-1 out, 0 home column, +1 in), i squares in from the tip.
	 */
	function geometry(size) {
		if (geoms[size]) return geoms[size];
		const { n, L, theta0 } = BOARDS[size];
		const STEP = 2 * L + 1; // track squares per arm
		const T = n * STEP;
		const HOME = T + L - 2;
		const h = 1.5 / Math.tan(Math.PI / n); // the middle polygon's apothem (its sides are 3)
		const axes = (arm) => {
			const a = ((theta0 + (arm * 360) / n) * Math.PI) / 180;
			return { u: [Math.cos(a), Math.sin(a)], v: [-Math.sin(a), Math.cos(a)], angle: a };
		};
		const cell = (arm, b, i) => {
			const { u, v } = axes(arm);
			const d = h + L - 0.5 - i;
			return [d * u[0] + b * v[0], d * u[1] + b * v[1]];
		};
		// The track, from the first arm's start, clockwise.
		const track = [];
		for (let i = 1; i < L; i++) track.push({ arm: 0, b: 1, i });
		for (let k = 1; k <= n; k++) {
			const arm = k % n;
			for (let i = L - 1; i >= 0; i--) track.push({ arm, b: -1, i });
			track.push({ arm, b: 0, i: 0 });
			if (arm === 0) track.push({ arm, b: 1, i: 0 });
			else for (let i = 0; i < L; i++) track.push({ arm, b: 1, i });
		}
		if (track.length !== T) throw new Error(`ludo: a track of ${track.length}, not ${T}`);
		for (const t of track) t.xy = cell(t.arm, t.b, t.i);
		const starts = Array.from({ length: n }, (_, a) => a * STEP);
		// A star on the next arm's out-lane, three squares from its tip: 8 on from a start on the classic board.
		const stars = starts.map((g) => (g + 2 * L - 4) % T);
		const safe = new Set([...starts, ...stars]);
		const globalOf = (arm, p) => (p >= 0 && p <= T - 2 ? (p + arm * STEP) % T : null);
		/** The yard between `arm` and the next: { centre, corners, spots[4] }. */
		const yard = (arm) => {
			const A = axes(arm);
			const B = axes((arm + 1) % n);
			const vx = h * A.u[0] + 1.5 * A.v[0];
			const vy = h * A.u[1] + 1.5 * A.v[1]; // the polygon's corner between the two arms
			const p1 = [(h + L) * A.u[0] + 1.5 * A.v[0], (h + L) * A.u[1] + 1.5 * A.v[1]];
			const p2 = [(h + L) * B.u[0] - 1.5 * B.v[0], (h + L) * B.u[1] - 1.5 * B.v[1]];
			let centre, corners, gap;
			if (n === 4) {
				// The square corner of the cross.
				centre = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
				corners = [[vx, vy], p1, [p1[0] + p2[0] - vx, p1[1] + p2[1] - vy], p2];
				gap = 1.2;
			} else {
				// The triangle between two arms, equilateral (sides L).
				centre = [(vx + p1[0] + p2[0]) / 3, (vy + p1[1] + p2[1]) / 3];
				corners = [[vx, vy], p1, p2];
				gap = 0.62;
			}
			// The spots stand square to the arms on the cross, square to the middle between two arms on the hexagon.
			const out = Math.hypot(centre[0], centre[1]);
			const [ox, oy] = n === 4 ? A.u : [centre[0] / out, centre[1] / out];
			const [px, py] = n === 4 ? A.v : [-oy, ox];
			const spots = [
				[-1, -1],
				[1, -1],
				[-1, 1],
				[1, 1],
			].map(([a, b]) => [centre[0] + (a * ox + b * px) * gap, centre[1] + (a * oy + b * py) * gap]);
			return { centre, corners, spots };
		};
		/** Where a token that is home stands: in its arm's triangle of the middle. */
		const centre = (arm) => {
			const { u } = axes(arm);
			const d = h * 0.5;
			return [d * u[0], d * u[1]];
		};
		/** Where token k of `arm`, at progress p, is drawn. */
		const spot = (arm, p, k = 0) => {
			if (p < 0) return yard(arm).spots[k % 4];
			if (p <= T - 2) return track[globalOf(arm, p)].xy;
			if (p < HOME) return cell(arm, 0, p - (T - 2));
			return centre(arm);
		};
		return (geoms[size] = { size, n, L, T, HOME, STEP, h, theta0, track, starts, stars, safe, cell, axes, globalOf, yard, centre, spot });
	}

	// ------------------------------------------------------------------ dice

	/** A small seeded generator (mulberry32) whose whole state is one number, so it travels in a snapshot. */
	function rng(seed) {
		let a = seed >>> 0;
		const next = () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
		return { next, int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)), state: () => a };
	}

	// ------------------------------------------------------------- the table

	/** Which modes a table of `count` may play on board `size`. */
	function modesFor(size, count) {
		const out = ["ffa"];
		if ((size === 4 && count === 4) || (size === 6 && count === 6)) out.push("pairs");
		if (size === 6 && count === 6) out.push("trios");
		return out;
	}
	/** Which boards a table of `count` fits: both up to four, the 6-player board from five. */
	const boardsFor = (count) => (count <= 4 ? [4, 6] : [6]);
	/** The team an arm plays for: opposite arms in pairs, every other arm in trios; null in free-for-all. */
	function teamOfArm(size, mode, arm) {
		if (mode === "pairs") return arm % (size / 2);
		if (mode === "trios") return arm % 2;
		return null;
	}
	/** Places played for in free-for-all: one with two players, two with three, three from four. */
	const placesOf = (count) => (count <= 2 ? 1 : count === 3 ? 2 : 3);

	// ------------------------------------------------------------- the rules

	/**
	 * The managed rules (docs/sdk-v2.md, Layer 2). `isHost(id)`: who may set
	 * the table up (the page passes the party's host; tests leave it open).
	 * `die()`: tests' own rolls, in place of the seeded die.
	 */
	function game({ isHost = () => true, die = null } = {}) {
		let s = null;
		const G = () => geometry(s.board);
		const count = () => s.seats.length;
		const seatOf = (id) => s.seats.indexOf(id);
		const teamOf = (i) => teamOfArm(s.board, s.mode, s.arms[i]);
		const teams = () => s.mode !== "ffa";
		const mates = (i, j) => i === j || (teams() && teamOf(i) === teamOf(j));
		const allHome = (i) => s.tokens[i].every((p) => p === G().HOME);
		/** Whose tokens seat i moves on its turn: its own, a partner's once its own are home, and a partner's who left. */
		function owners(i) {
			if (s.out[i]) return [];
			const list = allHome(i) ? [] : [i];
			if (teams())
				for (let j = 0; j < count(); j++) if (j !== i && mates(i, j) && !allHome(j) && (s.out[j] || allHome(i))) list.push(j);
			return list;
		}
		/** The moves seat i may make with `roll`: one per owner and square (tokens sharing a square move alike). */
		function movesOf(i, roll) {
			const { HOME } = G();
			const list = [];
			for (const owner of owners(i)) {
				const seen = new Set();
				s.tokens[owner].forEach((p, token) => {
					if (seen.has(p)) return;
					seen.add(p);
					if (p < 0) {
						if (roll === 6) list.push({ owner, token, from: p, to: 0 });
					} else if (p < HOME && p + roll <= HOME) list.push({ owner, token, from: p, to: p + roll });
				});
			}
			return list;
		}
		/** Tokens on track square g that a token of `owner` landing there would send home. */
		function victims(owner, g) {
			const geo = G();
			if (g == null || geo.safe.has(g)) return [];
			const out = [];
			for (let j = 0; j < count(); j++) {
				if (mates(owner, j) || (!teams() && s.out[j])) continue;
				s.tokens[j].forEach((p, token) => {
					if (geo.globalOf(s.arms[j], p) === g) out.push([j, token, p]);
				});
			}
			return out;
		}
		function play(move) {
			const geo = G();
			const caps = victims(move.owner, geo.globalOf(s.arms[move.owner], move.to));
			for (const [j, token] of caps) s.tokens[j][token] = -1;
			s.tokens[move.owner][move.token] = move.to;
			s.captures[s.turn] += caps.length;
			if (move.to === geo.HOME && allHome(move.owner) && !s.done.includes(move.owner)) s.done.push(move.owner);
			return { ...move, caps };
		}
		/** Still in the race: seated, here, not all home. */
		const racing = (i) => !s.out[i] && !allHome(i);
		/** The teams still in it: a member here. */
		const teamIds = () => [...new Set(s.seats.map((_, i) => teamOf(i)))];
		const teamDone = (t) => s.seats.every((_, i) => teamOf(i) !== t || allHome(i));
		const teamHere = (t) => s.seats.some((_, i) => teamOf(i) === t && !s.out[i]);
		function settle() {
			if (teams()) {
				const won = teamIds().find(teamDone);
				const here = teamIds().filter((t) => teamHere(t) && !teamDone(t));
				if (won != null) s.winners = won;
				else if (here.length <= 1) s.winners = here[0] ?? null;
				else return;
				s.over = true;
				return;
			}
			const left = s.seats.map((_, i) => i).filter(racing);
			// Decided: the places played for are taken, or nobody is left to race.
			if (s.done.length >= s.need || left.length <= 1) s.over = true;
		}
		/** Pass the turn on, clockwise round the board, to the next seat with anything to move. */
		function next() {
			s.stage = "roll";
			s.roll = 0;
			s.sixes = 0;
			const order = s.seats.map((_, i) => i).sort((a, b) => s.arms[a] - s.arms[b]);
			const at = order.indexOf(s.turn);
			for (let k = 1; k <= order.length; k++) {
				const j = order[(at + k) % order.length];
				if (owners(j).length) {
					s.turn = j;
					return;
				}
			}
		}
		/** After a move with `roll`: a 6 rolls again (with anything left to move), else the turn passes. */
		function after(roll) {
			settle();
			if (s.over) return;
			s.stage = "roll";
			s.roll = 0;
			if (roll === 6 && owners(s.turn).length) return;
			next();
		}
		/** A roll or a move happened: the newest event, and the log every phone plays through. */
		function event(e) {
			s.last = { n: ++s.n, seat: s.turn, ...e };
			s.log.push(s.last);
			if (s.log.length > LOG) s.log.splice(0, s.log.length - LOG);
		}
		/** Seat `me` rolls: three 6s lose the turn; nothing to move passes it (a 6 still rolls again); one move is made; more wait for a pick. */
		function rollFor(me) {
			let roll;
			if (die) roll = die();
			else {
				const r = rng(s.dice);
				roll = r.int(1, 6);
				s.dice = r.state();
			}
			s.rolls++;
			s.sixes = roll === 6 ? s.sixes + 1 : 0;
			if (s.sixes === 3) {
				event({ roll, lost: true });
				return next();
			}
			const moves = movesOf(me, roll);
			if (!moves.length) {
				event({ roll, pass: true });
				if (roll === 6) return;
				return next();
			}
			if (moves.length === 1) {
				event({ roll, move: play(moves[0]) });
				return after(roll);
			}
			s.stage = "move";
			s.roll = roll;
			event({ roll, choose: true });
		}
		/** Seat `me` plays `move` (with that owner's token `token`, any of those sharing its square). */
		function moveFor(me, move, token) {
			const roll = s.roll;
			event({ roll, picked: true, move: play({ ...move, token }) });
			after(roll);
		}
		const defaultArms = () => [...(ARMS[s.board][count()] ?? s.seats.map((_, i) => i))];

		function startPlay() {
			s.phase = "play";
			s.tokens = s.seats.map(() => Array(TOKENS).fill(-1));
			s.stage = "roll";
			s.turn = s.opener;
			s.need = placesOf(count());
			if (!owners(s.turn).length) next();
		}

		return {
			init({ seats, seed, match, first }) {
				const ids = seats.map((p) => p.id);
				// Who rolls first (docs/sdk-v2.md "Who starts"): the platform's
				// `first`; from an older shell, the seat after the last match's
				// opener, or a draw from the seed for a run's first match.
				let opener = ids.indexOf(first);
				if (opener < 0 && s?.openerId != null) {
					const prev = ids.indexOf(s.openerId);
					opener = prev >= 0 ? (prev + 1) % ids.length : Math.max(0, s.seats.indexOf(s.openerId)) % Math.max(1, ids.length);
				}
				const sd = Math.abs(Math.floor(Number(seed) || 0));
				if (opener < 0) opener = sd % Math.max(1, ids.length);
				// The last match's board and mode, when they still fit the table.
				const board = boardsFor(ids.length).includes(s?.board) ? s.board : ids.length <= 4 ? 4 : 6;
				const mode = s && modesFor(board, ids.length).includes(s.mode) ? s.mode : "ffa";
				s = {
					match: (match ?? 0) + 1,
					phase: "setup", // "setup" | "play"
					seats: ids,
					board,
					mode,
					arms: null,
					tokens: ids.map(() => Array(TOKENS).fill(-1)),
					out: ids.map(() => false),
					done: [], // free-for-all: seats in the order all their tokens got home
					need: placesOf(ids.length),
					turn: opener,
					opener,
					openerId: ids[opener] ?? null,
					stage: "roll", // "roll" | "move"
					roll: 0, // the roll waiting to be played (stage "move")
					sixes: 0, // 6s in a row this turn
					dice: rng(sd ^ 0x1d0d1ce).state(),
					mix: rng(sd ^ 0x7ea35).state(),
					last: null, // the newest roll or move: { n, seat, roll, move?, choose?, picked?, pass?, lost? }
					log: [], // the newest events, oldest first
					bots: seats.map((p) => !!p.bot),
					n: 0,
					rolls: 0,
					captures: ids.map(() => 0),
					over: false,
					winners: null, // teams: the winning team
				};
				s.arms = defaultArms();
			},

			apply({ action, by }) {
				const a = action ?? {};
				const me = seatOf(by);
				if (s.phase === "setup") {
					if (!isHost(by)) return "the host sets up the game";
					if ("board" in a) {
						if (!boardsFor(count()).includes(a.board)) return count() > 4 ? "five or six players need the 6-player board" : "no such board";
						s.board = a.board;
						if (!modesFor(s.board, count()).includes(s.mode)) s.mode = "ffa";
						s.arms = defaultArms();
						return;
					}
					if ("mode" in a) {
						if (!modesFor(s.board, count()).includes(a.mode)) return a.mode === "ffa" || MODES.includes(a.mode) ? "teams need every seat on the board filled" : "no such mode";
						s.mode = a.mode;
						s.arms = defaultArms();
						return;
					}
					if (a.mix === true) {
						if (!teams()) return "no teams to mix";
						// New partners: a shuffle of the arms that changes who is with whom.
						const r = rng(s.mix);
						const key = () => JSON.stringify(s.seats.map((_, i) => s.seats.map((_, j) => mates(i, j))));
						const was = key();
						for (let tries = 0; tries < 12 && key() === was; tries++)
							for (let i = s.arms.length - 1; i > 0; i--) {
								const j = r.int(0, i);
								[s.arms[i], s.arms[j]] = [s.arms[j], s.arms[i]];
							}
						s.mix = r.state();
						return;
					}
					if (a.start === true) return void startPlay();
					return "the game has not started";
				}
				if (s.over) return "the game is over";
				if (me < 0 || s.out[me]) return "you are not playing";
				if (me !== s.turn) return "not your turn";
				// A bot takes its whole turn in one move: every roll, every pick,
				// the 6s again, until the turn passes. (A platform that asks a
				// bot only when it comes on turn would never ask again for a
				// bot still on turn after its own move.) Each step is an event
				// in the log, so every phone still plays them one by one.
				if (a.turn === true) {
					if (!s.bots[me]) return "tap the die to roll";
					for (let guard = 0; guard < 60 && !s.over && s.turn === me; guard++) {
						if (s.stage === "roll") rollFor(me);
						else {
							const best = pick(me, s.roll);
							moveFor(me, best, best.token);
						}
					}
					return;
				}
				if (s.stage === "roll") {
					if (a.roll !== true) return "tap the die to roll";
					return void rollFor(me);
				}
				// stage "move": which token.
				const owner = Number.isInteger(a.owner) ? a.owner : me;
				const token = a.token;
				if (!Number.isInteger(token) || token < 0 || token >= TOKENS || !s.tokens[owner]) return "tap one of your tokens";
				const from = s.tokens[owner][token];
				const move = movesOf(me, s.roll).find((m) => m.owner === owner && m.from === from);
				if (!move) return "that token cannot move";
				moveFor(me, move, token);
			},

			view({ seat }) {
				const geo = G();
				return {
					match: s.match,
					phase: s.phase,
					board: s.board,
					mode: s.mode,
					boards: boardsFor(count()),
					modes: modesFor(s.board, count()),
					seats: [...s.seats],
					arms: [...s.arms],
					teams: s.seats.map((_, i) => teamOf(i)),
					tokens: s.tokens.map((t) => [...t]),
					out: [...s.out],
					done: [...s.done],
					home: geo.HOME,
					turn: s.turn,
					stage: s.stage,
					roll: s.roll,
					sixes: s.sixes,
					// The choices on the table: the seat on turn's, when it has more than one.
					moves: s.phase === "play" && !s.over && s.stage === "move" ? movesOf(s.turn, s.roll) : [],
					last: s.last && JSON.parse(JSON.stringify(s.last)),
					log: JSON.parse(JSON.stringify(s.log)),
					over: s.over,
					winners: s.winners,
					winner: s.over && !teams() ? (s.done[0] ?? s.seats.map((_, i) => i).find(racing) ?? null) : null,
					opener: s.opener,
					rolls: s.rolls,
					you: seat == null ? -1 : seatOf(seat),
				};
			},

			turn: () => (s.phase === "play" && !s.over ? [s.seats[s.turn]] : []),

			bot({ seat }) {
				if (s.phase !== "play" || s.over || seatOf(seat) !== s.turn) return null;
				return { turn: true };
			},

			result() {
				if (s.phase !== "play" || !s.over) return null;
				const ids = (list) => list.map((i) => s.seats[i]);
				const progress = (i) => s.tokens[i].reduce((sum, p) => sum + (p < 0 ? 0 : p + 1), 0);
				const details = [
					{ label: "Rolls", value: s.rolls },
					{ label: "Tokens sent home", value: s.captures.reduce((a, b) => a + b, 0) },
				];
				if (teams()) {
					const score = (t) => s.seats.reduce((sum, _, i) => sum + (teamOf(i) === t ? progress(i) : 0), 0);
					const members = (t) => s.seats.map((_, i) => i).filter((i) => teamOf(i) === t);
					const rest = teamIds().filter((t) => t !== s.winners);
					const levels = [...new Set(rest.map(score))].sort((a, b) => b - a);
					const ranking = [...(s.winners != null ? [ids(members(s.winners))] : []), ...levels.map((v) => ids(rest.filter((t) => score(t) === v).flatMap(members)))];
					return { kind: "teams", ranking, details };
				}
				const rest = s.seats.map((_, i) => i).filter((i) => !s.done.includes(i) && !s.out[i]);
				const levels = [...new Set(rest.map(progress))].sort((a, b) => b - a);
				const gone = s.seats.map((_, i) => i).filter((i) => s.out[i] && !s.done.includes(i));
				const ranking = [...s.done.map((i) => [s.seats[i]]), ...levels.map((v) => ids(rest.filter((i) => progress(i) === v))), ...(gone.length ? [ids(gone)] : [])];
				return { kind: "ffa", ranking, details };
			},

			/** The host chose SKIP TURN for someone away: their turn passes. */
			skip() {
				if (s.phase !== "play" || s.over) return false;
				next();
				return true;
			},

			/**
			 * A player left for good. Before the start they simply leave the
			 * table. In free-for-all their tokens come off and they are placed
			 * last; on a team their tokens stay, for the partners to move.
			 */
			leave({ seat }) {
				const i = seatOf(seat);
				if (i < 0 || s.out[i] || s.over) return false;
				if (s.phase === "setup") {
					for (const k of ["seats", "tokens", "out", "captures", "bots"]) s[k].splice(i, 1);
					if (s.opener >= count()) s.opener = 0;
					s.turn = s.opener;
					s.openerId = s.seats[s.opener] ?? null;
					if (!boardsFor(count()).includes(s.board)) s.board = 6;
					if (!modesFor(s.board, count()).includes(s.mode)) s.mode = "ffa";
					s.arms = defaultArms();
					s.need = placesOf(count());
					return true;
				}
				s.out[i] = true;
				settle();
				if (!s.over && s.turn === i) next();
				return true;
			},

			snapshot: () => JSON.parse(JSON.stringify(s)),
			restore({ snapshot }) {
				s = JSON.parse(JSON.stringify(snapshot));
			},
		};

		// --------------------------------------------------------------- the bot

		/** How many tokens of another side could land on track square g with one roll. */
		function threats(owner, g) {
			const geo = G();
			if (g == null || geo.safe.has(g)) return 0;
			let n = 0;
			for (let j = 0; j < count(); j++) {
				if (mates(owner, j) || s.out[j]) continue;
				for (const p of s.tokens[j]) {
					const at = geo.globalOf(s.arms[j], p);
					if (at == null) continue;
					const dist = (g - at + geo.T) % geo.T;
					if (dist >= 1 && dist <= 6 && p + dist <= geo.T - 2) n++;
				}
			}
			return n;
		}
		/**
		 * The bot's move: capture first, then home, out of the yard, into the
		 * home column, onto a safe square, out of reach; never into reach if
		 * it can help it; else the token furthest on.
		 */
		function pick(i, roll) {
			const geo = G();
			let best = null;
			for (const m of movesOf(i, roll)) {
				const arm = s.arms[m.owner];
				const gTo = geo.globalOf(arm, m.to);
				const gFrom = geo.globalOf(arm, m.from);
				let score = m.to / 10;
				const caps = victims(m.owner, gTo);
				score += caps.length * 500 + caps.reduce((sum, [, , p]) => sum + p, 0);
				if (m.to === geo.HOME) score += 400;
				if (m.from < 0) score += 300;
				if (m.from <= geo.T - 2 && m.to > geo.T - 2) score += 200;
				if (gTo != null && geo.safe.has(gTo)) score += 100;
				if (gFrom != null && threats(m.owner, gFrom)) score += 150;
				if (gTo != null && !caps.length) score -= 200 * Math.min(1, threats(m.owner, gTo));
				if (!best || score > best.score) best = { ...m, score };
			}
			return best;
		}
	}

	globalThis.ludoRules = { TOKENS, BOARDS, MODES, ARMS, geometry, rng, modesFor, boardsFor, teamOfArm, placesOf, game };
})();
