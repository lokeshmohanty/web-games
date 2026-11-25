// light-cycles/light-cycles-rules.js — Light Cycles' arena, bot and round.
//
// No document here and no platform: light-cycles.js (the page) hands `game()`
// to the platform as SDK v2 managed rules, and test-light-cycles.mjs loads
// this file alone to exercise the simulation and the bot in Node.
//
// ## Why this shape suits the transport
//
// It is a **grid on a fixed step**, not a physics simulation, and that is the
// whole reason it can be an eight-player real-time game over a hand-made P2P
// mesh with no server. Each view the host sends carries one head position per
// rider — a few dozen bytes — and every phone paints those cells into its own
// trail canvas: the trail is the accumulation of the heads. Every tenth step
// (and whenever the round is not racing) the view also carries the whole grid,
// so a phone that joined late, or missed a view while reconnecting, catches up
// within a second.

(() => {
	const COLS = 40;
	const ROWS = 40;
	// Clockwise, so turning right is +1 and turning left is +3 (mod 4).
	const ORDER = ["N", "E", "S", "W"];
	const STEP = { N: [0, -1], E: [1, 0], S: [0, 1], W: [-1, 0] };

	// Eight riders, eight spawns, and two things had to be designed out of them.
	//
	// **They must not line up.** The first two are the two-player case; facing
	// each other down one row looks like the right picture and plays badly, with
	// both riders going straight into a head-on about a second in. Measured at
	// 23% of two-player rounds ending in a mutual crash before anyone steered.
	//
	// **They must not be exact opposites.** Rotating one spawn 180° about the
	// centre and getting another one is worse than it sounds: the two riders then
	// see mirror-image arenas, make mirror-image choices, and die on the same
	// tick. Offsetting the pair to `r: 14` and `r: 25` accidentally did exactly
	// that (14 + 25 = 39, and the grid is 0..39) and turned a 21-win run into 24
	// draws out of 30. `scripts/test-light-cycles.mjs` asserts no pair is a
	// mirror, because nothing about the numbers looks wrong.
	const SPAWNS = [
		{ c: 5, r: 14, d: "E" },
		{ c: 34, r: 24, d: "W" },
		{ c: 20, r: 5, d: "S" },
		{ c: 21, r: 34, d: "N" },
		{ c: 8, r: 8, d: "E" },
		{ c: 31, r: 30, d: "W" },
		{ c: 31, r: 8, d: "S" },
		{ c: 8, r: 30, d: "N" },
	];

	const idx = (c, r) => r * COLS + c;
	const inBounds = (c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS;

	// ------------------------------------------------------------ variety
	//
	// Lokesh, 2026-11-24: some randomness in every round, all of it dealt from
	// the round's `seed` (docs/sdk-v2.md "Managed state"), so a round replays.

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

	/**
	 * Which spawn each of `n` seats takes: the first n spawns, in a shuffled
	 * order. Only the order changes — n riders still use the n spawns designed
	 * for n — so the rules above (offset, never a mirror) hold for every deal.
	 */
	function spawnOrder(n, r) {
		const order = Array.from({ length: n }, (_, i) => i % SPAWNS.length);
		for (let i = order.length - 1; i > 0; i--) {
			const j = r.int(0, i);
			[order[i], order[j]] = [order[j], order[i]];
		}
		return order;
	}

	// The "Obstacles" option: a few blocks of wall on the arena from the start,
	// in their own wall value (riders are 1–8). Kept clear of every spawn's
	// lane — the spawn, the cells round it and the first 12 cells ahead, a cell
	// either side — so nobody starts facing one. Five or six blocks of 2–5
	// cells: something to steer round and to trap a rival against, not a maze.
	const WALL = 9;
	const LANE = 12;
	const lanes = (() => {
		const out = new Set();
		for (const sp of SPAWNS) {
			const [dc, dr] = STEP[sp.d];
			for (let k = -1; k <= LANE; k++)
				for (let w = -1; w <= 1; w++) {
					const c = sp.c + dc * k + (dr ? w : 0);
					const r = sp.r + dr * k + (dc ? w : 0);
					if (inBounds(c, r)) out.add(idx(c, r));
				}
		}
		return out;
	})();
	const SHAPES = [
		[[0, 0], [1, 0], [0, 1], [1, 1]], // a square
		[[0, 0], [1, 0], [2, 0], [3, 0]], // a bar across
		[[0, 0], [0, 1], [0, 2], [0, 3]], // a bar down
		[[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], // an L
		[[0, 0], [1, 0], [2, 0], [1, 1], [1, 2]], // a T
	];
	/** The blocks for one round, as cell indices: from a seed (a number) or a generator. */
	function obstaclesFor(from) {
		const r = typeof from === "number" ? rng(from ^ 0x0b57ac1e) : from;
		const blocks = r.int(5, 6);
		const cells = new Set();
		for (let placed = 0, tries = 0; placed < blocks && tries < 200; tries++) {
			const shape = SHAPES[r.int(0, SHAPES.length - 1)];
			const c0 = r.int(2, COLS - 6);
			const r0 = r.int(2, ROWS - 6);
			const at = shape.map(([dc, dr]) => idx(c0 + dc, r0 + dr));
			// Clear of the lanes, and of other blocks by a cell, so no two join
			// into a pocket a rider could be sealed in from the off.
			const near = (i) => {
				const c = i % COLS;
				const rr = (i - c) / COLS;
				for (let dc = -1; dc <= 1; dc++) for (let dr = -1; dr <= 1; dr++) if (cells.has(idx(c + dc, rr + dr))) return true;
				return false;
			};
			if (at.some((i) => lanes.has(i) || near(i))) continue;
			for (const i of at) cells.add(i);
			placed++;
		}
		return [...cells].sort((a, b) => a - b);
	}

	/**
	 * How much open space a rider can still reach from a cell.
	 *
	 * This is the only thing standing between a bot and driving into the nearest
	 * wall, and it is also the whole of its personality: preferring the roomier
	 * side is what makes it cut opponents off and fill its own half instead of
	 * wandering.
	 *
	 * The cap is the whole arena rather than a small number, and that is not an
	 * oversight. Capping it at 220 cells made every option on an open board come
	 * back saturated at 220, so the comparison carried no information and the bot
	 * silently degraded into "go straight unless that kills me" — it beat exactly
	 * that opponent 18 times in 30. Uncapped it is ~1600 cell visits per rider per
	 * tick, which at ten ticks a second is nothing.
	 */
	function openSpace(grid, c, r, cap = COLS * ROWS) {
		if (!inBounds(c, r) || grid[idx(c, r)]) return 0;
		const seen = new Uint8Array(COLS * ROWS);
		const queue = [idx(c, r)];
		seen[idx(c, r)] = 1;
		let count = 0;
		while (queue.length && count < cap) {
			const at = queue.pop();
			count++;
			const cc = at % COLS;
			const rr = (at - cc) / COLS;
			for (const [dc, dr] of Object.values(STEP)) {
				const nc = cc + dc;
				const nr = rr + dr;
				if (!inBounds(nc, nr)) continue;
				const ni = idx(nc, nr);
				if (seen[ni] || grid[ni]) continue;
				seen[ni] = 1;
				queue.push(ni);
			}
		}
		return count;
	}

	/** Free cells orthogonally adjacent to one cell. */
	function openNeighbours(grid, c, r) {
		let n = 0;
		for (const [dc, dr] of Object.values(STEP)) {
			if (inBounds(c + dc, r + dr) && !grid[idx(c + dc, r + dr)]) n++;
		}
		return n;
	}

	/**
	 * Breadth-first distance from a set of starting cells, ignoring whatever is
	 * painted on the starts themselves — the starts are heads, and a head always
	 * sits on its own wall.
	 *
	 * Returns -1 for anything unreachable.
	 */
	function distancesFrom(grid, sources) {
		const dist = new Int32Array(COLS * ROWS).fill(-1);
		let frontier = [];
		for (const at of sources) {
			if (dist[at] !== -1) continue;
			dist[at] = 0;
			frontier.push(at);
		}
		let d = 0;
		while (frontier.length) {
			d++;
			const next = [];
			for (const at of frontier) {
				const c = at % COLS;
				const r = (at - c) / COLS;
				for (const [dc, dr] of Object.values(STEP)) {
					const nc = c + dc;
					const nr = r + dr;
					if (!inBounds(nc, nr)) continue;
					const ni = idx(nc, nr);
					if (dist[ni] !== -1 || grid[ni]) continue;
					dist[ni] = d;
					next.push(ni);
				}
			}
			frontier = next;
		}
		return dist;
	}

	/**
	 * How much of the board this rider would own from a cell: every square it
	 * reaches before anybody else, minus every square they reach before it.
	 *
	 * This is the difference between a bot that has room and a bot that takes
	 * room. Space alone says "I am not about to die"; territory says "and you
	 * are not getting in here", which is how the game is actually won — you win
	 * by outlasting, and you outlast by owning more floor than the other rider.
	 */
	function territory(grid, myCell, enemyDist) {
		const mine = distancesFrom(grid, [myCell]);
		let score = 0;
		for (let i = 0; i < mine.length; i++) {
			const m = mine[i];
			const e = enemyDist ? enemyDist[i] : -1;
			if (m === -1) continue;
			if (e === -1 || m < e) score++;
			else if (e < m) score--;
		}
		return score;
	}

	/**
	 * The direction a bot wants next.
	 *
	 * Territory first, by a long way. Then — and this is what turns a bot that
	 * merely survives into one that wins — a preference for the *tighter* cell
	 * among options that score the same. Hugging a wall keeps the space you have
	 * not used yet in one piece; cutting across the middle of it saws your own
	 * territory in half, and you lose to whoever did not.
	 *
	 * `others` is every other living rider's head. With none — a solo practice
	 * round, or the last rider standing — this degrades to plain open space,
	 * which is the right answer when there is nobody to take anything from.
	 */
	function botDirection(grid, rider, others = []) {
		const i = ORDER.indexOf(rider.dir);
		const options = [
			{ dir: ORDER[i], bias: 1 }, // straight, barely preferred: it stops the jitter
			{ dir: ORDER[(i + 1) % 4], bias: 0 },
			{ dir: ORDER[(i + 3) % 4], bias: 0 },
		];
		// Computed once, not once per option: it does not depend on where we go.
		const enemyCells = others.filter((o) => o.alive !== false).map((o) => idx(o.c, o.r));
		const enemyDist = enemyCells.length ? distancesFrom(grid, enemyCells) : null;

		let best = null;
		for (const opt of options) {
			const [dc, dr] = STEP[opt.dir];
			const nc = rider.c + dc;
			const nr = rider.r + dr;
			if (!inBounds(nc, nr) || grid[idx(nc, nr)]) continue;
			const room = territory(grid, idx(nc, nr), enemyDist);
			const hug = 3 - openNeighbours(grid, nc, nr);
			// Territory dominates; hugging and the straight bias only separate
			// ties. A little noise on top, so two bots in similar positions do not
			// play out the identical game every round.
			const score = room * 100 + hug * 8 + opt.bias + Math.random() * 3;
			if (!best || score > best.score) best = { dir: opt.dir, score };
		}
		return best?.dir ?? rider.dir; // nothing survives: ride on and die facing forward
	}

	/**
	 * Move every living rider one cell and mark the crashes. Mutates `grid` and
	 * `riders`, and is the only place either changes during a race.
	 *
	 * Two passes, not one, because a head-on is not a collision with a wall:
	 * both riders enter the same empty cell in the same instant. Resolving them
	 * one at a time would paint the first rider's cell, then kill the second for
	 * hitting a wall that did not exist when it set off — the first rider
	 * surviving purely for being earlier in the array.
	 */
	function advance(grid, riders) {
		const targets = new Map();
		const next = riders.map((rider) => {
			if (!rider.alive) return null;
			const [dc, dr] = STEP[rider.dir];
			const c = rider.c + dc;
			const r = rider.r + dr;
			const dead = !inBounds(c, r) || grid[idx(c, r)] !== 0;
			if (!dead) targets.set(idx(c, r), (targets.get(idx(c, r)) ?? 0) + 1);
			return { c, r, dead };
		});

		for (let i = 0; i < riders.length; i++) {
			const rider = riders[i];
			if (!rider.alive) continue;
			const step = next[i];
			if (step.dead || targets.get(idx(step.c, step.r)) > 1) {
				rider.alive = false;
				continue;
			}
			rider.c = step.c;
			rider.r = step.r;
			grid[idx(step.c, step.r)] = i + 1;
		}
	}

	// ------------------------------------------------------------ the round
	//
	// SDK v2 managed state with a fixed tick. The platform calls `tick` HZ
	// times a second on the host, with every seat's latest input (a person's
	// arcade.input, a bot's `bot()`); a step of the race happens whenever
	// `tickMs` of race time has gone by, so the clock can tighten as before.

	const HZ = 20; // game.json "tick"
	const COUNT_MS = 800; // one beat of the 3-2-1-GO countdown
	const KEY_EVERY = 10; // steps between views carrying the whole grid

	/** "0:12", for the end card. */
	const clock = (ms) => {
		const sec = Math.floor(ms / 1000);
		return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
	};
	/**
	 * A solo round's score: the race time ridden, in seconds to the tenth,
	 * rounded down (23.4). Tenths of a second, not steps, because a step gets
	 * shorter as the round goes on (100 ms down to 60), so a count of steps is
	 * not a time — and a time can be checked against the arcade's own clock:
	 * a score can never be more than the seconds since its run began (the
	 * arcade's leaderboard, docs/accounts.md there). Race time only: the
	 * countdown is not riding.
	 */
	const survived = (ms) => Math.floor(ms / 100) / 10;
	const reversal = (a, b) => ORDER.indexOf(a) === (ORDER.indexOf(b) + 2) % 4;
	const gridText = (grid) => Array.from(grid).join("");

	/** The options a round can be played with; anything else is dropped. */
	const cleanOpts = (o) => ({ obstacles: o?.obstacles === true });

	/**
	 * The round as managed rules. Time is the tick's `dt`: no clock is read.
	 *
	 * Its one option, "Obstacles", is asked before the first round only
	 * (Lokesh, 2026-11-23, as Ludo): friends' first round opens on the setup,
	 * the host's to change; PLAY AGAIN goes straight in with it; one person,
	 * alone or with bots, goes straight in with the options last played on
	 * their phone. At the end the host's page offers "Next game: … · CHANGE"
	 * (`nextGame()` / `setNext()`). `isHost(id)`: who may set it up (the page
	 * passes the party's host; tests leave it open). `last()`: the options
	 * kept on the host's phone, or null.
	 */
	function game({ isHost = () => true, last = () => null } = {}) {
		let s = null;
		let grid = new Uint8Array(COLS * ROWS);

		/** Paint the riders and, with the option on, the round's blocks onto a fresh grid. */
		function paint() {
			grid = new Uint8Array(COLS * ROWS);
			if (s.opts.obstacles) for (const i of s.blocks) grid[i] = WALL;
			s.riders.forEach((r, i) => (grid[idx(r.c, r.r)] = i + 1));
		}

		/** A new round on the same seats; wins carry over. The spawns and the blocks come from the round's generator. */
		function newRound(seats) {
			const r = rng(s?.rng ?? 0);
			const order = spawnOrder(seats.length, r);
			const blocks = obstaclesFor(r);
			s = {
				round: (s?.round ?? 0) + 1, // rounds started in this run
				phase: s?.phase ?? "play", // "setup" (the first round among friends) | "play"
				opts: s?.opts ?? cleanOpts(null),
				next: s?.next ?? null, // the options picked at the end, for PLAY AGAIN (setNext)
				rng: r.state(),
				blocks,
				riders: seats.map((p, i) => ({
					id: p.id,
					bot: !!p.bot,
					...SPAWNS[order[i]],
					dir: SPAWNS[order[i]].d,
					alive: true,
					wins: s?.riders?.find((x) => x.id === p.id)?.wins ?? 0,
					pending: null,
					lastN: null,
				})),
				countdown: 4,
				countMs: 0,
				racing: false,
				decided: false,
				winner: null, // null with `decided`: everyone crashed
				tickMs: 100,
				acc: 0,
				step: 0,
				raceMs: 0, // race time ridden, step by step
			};
			for (const r of s.riders) delete r.d;
			paint();
		}

		function endRound(winnerId) {
			s.racing = false;
			s.decided = true;
			s.winner = winnerId;
			const won = s.riders.find((r) => r.id === winnerId);
			if (won) won.wins++;
		}

		function step() {
			for (const rider of s.riders) {
				if (!rider.alive) continue;
				if (rider.pending) rider.dir = rider.pending;
				rider.pending = null;
			}
			advance(grid, s.riders);
			s.step++;
			s.raceMs += s.tickMs;
			// A slow squeeze on the clock, so a cagey endgame between two careful
			// riders still ends.
			if (s.step % 120 === 0 && s.tickMs > 60) s.tickMs -= 10;
			const alive = s.riders.filter((r) => r.alive);
			if (alive.length <= (s.riders.length > 1 ? 1 : 0)) endRound(alive[0]?.id ?? null);
		}

		/** The next tick will move the riders (bots think only then). */
		const stepDue = () => s.racing && s.acc + 1000 / HZ >= s.tickMs;

		return {
			init({ seats, seed, match }) {
				const prev = s;
				const people = seats.filter((p) => !p.bot).length;
				let saved = null;
				try {
					// PLAY AGAIN: the options picked for the next game at the end, else this one's.
					saved = prev ? (prev.next ?? prev.opts) : last();
				} catch {}
				const straight = prev ? (match ?? 0) > 0 : people <= 1;
				s = prev ? { ...prev, phase: straight ? "play" : "setup", opts: cleanOpts(saved), next: null } : { phase: straight ? "play" : "setup", opts: cleanOpts(saved), next: null };
				s.rng = Math.abs(Math.floor(Number(seed) || 0)) ^ 0x11c7c1e5;
				newRound(seats);
			},

			// Steering is input, and the round ends itself. The only moves are
			// the host's, on the setup: the option, and START.
			apply({ action, by }) {
				if (s.phase !== "setup") return "steer with input";
				if (!isHost(by)) return "the host sets up the game";
				const a = action ?? {};
				if (typeof a.obstacles === "boolean") {
					s.opts = cleanOpts({ ...s.opts, obstacles: a.obstacles });
					paint();
					return;
				}
				if (a.start === true) {
					// Two riders at least: the only other rider leaving during the
					// setup must not leave a one-rider round (review, 2026-11-25).
					if (s.riders.length < 2) return "waiting for players";
					s.phase = "play";
					return;
				}
				return "the game has not started";
			},

			tick({ inputs, dt }) {
				if (s.decided || s.phase === "setup") return;
				if (s.countdown > 0) {
					s.countMs += dt * 1000;
					if (s.countMs >= COUNT_MS) {
						s.countMs -= COUNT_MS;
						s.countdown--;
						if (s.countdown <= 0) s.racing = true;
					}
					return;
				}
				// Each input says where its rider wants to face. A person's is
				// numbered, so the same press is not taken twice, and carries the
				// round, so last round's press does not steer this one. The host
				// refuses a reversal: it would drive straight into your own wall,
				// which reads as the game killing you for a mistap.
				for (const rider of s.riders) {
					const want = inputs?.[rider.id];
					if (!rider.alive || !want || !ORDER.includes(want.d)) continue;
					if (!rider.bot) {
						if (want.r !== s.round || want.n === rider.lastN) continue;
						rider.lastN = want.n;
					}
					if (!reversal(want.d, rider.dir)) rider.pending = want.d;
				}
				s.acc += dt * 1000;
				if (s.acc >= s.tickMs) {
					s.acc -= s.tickMs;
					step();
				}
			},

			view: () => ({
				round: s.round,
				phase: s.phase,
				obstacles: s.opts.obstacles,
				step: s.step,
				countdown: s.countdown,
				racing: s.racing,
				decided: s.decided,
				winner: s.winner,
				tickMs: s.tickMs,
				riders: s.riders.map((r) => ({ id: r.id, c: r.c, r: r.r, dir: r.dir, alive: r.alive, wins: r.wins })),
				...(!s.racing || s.step % KEY_EVERY === 0 ? { grid: gridText(grid) } : {}),
			}),

			turn: () => [],

			/** Only on a tick that moves: the search is the expensive part of a tick. */
			bot({ seat }) {
				const rider = s.riders.find((r) => r.id === seat);
				if (!rider?.alive || !stepDue()) return null;
				return { d: botDirection(grid, rider, s.riders.filter((o) => o !== rider && o.alive)) };
			},

			/**
			 * Each round is a result: the last rider moving, then everyone else.
			 * Nobody left standing gets v1's own words on the end card, not the
			 * derived "YOU WIN" (alone) or "DRAW"; a winner's card is derived.
			 * Riding alone, the round also has a score — the time survived
			 * (survived()) — and says so in the card's details; that score is
			 * what a solo round ranks by.
			 */
			result() {
				if (!s.decided) return null;
				const ids = s.riders.map((r) => r.id);
				const rest = ids.filter((id) => id !== s.winner);
				const ranking = s.winner === null ? [ids] : [[s.winner], rest].filter((x) => x.length);
				if (s.winner !== null) return { kind: "ffa", ranking };
				if (ids.length > 1) return { kind: "ffa", ranking, title: "EVERYONE CRASHED" };
				const secs = survived(s.raceMs);
				return {
					kind: "ffa",
					ranking,
					title: `CRASHED AFTER ${clock(s.raceMs)}`,
					scores: { [ids[0]]: secs },
					details: [
						{ label: "Time survived", value: `${secs.toFixed(1)} s` },
						{ label: "Squares ridden", value: s.step },
					],
				};
			},

			/** A rider whose player left the party is out of the round. */
			leave({ seat }) {
				const rider = s.riders.find((r) => r.id === seat);
				// Before the start they simply leave the table.
				if (rider && s.phase === "setup") {
					const round = s.round;
					newRound(s.riders.filter((r) => r !== rider).map((r) => ({ id: r.id, bot: r.bot })));
					s.round = round;
					return true;
				}
				if (!rider?.alive || s.decided) return false;
				rider.alive = false;
				if (s.racing) {
					const alive = s.riders.filter((r) => r.alive);
					if (alive.length <= 1) endRound(alive[0]?.id ?? null);
				}
				return true;
			},

			/** Not a rule: the next game's options, for the host's page to offer at the end ("Next game: … · CHANGE"). */
			nextGame: () => ({ ...(s.next ?? s.opts) }),
			/**
			 * Not a rule: pick the next game's options, once this round is over
			 * (the platform takes no moves after the end, so the host's page
			 * calls this on its own rules, which are the live ones). PLAY AGAIN
			 * starts with them.
			 */
			setNext(o = {}) {
				if (s.phase !== "play" || !s.decided) return "only once the round is over";
				if (typeof o.obstacles !== "boolean") return "no such option";
				s.next = cleanOpts({ ...(s.next ?? s.opts), ...o });
			},

			snapshot: () => ({ ...s, grid: gridText(grid) }),
			/**
			 * The crown moved here. A race runs on the host's clock step by step,
			 * and a half-run one cannot be picked up fairly — this copy is up to
			 * a second old — so an undecided round starts again; everyone's wins
			 * carry over.
			 */
			restore({ snapshot }) {
				const { grid: text, ...rest } = snapshot;
				s = rest;
				grid = Uint8Array.from(text ?? "", Number);
				if (grid.length !== COLS * ROWS) grid = new Uint8Array(COLS * ROWS);
				s.phase ??= "play"; // a copy from before the setup
				s.opts ??= cleanOpts(null);
				s.blocks ??= [];
				s.rng ??= 0;
				// A round under way starts again; a setup stays as it was, the
				// same blocks and spawns the host was showing.
				if (!s.decided && s.phase !== "setup") {
					newRound(s.riders.map((r) => ({ id: r.id, bot: r.bot })));
				}
			},
		};
	}

	globalThis.lightCycleRules = { COLS, ROWS, ORDER, STEP, SPAWNS, WALL, HZ, COUNT_MS, KEY_EVERY, idx, inBounds, openSpace, openNeighbours, distancesFrom, territory, botDirection, advance, survived, rng, spawnOrder, obstaclesFor, game };
})();
