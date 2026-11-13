// sudoku/sudoku.js — Sudoku, as a race.
//
// Alone it is plain Sudoku: one tap from the game page, a timer, a best time.
// With friends (or bots) everybody gets **the same puzzle** and the first to
// fill it correctly wins, watching each other's progress fill up as they go.
//
// The host makes the puzzle and sends it as two 81-character strings — the
// givens and the solution. Every phone then solves on its own; the only
// traffic during a race is "I have this many cells right" going to the host
// and the standings coming back. Nobody's digits leave their phone, so there is
// nothing to copy.
//
// The daily puzzle is seeded from the host's date and the difficulty, so every
// table in the world gets the same one each day.
//
// Bots race too. A bot does not solve anything: it fills one cell every few
// seconds, at a pace set by the difficulty, which is all an opponent in a race
// needs to be.

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

	NeonArcade.sudokuRules = {
		CELLS, PEERS, UNITS, LEVELS, LEVEL_IDS, candidates, countSolutions, solve, solvesWithSingles, generate,
		dailyPuzzle, rngFrom, hashString, toText, fromText, today, clock, standings, clearNotes,
	};
})();

NeonArcade.registerGame({
	id: "sudoku",
	name: "SUDOKU",
	blurb: "Alone against the clock, or a race: same puzzle, first to finish wins.",
	shape: "free",
	seats: { min: 1, max: 8 },

	mount(ctx) {
		const { room } = ctx;
		const { CELLS, PEERS, LEVELS, LEVEL_IDS, generate, dailyPuzzle, rngFrom, toText, fromText, today, clock, standings, clearNotes } =
			NeonArcade.sudokuRules;

		const shell = NeonArcade.gameShell(ctx.root, {
			css: `
				.su { display: flex; flex-direction: column; gap: 10px; align-items: center;
					width: 100%; max-width: 520px; }
				.su-race { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; width: 100%; }
				.su-racer { display: flex; flex-direction: column; gap: 3px; min-width: 76px; flex: 1 1 76px;
					max-width: 140px; font-size: 0.7rem; color: var(--ink-2); }
				.su-racer.me { color: var(--accent); }
				.su-racer span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
				.su-bar { height: 5px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
				.su-bar i { display: block; height: 100%; background: currentColor; transition: width 0.3s; }
				.su-grid { display: grid; grid-template-columns: repeat(9, 1fr); aspect-ratio: 1;
					width: min(100%, calc(100dvh - 330px)); min-width: 260px;
					border: 2px solid var(--ink); border-radius: 6px; overflow: hidden;
					background: var(--surface); user-select: none; touch-action: manipulation; }
				.su-cell { position: relative; display: flex; align-items: center; justify-content: center;
					border: 0; border-right: 1px solid var(--rule); border-bottom: 1px solid var(--rule);
					background: transparent; color: var(--accent); padding: 0; font: inherit;
					font-size: var(--su-digit, 1.4rem); cursor: pointer; }
				.su-cell:nth-child(9n) { border-right: 0; }
				.su-cell:nth-child(9n+3), .su-cell:nth-child(9n+6) { border-right: 2px solid var(--ink); }
				.su-cell:nth-child(n+19):nth-child(-n+27), .su-cell:nth-child(n+46):nth-child(-n+54) {
					border-bottom: 2px solid var(--ink); }
				.su-cell:nth-child(n+73) { border-bottom: 0; }
				.su-cell.given { color: var(--ink); font-weight: 600; }
				.su-cell.near { background: var(--surface-2); }
				.su-cell.same { background: color-mix(in oklch, var(--accent) 16%, transparent); }
				.su-cell.sel { background: color-mix(in oklch, var(--accent) 32%, transparent); }
				.su-notes { position: absolute; inset: 2px; display: grid; grid-template-columns: repeat(3, 1fr);
					font-size: var(--su-note, 0.55rem); color: var(--ink-2); line-height: 1; }
				.su-notes span { display: flex; align-items: center; justify-content: center; }
				.su-pad { display: grid; grid-template-columns: repeat(5, 1fr); gap: 6px; width: 100%; max-width: 440px; }
				.su-pad button { min-height: 48px; border-radius: 8px; border: 2px solid var(--rule);
					background: var(--surface); color: var(--ink); font: inherit; font-size: 1.2rem; cursor: pointer; }
				.su-pad button:disabled { opacity: 0.35; }
				.su-pad button.tool { font-size: 0.72rem; letter-spacing: 0.08em; color: var(--ink-2); }
				.su-pad button.wide { grid-column: 1 / -1; }
				.su-pad button.on { border-color: var(--accent); color: var(--accent); }
				.su-msg { min-height: 1.2em; font-size: 0.78rem; color: var(--ink-2); text-align: center; }
				.su-pick { display: flex; flex-direction: column; gap: 12px; align-items: center; width: 100%; max-width: 380px; }
				.su-pick h2 { margin: 0; font-weight: normal; font-size: 1.6rem; color: var(--ink); }
				.su-levels { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; width: 100%; }
				.su-levels button { min-height: 52px; border-radius: 8px; border: 2px solid var(--rule);
					background: var(--surface); color: var(--ink); font: inherit; cursor: pointer;
					display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px; }
				.su-levels button small { font-size: 0.68rem; color: var(--ink-3); }
				.su-levels button.on { border-color: var(--accent); color: var(--accent); }
				.su-go { display: flex; flex-direction: column; gap: 8px; width: 100%; }
				.su-go .neon-btn { min-height: 48px; width: 100%; }
				.su-hint { font-size: 0.76rem; color: var(--ink-2); text-align: center; line-height: 1.45; }
			`,
		});

		const wrap = document.createElement("div");
		wrap.className = "su";
		const fill = document.createElement("div");
		fill.className = "g-fill";
		fill.append(wrap);
		shell.stage.append(fill);

		const el = (tag, className, text) => {
			const node = document.createElement(tag);
			if (className) node.className = className;
			if (text != null) node.textContent = text;
			return node;
		};

		// -------------------------------------------------------------- state
		//
		// `state` is the host's and everyone's copy of it: which puzzle, and
		// how far each racer has got. The digits a player has typed are theirs
		// alone and never leave the phone (`board`).

		const stateAction = room.makeAction("suState");
		const progressAction = room.makeAction("suProgress");

		let state = {
			match: 0,
			phase: "pick", // "pick" | "play" | "over"
			level: null,
			daily: null, // the date, when it is the daily puzzle
			puzzle: null, // 81 characters, 0 for empty
			solution: null,
			progress: {}, // id → cells right
			times: {}, // id → ms, once finished
			winner: null,
		};

		const store = ctx.storage;
		let level = LEVEL_IDS.includes(store?.get("level")) ? store.get("level") : "easy";
		let best = store?.get("best") ?? {}; // level → ms
		let dailyDone = store?.get("daily") ?? {}; // "date:level" → ms

		let board = null; // { puzzle, solution, entries, notes, given, startedAt, elapsedBefore, solvedMs }
		let selected = -1;
		let notesMode = false;
		let reportedMatch = 0;
		let botDue = new Map();
		let botTimer = null;
		let tickTimer = null;

		const players = () => ctx.players();
		const playing = () => players().includes(room.selfId);
		const empties = () => (state.puzzle ? [...state.puzzle].filter((ch) => ch === "0").length : 0);

		// ---------------------------------------------------------- the board

		function openBoard() {
			const puzzle = fromText(state.puzzle);
			const saved = store?.get("current");
			const resume = saved?.puzzle === state.puzzle;
			board = {
				match: state.match,
				puzzle,
				solution: fromText(state.solution),
				given: puzzle.map(Boolean),
				entries: resume ? fromText(saved.entries) : puzzle.slice(),
				notes: resume && Array.isArray(saved.notes) ? saved.notes.slice() : Array(CELLS).fill(0),
				startedAt: performance.now(),
				elapsedBefore: resume ? saved.elapsed ?? 0 : 0,
				solvedMs: null,
			};
			selected = board.given.indexOf(false);
			notesMode = false;
			report();
		}

		const elapsed = () => board ? board.solvedMs ?? board.elapsedBefore + (performance.now() - board.startedAt) : 0;
		const rightCount = () => board ? board.entries.filter((d, i) => !board.given[i] && d === board.solution[i]).length : 0;

		function save() {
			if (!board) return;
			store?.set("current", {
				puzzle: state.puzzle,
				solution: state.solution,
				level: state.level,
				daily: state.daily,
				entries: toText(board.entries),
				notes: board.notes,
				elapsed: Math.round(elapsed()),
			});
		}

		/** Tell the host how far I have got; finishing is just "all of them". */
		function report() {
			if (!board || !playing() || state.phase !== "play") return;
			const right = rightCount();
			const done = right === empties();
			if (done && board.solvedMs == null) board.solvedMs = elapsed();
			const msg = { match: state.match, right, ms: done ? Math.round(board.solvedMs) : null };
			if (room.isHost()) onProgress(room.selfId, msg);
			else progressAction.send(msg, { target: room.hostId() });
		}

		function place(digit) {
			if (!board || state.phase !== "play" || !playing() || selected < 0 || board.given[selected]) return;
			if (board.solvedMs != null) return;
			if (notesMode && digit) {
				if (board.entries[selected]) return;
				board.notes[selected] ^= 1 << digit;
			} else {
				const was = board.entries[selected];
				board.entries[selected] = was === digit ? 0 : digit;
				if (board.entries[selected]) board.notes = clearNotes(board.notes, selected, digit);
				else board.notes[selected] = 0;
			}
			save();
			report();
			render();
		}

		function move(dr, dc) {
			const i = selected < 0 ? 0 : selected;
			const r = (Math.floor(i / 9) + dr + 9) % 9;
			const c = ((i % 9) + dc + 9) % 9;
			selected = r * 9 + c;
			render();
		}

		// ---------------------------------------------------------- the host

		function broadcast(target) {
			if (room.isHost()) stateAction.send(state, target ? { target } : undefined);
		}

		/** `how`: "daily", "new", or "resume" (the unfinished one on this phone). */
		function startPuzzle(how) {
			if (!room.isHost()) return;
			const date = today();
			const saved = store?.get("current");
			let made;
			if (how === "resume" && saved?.puzzle) made = { puzzle: saved.puzzle, solution: saved.solution };
			else {
				const grid = how === "daily" ? dailyPuzzle(date, level) : generate(level, rngFrom((Math.random() * 2 ** 32) >>> 0));
				made = { puzzle: toText(grid.puzzle), solution: toText(grid.solution) };
			}
			state = {
				match: state.match + 1,
				phase: "play",
				level: how === "resume" ? saved.level : level,
				daily: how === "resume" ? saved.daily ?? null : how === "daily" ? date : null,
				puzzle: made.puzzle,
				solution: made.solution,
				progress: Object.fromEntries(players().map((id) => [id, 0])),
				times: {},
				winner: null,
			};
			botDue = new Map();
			onState();
			broadcast();
		}

		function onProgress(id, { match, right, ms }) {
			if (!room.isHost() || match !== state.match || state.phase !== "play") return;
			if (!players().includes(id)) return;
			state.progress[id] = Math.max(0, Math.min(empties(), right | 0));
			if (ms != null && state.progress[id] === empties()) {
				state.times[id] = ms;
				state.winner = id;
				state.phase = "over";
			}
			onState();
			broadcast();
		}

		/** Bots fill a cell every few seconds, at the difficulty's pace. */
		function botTick() {
			if (!room.isHost() || state.phase !== "play") return;
			const now = performance.now();
			const pace = LEVELS[state.level].botMs;
			for (const id of players()) {
				if (!ctx.isBot(id)) continue;
				if (!botDue.has(id)) botDue.set(id, now + pace * (0.6 + Math.random() * 0.8));
				if (now < botDue.get(id)) continue;
				botDue.delete(id);
				const right = (state.progress[id] ?? 0) + 1;
				const done = right === empties();
				onProgress(id, { match: state.match, right, ms: done ? Math.round(now - (state.startedAtHost ?? now)) : null });
				if (state.phase !== "play") return;
			}
		}

		function startHostClocks() {
			clearInterval(botTimer);
			botTimer = setInterval(botTick, 250);
		}

		// --------------------------------------------------------- the network

		stateAction.onMessage = (data) => {
			if (room.isHost()) return;
			state = data;
			onState();
		};

		progressAction.onMessage = (data, { peerId }) => onProgress(peerId, data ?? {});

		/** Whatever just changed in `state`, catch the board and the screen up. */
		function onState() {
			if (state.phase !== "pick" && state.puzzle && board?.match !== state.match) {
				if (room.isHost()) state.startedAtHost = performance.now();
				openBoard();
			}
			if (state.phase === "over") finish();
			else shell.hideOverlay();
			render();
		}

		// ------------------------------------------------------------ the end

		function finish() {
			const me = room.selfId;
			const mine = state.times[me] ?? (board?.solvedMs != null ? Math.round(board.solvedMs) : null);
			const solo = players().length === 1;

			if (reportedMatch !== state.match) {
				reportedMatch = state.match;
				const ranking = standings(players(), state.progress, state.winner);
				ctx.reportResult?.(solo
					? { kind: "coop", match: state.match, ranking, scores: mine != null ? { [me]: Math.round(mine / 1000) } : undefined }
					: { kind: "ffa", match: state.match, ranking, scores: { ...state.progress } });
				// A best time is a solve on this phone, raced or not.
				if (state.winner === me && mine != null) {
					if (!(best[state.level] <= mine)) {
						best = { ...best, [state.level]: mine };
						store?.set("best", best);
					}
					if (state.daily) {
						const key = `${state.daily}:${state.level}`;
						// Kept to the last few weeks, so storage does not grow forever.
						const kept = Object.entries(dailyDone).sort(([a], [b]) => b.localeCompare(a)).slice(0, 59);
						dailyDone = Object.fromEntries([[key, Math.min(dailyDone[key] ?? Infinity, mine)], ...kept]);
						store?.set("daily", dailyDone);
					}
				}
				store?.set("current", null);
			}

			const winnerName = state.winner === me ? "You" : ctx.nameOf(state.winner);
			const title = solo
				? `SOLVED IN ${clock(mine ?? 0)}`
				: state.winner === me ? "YOU WIN!" : `${winnerName.toUpperCase()} WINS`;
			const lines = [];
			if (!solo) {
				for (const place of standings(players(), state.progress, state.winner)) {
					for (const id of place) {
						const name = id === me ? "You" : ctx.nameOf(id);
						lines.push(id === state.winner
							? `${name} — solved${state.times[id] != null ? ` in ${clock(state.times[id])}` : ""}`
							: `${name} — ${state.progress[id] ?? 0} of ${empties()}`);
					}
				}
			}
			const b = best[state.level];
			lines.push(`${LEVELS[state.level].label}${state.daily ? " · today's puzzle" : ""}${b ? ` · your best ${clock(b)}` : ""}`);
			shell.showOverlay({
				title,
				lines,
				buttons: room.isHost()
					? [{ label: "NEW PUZZLE", onClick: () => {
						state = { ...state, phase: "pick" };
						board = null;
						onState();
						broadcast();
					} }]
					: [],
			});
			if (!room.isHost()) shell.overlay.append(el("p", null, "Waiting for the host…"));
		}

		// --------------------------------------------------------- the screens

		function renderPick() {
			wrap.replaceChildren();
			const pick = el("div", "su-pick");
			if (!room.isHost()) {
				pick.append(el("h2", null, "Sudoku"));
				pick.append(el("div", "su-hint", "The host is picking a puzzle. Everybody gets the same one — first to finish wins."));
				wrap.append(pick);
				return;
			}
			pick.append(el("h2", null, "Sudoku"));
			pick.append(el("div", "su-hint", players().length > 1
				? "Everybody gets the same puzzle. First to fill it in correctly wins."
				: "Fill every row, column and box with 1 to 9."));
			const levels = el("div", "su-levels");
			for (const id of LEVEL_IDS) {
				const b = el("button", id === level ? "on" : "");
				b.type = "button";
				b.append(el("span", null, LEVELS[id].label));
				b.append(el("small", null, best[id] ? `best ${clock(best[id])}` : "—"));
				b.setAttribute("aria-pressed", String(id === level));
				b.addEventListener("click", () => {
					level = id;
					store?.set("level", level);
					render();
				});
				levels.append(b);
			}
			pick.append(levels);
			const go = el("div", "su-go");
			const key = `${today()}:${level}`;
			const daily = el("button", "neon-btn neon-btn--accent",
				dailyDone[key] ? `TODAY'S PUZZLE · DONE IN ${clock(dailyDone[key])}` : "TODAY'S PUZZLE");
			daily.type = "button";
			daily.addEventListener("click", () => startPuzzle("daily"));
			const fresh = el("button", "neon-btn", "NEW PUZZLE");
			fresh.type = "button";
			fresh.addEventListener("click", () => startPuzzle("new"));
			go.append(daily, fresh);
			// An unfinished puzzle from last time, for one player only: carrying
			// it into a race would hand the host a head start.
			const saved = store?.get("current");
			if (saved?.puzzle && saved.solution && LEVELS[saved.level] && players().length === 1) {
				const more = el("button", "neon-btn",
					`CONTINUE · ${LEVELS[saved.level].label}${saved.daily ? " · daily" : ""} · ${clock(saved.elapsed ?? 0)}`);
				more.type = "button";
				more.addEventListener("click", () => startPuzzle("resume"));
				go.prepend(more);
			}
			pick.append(go);
			wrap.append(pick);
		}

		let cells = [];
		let padButtons = [];
		let notesButton = null;
		let raceBox = null;
		let msg = null;

		function buildPlay() {
			wrap.replaceChildren();
			raceBox = el("div", "su-race");
			const grid = el("div", "su-grid");
			grid.setAttribute("role", "grid");
			cells = Array.from({ length: CELLS }, (_, i) => {
				const c = el("button", "su-cell");
				c.type = "button";
				c.addEventListener("pointerdown", (e) => {
					e.preventDefault();
					selected = i;
					render();
				});
				grid.append(c);
				return c;
			});
			msg = el("div", "su-msg");
			const pad = el("div", "su-pad");
			padButtons = [];
			for (let d = 1; d <= 9; d++) {
				const b = el("button", null, String(d));
				b.type = "button";
				b.addEventListener("click", () => place(d));
				pad.append(b);
				padButtons.push(b);
			}
			const erase = el("button", "tool", "ERASE");
			erase.type = "button";
			erase.addEventListener("click", () => place(0));
			pad.append(erase);
			notesButton = el("button", "tool wide", "NOTES");
			notesButton.type = "button";
			notesButton.addEventListener("click", () => {
				notesMode = !notesMode;
				render();
			});
			pad.append(notesButton);
			wrap.append(raceBox, grid, msg, pad);
			sizeDigits();
		}

		/** Digits scale with the grid, which scales with the phone. */
		function sizeDigits() {
			const grid = wrap.querySelector(".su-grid");
			if (!grid) return;
			const cell = grid.clientWidth / 9;
			grid.style.setProperty("--su-digit", `${Math.round(cell * 0.58)}px`);
			grid.style.setProperty("--su-note", `${Math.max(8, Math.round(cell * 0.26))}px`);
		}

		function renderPlay() {
			if (!wrap.querySelector(".su-grid")) buildPlay();
			const total = empties();
			// The race: everybody's progress, me first.
			raceBox.replaceChildren();
			const ids = players();
			if (ids.length > 1) {
				for (const id of [room.selfId, ...ids.filter((x) => x !== room.selfId)]) {
					if (!ids.includes(id)) continue;
					const r = el("div", "su-racer" + (id === room.selfId ? " me" : ""));
					const done = state.progress[id] ?? 0;
					r.append(el("span", null, `${id === room.selfId ? "You" : ctx.nameOf(id)} ${Math.round((done / total) * 100)}%`));
					const bar = el("div", "su-bar");
					const fillBar = el("i");
					fillBar.style.width = `${(done / total) * 100}%`;
					bar.append(fillBar);
					r.append(bar);
					raceBox.append(r);
				}
			}
			if (!board) return;
			const sel = selected;
			const selDigit = sel >= 0 ? board.entries[sel] : 0;
			const counts = Array(10).fill(0);
			for (const d of board.entries) counts[d]++;
			for (let i = 0; i < CELLS; i++) {
				const c = cells[i];
				const d = board.entries[i];
				let cls = "su-cell";
				if (board.given[i]) cls += " given";
				if (i === sel) cls += " sel";
				else if (selDigit && d === selDigit) cls += " same";
				else if (sel >= 0 && PEERS[sel].includes(i)) cls += " near";
				if (c.className !== cls) c.className = cls;
				if (d) {
					if (c.textContent !== String(d) || c.firstChild?.nodeType !== 3) c.textContent = String(d);
				} else if (board.notes[i]) {
					const notes = el("div", "su-notes");
					for (let n = 1; n <= 9; n++) notes.append(el("span", null, board.notes[i] & (1 << n) ? String(n) : ""));
					c.replaceChildren(notes);
				} else if (c.childNodes.length) {
					c.replaceChildren();
				}
				const r = Math.floor(i / 9) + 1;
				c.setAttribute("aria-label", `row ${r} column ${(i % 9) + 1}${d ? `, ${d}` : ""}`);
			}
			const canPlay = playing() && state.phase === "play" && board.solvedMs == null;
			padButtons.forEach((b, k) => (b.disabled = !canPlay || counts[k + 1] >= 9));
			notesButton.className = "tool wide" + (notesMode ? " on" : "");
			notesButton.setAttribute("aria-pressed", String(notesMode));
			const full = board.entries.every(Boolean);
			msg.textContent = !playing() ? "Watching the race."
				: full && rightCount() !== total ? "Every cell is filled, but something is not right yet."
				: notesMode ? "Notes: tap digits to pencil them in." : "";
		}

		function renderHud() {
			const parts = [];
			if (state.phase === "pick") parts.push({ key: "s", text: "Pick a puzzle", className: "g-muted" });
			else {
				parts.push({ key: "s", text: `${LEVELS[state.level].label}${state.daily ? " · Daily" : ""}` });
				parts.push({ key: "t", text: clock(elapsed()), className: "g-muted" });
			}
			shell.setHud(parts);
		}

		function render() {
			if (state.phase === "pick") {
				cells = [];
				renderPick();
			} else {
				renderPlay();
			}
			renderHud();
		}

		// ---------------------------------------------------------- the input

		const onKey = (e) => {
			if (state.phase !== "play") return;
			if (e.key >= "1" && e.key <= "9") place(Number(e.key));
			else if (e.key === "Backspace" || e.key === "Delete" || e.key === "0") place(0);
			else if (e.key === "n" || e.key === "N") {
				notesMode = !notesMode;
				render();
			} else if (e.key === "ArrowUp") move(-1, 0);
			else if (e.key === "ArrowDown") move(1, 0);
			else if (e.key === "ArrowLeft") move(0, -1);
			else if (e.key === "ArrowRight") move(0, 1);
			else return;
			e.preventDefault();
		};
		window.addEventListener("keydown", onKey);
		window.addEventListener("resize", sizeDigits);

		// --------------------------------------------------------------- boot

		tickTimer = setInterval(() => {
			if (state.phase === "play") renderHud();
		}, 1000);
		if (room.isHost()) startHostClocks();
		render();
		if (room.isHost()) broadcast();

		return {
			debug: () => ({
				phase: state.phase,
				match: state.match,
				level: state.level,
				daily: state.daily,
				puzzle: state.puzzle,
				solution: state.solution,
				progress: { ...state.progress },
				winner: state.winner,
				entries: board ? toText(board.entries) : null,
				notes: board ? board.notes.slice() : null,
				selected,
				notesMode,
			}),
			/** The crown moved to us: the state came with every broadcast; restart the bots. */
			takeOver() {
				botDue = new Map();
				startHostClocks();
				broadcast();
				render();
				return true;
			},
			onPeerJoin(peerId) {
				if (room.isHost()) broadcast(peerId);
				render();
			},
			onPeerLeave() {
				render();
			},
			onRoster() {
				render();
			},
			unmount() {
				clearInterval(botTimer);
				clearInterval(tickTimer);
				window.removeEventListener("keydown", onKey);
				window.removeEventListener("resize", sizeDigits);
				stateAction.onMessage = null;
				progressAction.onMessage = null;
				shell.destroy();
			},
		};
	},
});
