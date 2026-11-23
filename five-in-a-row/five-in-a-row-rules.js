// five-in-a-row/five-in-a-row-rules.js — Five in a Row's rules and its bot.
//
// No document here and no platform: five-in-a-row.js (the page) hands `game()`
// to the platform as SDK v2 managed rules, and test-five-in-a-row.mjs loads
// this file straight into Node.
//
// The board has no edges. Cells are integer pairs (x, y), the first mark is
// always the centre (0, 0), and every later mark goes on an empty cell that
// touches a mark already down — across, down or diagonally (its 8
// neighbours). Two to four players take turns, each in their own colour; the
// first to make an unbroken line of five or more of their own marks, across,
// down or diagonally, wins.
//
// The board grows only where people play, so a game cannot fill it. After
// MAX_MARKS marks with no line the game is a draw: nobody reaches that in a
// real game, but it means every game ends.

(() => {
	const WIN = 5;
	const MAX_MARKS = 500;
	const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
	const AROUND = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
	const key = (x, y) => `${x},${y}`;

	/** The board as a Map "x,y" → seat index, from the marks list [[x, y, seat], …]. */
	const boardOf = (marks) => new Map(marks.map(([x, y, p]) => [key(x, y), p]));

	/** Whether (x, y) may take the next mark on `board`: the centre first, then next to a mark. */
	function legal(board, x, y) {
		if (!Number.isInteger(x) || !Number.isInteger(y)) return false;
		if (!board.size) return x === 0 && y === 0;
		if (board.has(key(x, y))) return false;
		return AROUND.some(([dx, dy]) => board.has(key(x + dx, y + dy)));
	}

	/** Every cell the next mark may take: the centre on an empty board, else the empty neighbours of marks. */
	function legalCells(board) {
		if (!board.size) return [[0, 0]];
		const out = new Map();
		for (const k of board.keys()) {
			const [x, y] = k.split(",").map(Number);
			for (const [dx, dy] of AROUND) {
				const c = key(x + dx, y + dy);
				if (!board.has(c) && !out.has(c)) out.set(c, [x + dx, y + dy]);
			}
		}
		return [...out.values()];
	}

	/**
	 * The longest line of `p`'s marks through (x, y), which must be `p`'s:
	 * its cells, end to end. Five or more is a win.
	 */
	function lineThrough(board, x, y, p) {
		let best = [[x, y]];
		for (const [dx, dy] of DIRS) {
			const cells = [[x, y]];
			for (let d = 1; board.get(key(x + dx * d, y + dy * d)) === p; d++) cells.push([x + dx * d, y + dy * d]);
			for (let d = 1; board.get(key(x - dx * d, y - dy * d)) === p; d++) cells.unshift([x - dx * d, y - dy * d]);
			if (cells.length > best.length) best = cells;
		}
		return best;
	}

	// ------------------------------------------------------------- the bot
	//
	// A one-ply bot that reads lines the way a person does. For every legal
	// cell it asks, for itself and for the player who moves next: what would
	// a mark here make? Five wins; an open four (both ends free) cannot be
	// stopped by one player; a four must be answered; an open three becomes
	// an open four if left alone. Its own lines score as attack, the next
	// player's as defence, and it plays the best sum. So it takes a win,
	// blocks a five, makes or blocks open fours, blocks open threes, and
	// otherwise extends its own lines near the action.
	//
	// With three or four players it guards only against the player after it:
	// a later player's threat is the job of whoever moves just before them.
	// Measured over bot-only games (2026-11-22): when every bot blocked every
	// five, three- and four-player games never ended (an open four has two
	// ends, and two defenders close both); guarding the next player alone,
	// they end in 30-250 marks. The next player's smaller lines also weigh
	// little there (NEXT_MANY), for the same reason. And past TIRED_FROM marks
	// a bot guards less and less, so a long game finds a winner; it never
	// stops blocking the next player's five.

	// Patterns over a line of 9 cells centred on the new mark: 1 = this
	// player's (the new mark included), 0 = empty, 2 = anyone else's. Checked
	// strongest first; each direction scores its best.
	const PATTERNS = [
		[/11111/, 1e7, "five"],
		[/011110/, 2e5, "open four"],
		[/11110|01111|11101|11011|10111/, 2.5e4, "four"],
		[/001110|011100/, 6e3, "open three"],
		[/010110|011010/, 5e3, "split three"],
		[/01110|11100|00111|11010|01011|10110|01101|10011|11001|10101/, 600, "three"],
		[/00110|01100|01010/, 300, "open two"],
		[/11|101/, 40, "two"],
	];

	/** The 9-cell line through (x, y) along (dx, dy), as `p` would see it with a mark at (x, y). */
	function lineAt(board, x, y, dx, dy, p) {
		let s = "";
		for (let d = -4; d <= 4; d++) {
			if (d === 0) {
				s += "1";
				continue;
			}
			const v = board.get(key(x + dx * d, y + dy * d));
			s += v === undefined ? "0" : v === p ? "1" : "2";
		}
		return s;
	}

	/** What a mark of `p`'s at (x, y) is worth to `p`: the best pattern in each direction, summed. */
	function worth(board, x, y, p) {
		let total = 0;
		for (const [dx, dy] of DIRS) {
			const line = lineAt(board, x, y, dx, dy, p);
			const hit = PATTERNS.find(([re]) => re.test(line));
			total += hit ? hit[1] : 1;
		}
		return total;
	}

	/** A number in [0, 1) from integers: the bot's dice, the same on every phone for the same position. */
	function hash01(...ns) {
		let h = 2166136261;
		for (const n of ns) {
			h ^= n | 0;
			h = Math.imul(h, 16777619);
			h ^= h >>> 13;
		}
		return ((h >>> 0) % 100003) / 100003;
	}

	/**
	 * The cell seat `me` plays: [x, y]. `order` is the seats still playing,
	 * in turn order from `me`: the next of them is the one it guards against.
	 * `salt` varies the quiet moves (a cell's worth is shaken by up to
	 * JITTER), so bots do not all play alike and a game does not replay
	 * itself; a forced move (a five, a four, an open three to answer) is
	 * worth so much more that the shake never hides it.
	 */
	const JITTER = 0.3;
	const NEXT_MANY = 0.05;
	const TIRED_FROM = 120;
	const TIRED_SPAN = 120;
	const TIRED_MIN = 0.02;
	function botCell(marks, me, order, salt = 0) {
		const board = boardOf(marks);
		const cells = legalCells(board);
		if (cells.length === 1) return cells[0];
		const next = order.find((p) => p !== me);
		const many = order.length > 2;
		const tired = Math.max(TIRED_MIN, 1 - Math.max(0, marks.length - TIRED_FROM) / TIRED_SPAN);
		let best = null;
		for (const [x, y] of cells) {
			let value = worth(board, x, y, me) * 1.1;
			if (next !== undefined) {
				const w = worth(board, x, y, next);
				value += w >= 1e7 ? 5e6 : w * tired * (w >= 2e5 || !many ? 1 : NEXT_MANY);
			}
			value *= 1 + JITTER * hash01(x, y, salt);
			// Nearer the centre of play by a hair: ties go inwards.
			value -= (Math.abs(x) + Math.abs(y)) * 0.01;
			if (!best || value > best.value) best = { x, y, value };
		}
		return [best.x, best.y];
	}

	// ----------------------------------------------------------- the rules

	/** The managed rules (docs/sdk-v2.md, Layer 2). */
	function game() {
		let s = null; // { match, seats, out, turn, opener, marks, last, winner, line, moves }

		const playing = () => s.seats.map((_, i) => i).filter((i) => !s.out[i]);
		/** The next seat on from `i` still playing. */
		const after = (i) => {
			for (let k = 1; k <= s.seats.length; k++) {
				const j = (i + k) % s.seats.length;
				if (!s.out[j]) return j;
			}
			return i;
		};
		/** The seats still playing, in turn order starting with `i`. */
		const orderFrom = (i) => {
			const out = [i];
			for (let j = after(i); j !== i && out.length < s.seats.length; j = after(j)) out.push(j);
			return out;
		};
		const seatOf = (id) => s.seats.indexOf(id);

		return {
			init({ seats, seed, match, first }) {
				const ids = seats.map((p) => p.id);
				// Who opens (docs/sdk-v2.md "Who starts"): the platform's `first`;
				// from an older shell, the seat after the last match's opener,
				// or a draw from the seed for a run's first match.
				let opener = ids.indexOf(first);
				if (opener < 0 && s?.opener != null) {
					const was = s.seats.indexOf(s.opener);
					const prev = ids.indexOf(s.opener);
					opener = prev >= 0 ? (prev + 1) % ids.length : Math.max(0, was) % ids.length;
				}
				if (opener < 0) opener = Math.abs(Math.floor(Number(seed) || 0)) % Math.max(1, ids.length);
				s = { match: match + 1, seed: Math.floor(Number(seed) || 0) % 1e9, seats: ids, out: ids.map(() => false), turn: opener, opener: ids[opener] ?? null, marks: [], last: null, winner: null, line: null, moves: 0 };
			},

			apply({ action, by }) {
				if (s.winner !== null) return "the game is over";
				const me = seatOf(by);
				if (me < 0 || s.out[me]) return "you are not playing";
				if (me !== s.turn) return "not your turn";
				const x = action?.x;
				const y = action?.y;
				const board = boardOf(s.marks);
				if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > 1e6 || Math.abs(y) > 1e6) return "no such cell";
				if (!board.size && (x !== 0 || y !== 0)) return "the first mark goes in the centre";
				if (board.has(key(x, y))) return "that cell is taken";
				if (!legal(board, x, y)) return "place it next to a mark";
				s.marks.push([x, y, me]);
				board.set(key(x, y), me);
				s.moves++;
				s.last = [x, y];
				const line = lineThrough(board, x, y, me);
				if (line.length >= WIN) {
					s.winner = me;
					s.line = line;
				} else if (s.marks.length >= MAX_MARKS) s.winner = -1;
				else s.turn = after(me);
			},

			view: ({ seat }) => ({
				match: s.match,
				seats: [...s.seats],
				out: [...s.out],
				turn: s.turn,
				you: seat == null ? -1 : seatOf(seat),
				marks: s.marks.map((m) => [...m]),
				last: s.last && [...s.last],
				winner: s.winner,
				line: s.line && s.line.map((c) => [...c]),
				moves: s.moves,
			}),

			turn: () => (s.winner === null && playing().length >= 2 ? [s.seats[s.turn]] : []),

			bot: ({ seat }) => {
				const me = seatOf(seat);
				if (me < 0 || me !== s.turn || s.winner !== null) return null;
				const [x, y] = botCell(s.marks, me, orderFrom(me), s.moves * 31 + s.seed);
				return { x, y };
			},

			result() {
				if (s.winner === null) return null;
				const all = s.seats.filter(Boolean);
				if (s.winner < 0) return { kind: "ffa", ranking: [all], details: [{ label: "Marks placed", value: s.moves }] };
				const rest = all.filter((id) => id !== s.seats[s.winner]);
				const details = [{ label: "Marks placed", value: s.moves }];
				if (s.line) details.push({ label: "Winning line", value: `${s.line.length} in a row` });
				return { kind: "ffa", ranking: rest.length ? [[s.seats[s.winner]], rest] : [[s.seats[s.winner]]], details };
			},

			/** The host chose SKIP TURN for someone away: the turn passes on. */
			skip() {
				if (s.winner !== null) return false;
				s.turn = after(s.turn);
				return true;
			},

			/** A player left for good: out of the rotation, their marks stay. The last one playing wins. */
			leave({ seat }) {
				const i = seatOf(seat);
				if (i < 0 || s.out[i] || s.winner !== null) return false;
				s.out[i] = true;
				const left = playing();
				if (left.length === 1) s.winner = left[0];
				else if (s.turn === i) s.turn = after(i);
				return true;
			},

			snapshot: () => JSON.parse(JSON.stringify(s)),
			restore({ snapshot }) {
				s = JSON.parse(JSON.stringify(snapshot));
			},
		};
	}

	globalThis.fiveInARowRules = { WIN, MAX_MARKS, key, boardOf, legal, legalCells, lineThrough, worth, botCell, game };
})();
