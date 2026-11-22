// draw-guess/draw-guess-rules.js — Draw & Guess's rules: rounds, words, scoring.
//
// No document here and no platform: draw-guess.js (the page) hands `game()` to
// the platform as SDK v2 managed rules. The platform runs them on the host and
// sends each phone its view — the drawer's carries the word, everyone else's
// only the blanks. The strokes themselves are not state: the drawer streams
// them straight to everyone on a channel (draw-guess.js), as before.
//
// The round clock is the rules' own: every phase has a deadline on the host's
// clock, each view says how long is left (a duration — two phones' clocks
// disagree), and the host's page asks for `{ clock }` when a deadline passes.
// A clock move that is early, or for a phase that has already gone, is refused,
// so nothing but the deadline can end a phase — apart from everybody guessing
// the word, which ends the drawing at once.

(() => {
	const WORDS = [
		"cat", "dog", "house", "tree", "sun", "moon", "star", "fish", "bird", "boat", "car", "bike", "flower", "cloud",
		"mountain", "river", "pizza", "cake", "apple", "banana", "hat", "shoe", "book", "phone", "key", "door", "chair",
		"table", "lamp", "guitar", "drum", "robot", "rocket", "ghost", "skull", "heart", "eye", "hand", "umbrella",
		"clock", "bridge", "castle",
	];
	const PHASES = { choosing: 2000, drawing: 60_000, reveal: 5000 }; // ms
	const ROUNDS_PER_PLAYER = 2; // each player draws this many times
	const SCORE_BASE = 100;
	const SCORE_TIME_BONUS = 2; // a point per second left, twice
	const DRAWER_BONUS = 50;
	const CHAT_KEPT = 40; // lines of chat in a view (a phone that comes back gets these)

	/** The managed rules. `now()` is the host's clock; tests pass their own. */
	function game({ now = () => Date.now(), random = Math.random } = {}) {
		let s = null;
		const key = () => `${s.match}:${s.round}:${s.phase}`;
		const secondsLeft = () => Math.max(0, Math.ceil((s.deadline - now()) / 1000));

		function say(line) {
			s.chat.push({ n: ++s.chatN, ...line });
			if (s.chat.length > CHAT_KEPT) s.chat.splice(0, s.chat.length - CHAT_KEPT);
		}

		function enter(phase) {
			s.phase = phase;
			s.deadline = now() + (PHASES[phase] ?? 0);
			if (phase === "choosing") {
				s.guessed = [];
				s.word = WORDS[Math.floor(random() * WORDS.length)];
				s.drawer = s.players.length ? s.players[s.round % s.players.length] : null;
			}
		}

		/** The phase is over: on to the next, or the next round, or the end. */
		function advance() {
			if (s.phase === "choosing") return enter("drawing");
			if (s.phase === "drawing") return enter("reveal");
			if (s.phase === "reveal") {
				if (s.round + 1 < s.totalRounds) {
					s.round++;
					return enter("choosing");
				}
				s.phase = "gameover";
				s.deadline = 0;
			}
		}

		const guessers = () => s.players.filter((id) => id !== s.drawer);

		return {
			init({ seats, first }) {
				// The platform's `first` draws first, the rotation going on from
				// them: it is the next seat on each rematch (docs/sdk-v2.md "Who
				// starts"), so the same player does not always open. With none (an
				// older shell), the rotation starts at the top.
				const sorted = seats.map((p) => p.id).sort();
				const k = Math.max(0, sorted.indexOf(first));
				const players = [...sorted.slice(k), ...sorted.slice(0, k)];
				s = {
					match: (s?.match ?? 0) + 1, // games in this run
					players, // the drawing rotation
					totalRounds: players.length * ROUNDS_PER_PLAYER,
					round: 0,
					phase: "choosing",
					deadline: 0,
					drawer: null,
					word: "",
					guessed: [],
					scores: {},
					chat: [],
					chatN: s?.chatN ?? 0,
				};
				enter("choosing");
			},

			apply({ action, by }) {
				const a = action ?? {};
				if ("clock" in a) {
					if (a.clock !== key()) return "stale";
					if (s.phase === "gameover") return "over";
					if (now() < s.deadline - 50) return "not yet";
					advance();
					return;
				}
				if (typeof a.guess === "string") {
					if (s.phase !== "drawing") return "not now";
					if (by === s.drawer) return "you are drawing";
					if (s.guessed.includes(by)) return "you have it";
					const text = a.guess.trim().slice(0, 60);
					if (!text) return "say something";
					if (text.toLowerCase() === s.word.toLowerCase()) {
						s.guessed.push(by);
						// Off the clock at the moment the guess arrived.
						s.scores[by] = (s.scores[by] || 0) + SCORE_BASE + secondsLeft() * SCORE_TIME_BONUS;
						s.scores[s.drawer] = (s.scores[s.drawer] || 0) + DRAWER_BONUS;
						say({ id: by, kind: "correct" });
						// Everybody got it, so the drawing is over now rather than
						// when its clock runs out.
						if (guessers().every((id) => s.guessed.includes(id))) advance();
					} else {
						say({ id: by, text, kind: "chat" });
					}
					return;
				}
				return "unknown move";
			},

			view({ seat }) {
				const open = s.phase === "reveal" || s.phase === "gameover";
				return {
					match: s.match,
					phase: s.phase,
					round: s.round,
					totalRounds: s.totalRounds,
					clock: key(),
					msLeft: Math.max(0, s.deadline - now()),
					drawer: s.drawer,
					hint: s.phase === "drawing" ? "_".repeat(s.word.length) : "",
					// The word goes to one person until the reveal. The host knows it:
					// it picked it, as it always did.
					word: open || (seat && seat === s.drawer) ? s.word : null,
					guessed: [...s.guessed],
					scores: { ...s.scores },
					chat: s.chat.map((l) => ({ ...l })),
					players: [...s.players],
				};
			},

			turn: () => [],
			bot: () => null,

			/** Places by points; everyone who played is in it, at 0 if they never scored. */
			result() {
				if (s.phase !== "gameover") return null;
				const ids = [...new Set([...s.players, ...Object.keys(s.scores)])];
				const pts = (id) => s.scores[id] ?? 0;
				const levels = [...new Set(ids.map(pts))].sort((a, b) => b - a);
				return { kind: "ffa", ranking: levels.map((p) => ids.filter((id) => pts(id) === p)), scores: Object.fromEntries(ids.map((id) => [id, pts(id)])) };
			},

			/** A player left the party: out of the rotation; a drawer gone ends the drawing. */
			leave({ seat }) {
				if (!s.players.includes(seat) || s.phase === "gameover") return false;
				s.players = s.players.filter((id) => id !== seat);
				if (seat === s.drawer && s.phase === "drawing") advance();
				return true;
			},

			/** Not a rule: the word, for the host's own page (its tests). */
			hostWord: () => s?.word ?? null,

			// Clocks differ between phones: the heir gets the time left.
			snapshot: () => ({ ...s, deadline: 0, msLeft: Math.max(0, s.deadline - now()) }),
			restore({ snapshot }) {
				const { msLeft, ...rest } = snapshot;
				s = { ...rest, deadline: now() + (msLeft ?? 0) };
			},
		};
	}

	globalThis.drawGuessRules = { WORDS, PHASES, ROUNDS_PER_PLAYER, SCORE_BASE, SCORE_TIME_BONUS, DRAWER_BONUS, game };
})();
