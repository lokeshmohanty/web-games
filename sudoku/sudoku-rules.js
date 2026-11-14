// sudoku/sudoku-rules.js — Sudoku's rules: the grid, the generator, the race.
//
// No document here and no platform: sudoku.js (the page) hands `race()` to the
// platform as SDK v2 managed rules, and test-sudoku.mjs loads this file alone
// to check the generator and to play races in Node.

(() => {
	// ------------------------------------------------------------ the grid
	//
	// A grid is an array of 81 numbers, row by row, 0 for empty.

	const CELLS = 81;
	const rowOf = (i) => Math.floor(i / 9);
	const colOf = (i) => i % 9;
	const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

	/** For each cell, the 20 others that share its row, column or box. */
	const PEERS = Array.from({ length: CELLS }, (_, i) => {
		const out = [];
		for (let j = 0; j < CELLS; j++) {
			if (j !== i && (rowOf(j) === rowOf(i) || colOf(j) === colOf(i) || boxOf(j) === boxOf(i))) out.push(j);
		}
		return out;
	});

	/** The 27 units: nine rows, nine columns, nine boxes. */
	const UNITS = [
		...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
		...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
		...Array.from({ length: 9 }, (_, b) => Array.from({ length: CELLS }, (_, i) => i).filter((i) => boxOf(i) === b)),
	];

	const ALL = 0b1111111110; // bits 1..9

	/** Digits still possible in cell `i`, as a bitmask over bits 1..9. */
	function candidates(grid, i) {
		let used = 0;
		for (const j of PEERS[i]) used |= 1 << grid[j];
		return ALL & ~used;
	}

	const bitCount = (m) => {
		let n = 0;
		for (; m; m &= m - 1) n++;
		return n;
	};

	/** A seeded generator (mulberry32), so the daily puzzle is the same everywhere. */
	function rngFrom(seed) {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	/** A 32-bit hash of a string, for seeding. */
	function hashString(text) {
		let h = 2166136261;
		for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
		return h >>> 0;
	}

	const shuffle = (list, rng) => {
		const out = [...list];
		for (let i = out.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	};

	/**
	 * Count solutions, stopping at `limit`. Backtracking on the most
	 * constrained cell first, which keeps it to milliseconds for any real
	 * puzzle. Passing `rng` makes it try digits in random order — that is also
	 * how a full grid is made from an empty one.
	 */
	function search(grid, { limit = 2, rng = null, onSolution = null } = {}) {
		const g = grid.slice();
		let count = 0;
		const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
		const step = () => {
			let best = -1;
			let bestMask = 0;
			let bestN = 10;
			for (let i = 0; i < CELLS; i++) {
				if (g[i]) continue;
				const m = candidates(g, i);
				const n = bitCount(m);
				if (n === 0) return;
				if (n < bestN) {
					best = i;
					bestMask = m;
					bestN = n;
					if (n === 1) break;
				}
			}
			if (best < 0) {
				count++;
				onSolution?.(g.slice());
				return;
			}
			for (const d of rng ? shuffle(digits, rng) : digits) {
				if (!(bestMask & (1 << d))) continue;
				g[best] = d;
				step();
				if (count >= limit) break;
			}
			g[best] = 0;
		};
		step();
		return count;
	}

	const countSolutions = (grid, limit = 2) => search(grid, { limit });

	function solve(grid) {
		let found = null;
		search(grid, { limit: 1, onSolution: (g) => (found = g) });
		return found;
	}

	/**
	 * Can this be finished with singles alone — a cell with one candidate left,
	 * or a digit with one place left in a unit? That is the line between the
	 * puzzles anyone can finish by looking and the ones that need real
	 * deduction, so it is what separates the difficulties.
	 */
	function solvesWithSingles(grid) {
		const g = grid.slice();
		for (let progress = true; progress;) {
			progress = false;
			for (let i = 0; i < CELLS; i++) {
				if (g[i]) continue;
				const m = candidates(g, i);
				if (!m) return false;
				if (bitCount(m) === 1) {
					g[i] = Math.log2(m);
					progress = true;
				}
			}
			for (const unit of UNITS) {
				for (let d = 1; d <= 9; d++) {
					if (unit.some((i) => g[i] === d)) continue;
					const spots = unit.filter((i) => !g[i] && candidates(g, i) & (1 << d));
					if (spots.length === 1) {
						g[spots[0]] = d;
						progress = true;
					}
				}
			}
		}
		return g.every(Boolean);
	}

	/**
	 * The difficulties. `clues` is where removing stops; `singles` says the
	 * result must (true) or must not (false) be finishable by singles alone.
	 * Hard and Expert both need more than singles; Expert also takes away as
	 * many clues as the grid allows.
	 */
	const LEVELS = {
		easy: { label: "Easy", clues: 38, singles: true, botMs: 7000 },
		medium: { label: "Medium", clues: 31, singles: true, botMs: 10000 },
		hard: { label: "Hard", clues: 27, singles: false, botMs: 14000 },
		expert: { label: "Expert", clues: 17, singles: false, botMs: 19000 },
	};
	const LEVEL_IDS = Object.keys(LEVELS);

	/**
	 * Make a puzzle with exactly one solution. Returns `{ puzzle, solution }`,
	 * both arrays of 81. Deterministic for a given `rng`.
	 */
	function generate(level, rng) {
		const spec = LEVELS[level];
		let fallback = null;
		// Hard and Expert want a puzzle singles cannot finish. At 27 clues about
		// two in three can be (measured: 26 in 40), so it takes a few tries —
		// twelve find one all but always; the rare run that does not deals the last try rather than stall.
		for (let attempt = 0; attempt < 12; attempt++) {
			let solution = null;
			search(Array(CELLS).fill(0), { limit: 1, rng, onSolution: (g) => (solution = g) });
			const puzzle = solution.slice();
			let clues = CELLS;
			for (const i of shuffle([...Array(CELLS).keys()], rng)) {
				if (clues <= spec.clues) break;
				const keep = puzzle[i];
				puzzle[i] = 0;
				if (countSolutions(puzzle) !== 1 || (spec.singles === true && !solvesWithSingles(puzzle))) {
					puzzle[i] = keep;
				} else {
					clues--;
				}
			}
			fallback = { puzzle, solution };
			if (spec.singles !== false || !solvesWithSingles(puzzle)) return fallback;
		}
		return fallback;
	}

	/** Today's puzzle for this difficulty: the same on every phone that day. */
	const dailyPuzzle = (date, level) => generate(level, rngFrom(hashString(`sudoku:${date}:${level}`)));

	const toText = (grid) => grid.join("");
	const fromText = (text) => [...text].map(Number);

	/** "2026-11-13", in the player's own time zone. */
	const today = (now = new Date()) =>
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

	const clock = (ms) => {
		const s = Math.floor(ms / 1000);
		const h = Math.floor(s / 3600);
		const mm = String(Math.floor((s % 3600) / 60)).padStart(h ? 2 : 1, "0");
		return `${h ? h + ":" : ""}${mm}:${String(s % 60).padStart(2, "0")}`;
	};

	/**
	 * Places at the end of a race: the winner alone first, then everybody else
	 * by how many cells they had right, ties sharing a place.
	 */
	function standings(players, progress, winner) {
		const rest = players.filter((id) => id !== winner);
		const scores = [...new Set(rest.map((id) => progress[id] ?? 0))].sort((a, b) => b - a);
		const places = scores.map((s) => rest.filter((id) => (progress[id] ?? 0) === s));
		return winner ? [[winner], ...places] : places;
	}

	/**
	 * Notes cleared when a digit is placed: that cell's own, and the digit from
	 * every cell that can no longer hold it.
	 */
	function clearNotes(notes, i, digit) {
		const out = notes.slice();
		out[i] = 0;
		for (const j of PEERS[i]) out[j] &= ~(1 << digit);
		return out;
	}


	// ------------------------------------------------------------ the race
	//
	// SDK v2 managed state: the platform calls these on the host and sends
	// every phone its view. The host deals one puzzle — the givens and the
	// solution, as two 81-character strings — and every phone then solves on
	// its own. The only traffic during a race is "I have this many cells right"
	// going to the host and the standings coming back. Nobody's digits leave
	// their phone, so there is nothing to copy.
	//
	// Bots race too. A bot does not solve anything: it fills one cell every few
	// seconds, at a pace set by the difficulty, which is all an opponent in a
	// race needs to be. The platform moves a bot when `turn()` names it, so
	// `turn()` names the bot due next and `apply` fills every bot whose time
	// has come — one poll a second at most, however many bots there are.

	const empties = (puzzle) => (puzzle ? [...puzzle].filter((ch) => ch === "0").length : 0);
	const isGrid = (text) => typeof text === "string" && /^[0-9]{81}$/.test(text);

	/**
	 * The race as managed rules. `host()` names the party's host (the only one
	 * who deals), `now()` is the host's clock in ms; tests pass their own.
	 */
	function race({ host = () => null, now = () => Date.now(), random = Math.random } = {}) {
		let s = null;
		const pace = () => LEVELS[s.level]?.botMs ?? LEVELS.easy.botMs;
		const nextDue = (from) => from + pace() * (0.6 + random() * 0.8);

		return {
			init({ seats }) {
				s = {
					match: s?.match ?? 0, // puzzles started in this run
					phase: "pick", // "pick" | "play" | "over"
					level: null,
					daily: null, // the date, when it is the daily puzzle
					puzzle: null, // 81 characters, 0 for empty
					solution: null,
					progress: {}, // id → cells right
					times: {}, // id → ms, once finished
					winner: null,
					players: seats.map((p) => p.id),
					bots: seats.filter((p) => p.bot).map((p) => p.id),
					startedAt: 0, // the host's clock
					due: {}, // bot → when it fills its next cell (the host's clock)
				};
			},

			apply({ action, by }) {
				const a = action ?? {};
				if (a.start) {
					// `start`: "daily", "new", or "resume" (the unfinished one on the
					// host's phone, which it sends: it is in the host's storage).
					if (by !== host()) return "only the host deals";
					if (s.phase !== "pick") return "a race is on";
					const level = LEVELS[a.level] ? a.level : "easy";
					let made;
					let daily = null;
					if (a.start === "resume") {
						const r = a.resume ?? {};
						if (!isGrid(r.puzzle) || !isGrid(r.solution) || !LEVELS[r.level]) return "nothing to resume";
						made = { puzzle: r.puzzle, solution: r.solution };
						daily = typeof r.daily === "string" ? r.daily.slice(0, 10) : null;
						s.level = r.level;
					} else {
						const date = today(new Date(now()));
						const grid = a.start === "daily" ? dailyPuzzle(date, level) : generate(level, rngFrom((random() * 2 ** 32) >>> 0));
						made = { puzzle: toText(grid.puzzle), solution: toText(grid.solution) };
						daily = a.start === "daily" ? date : null;
						s.level = level;
					}
					Object.assign(s, {
						match: s.match + 1,
						phase: "play",
						daily,
						puzzle: made.puzzle,
						solution: made.solution,
						progress: Object.fromEntries(s.players.map((id) => [id, 0])),
						times: {},
						winner: null,
						startedAt: now(),
					});
					s.due = Object.fromEntries(s.bots.map((id) => [id, nextDue(s.startedAt)]));
					return;
				}
				if (a.progress) {
					const { match, right, ms } = a.progress;
					if (s.phase !== "play" || match !== s.match) return "that race is over";
					if (!s.players.includes(by) || s.bots.includes(by)) return "not racing";
					const total = empties(s.puzzle);
					s.progress[by] = Math.max(0, Math.min(total, right | 0));
					if (ms != null && s.progress[by] === total) {
						s.times[by] = Math.max(0, ms | 0);
						s.winner = by;
						s.phase = "over";
					}
					return;
				}
				if (a.bot) {
					// A bot's poll: every bot whose cell is due fills it.
					if (!s.bots.includes(by)) return "not a bot";
					if (s.phase !== "play") return;
					const t = now();
					const total = empties(s.puzzle);
					for (const id of s.bots) {
						if (!(s.due[id] <= t)) continue;
						// From when it was due, not from now: the poll's lag must not
						// slow the bot down.
						s.due[id] = Math.max(nextDue(s.due[id]), t);
						s.progress[id] = Math.min(total, (s.progress[id] ?? 0) + 1);
						if (s.progress[id] === total) {
							s.times[id] = Math.round(t - s.startedAt);
							s.winner = id;
							s.phase = "over";
							return;
						}
					}
					return;
				}
				return "unknown move";
			},

			view: () => ({
				match: s.match,
				phase: s.phase,
				level: s.level,
				daily: s.daily,
				puzzle: s.puzzle,
				solution: s.solution,
				progress: { ...s.progress },
				times: { ...s.times },
				winner: s.winner,
				players: [...s.players],
			}),

			/** The bot due soonest, while a race is on: the platform polls it. */
			turn() {
				if (s.phase !== "play" || !s.bots.length) return [];
				const next = s.bots.reduce((a, b) => ((s.due[b] ?? 0) < (s.due[a] ?? 0) ? b : a));
				return [next];
			},
			bot: () => ({ bot: 1 }),

			/**
			 * Places at the end of a race: the winner alone first, then everybody
			 * else by how many cells they had right (the card derives "YOU WIN" /
			 * "X WINS" on each phone). Alone, it is played, with the time it took.
			 */
			result() {
				if (s.phase !== "over") return null;
				const ranking = standings(s.players, s.progress, s.winner);
				if (s.players.length === 1) {
					const ms = s.times[s.winner];
					// The end card's heading, as v1's own said it (the derived one is "GAME OVER").
					return { kind: "coop", ranking, ...(ms != null ? { title: `SOLVED IN ${clock(ms)}`, scores: { [s.winner]: Math.round(ms / 1000) } } : {}) };
				}
				return { kind: "ffa", ranking, scores: { ...s.progress } };
			},

			// Clocks differ between phones, so the heir gets durations.
			snapshot: () => ({ ...s, due: {}, startedAt: 0, elapsed: now() - s.startedAt }),
			restore({ snapshot }) {
				const t = now();
				s = { ...snapshot, startedAt: t - (snapshot.elapsed ?? 0) };
				delete s.elapsed;
				// The bots start their next cell afresh, as a new host's would.
				s.due = s.phase === "play" ? Object.fromEntries(s.bots.map((id) => [id, nextDue(t)])) : {};
			},
		};
	}

	globalThis.sudokuRules = {
		CELLS, PEERS, UNITS, LEVELS, LEVEL_IDS, candidates, countSolutions, solve, solvesWithSingles, generate,
		dailyPuzzle, rngFrom, hashString, toText, fromText, today, clock, standings, clearNotes, empties, race,
	};
})();
