// liars-dice/liars-dice-rules.js — Liar's Dice's rules and its bot.
//
// No document here and no platform: liars-dice.js (the page) plays them, and
// test-liars-dice.mjs loads this file alone.

(() => {
	const DICE = 5;
	const FACES = 6;

	/**
	 * How many dice in a hand show `face`, counting ones as wild.
	 *
	 * The wild rule is the whole character of the game — it is why "six fives"
	 * is a sane opening bid with thirty dice on the table — and it is also the
	 * easiest thing to get subtly wrong, because a bid *on* ones must not count
	 * them twice. Bidding face 1 is simply not allowed here (`validBid`), which
	 * keeps the rule to one line instead of Perudo's special aces case.
	 */
	function countFace(dice, face) {
		return dice.filter((d) => d === face || d === 1).length;
	}

	/** Total across every hand at the table. */
	function countAll(hands, face) {
		return hands.reduce((n, hand) => n + countFace(hand, face), 0);
	}

	const validBid = (bid) =>
		!!bid && Number.isInteger(bid.count) && Number.isInteger(bid.face)
		&& bid.count >= 1 && bid.face >= 2 && bid.face <= FACES;

	/**
	 * May `next` follow `prev`? Raise the quantity, or hold it and raise the
	 * face. Nothing else.
	 */
	function bidBeats(next, prev) {
		if (!validBid(next)) return false;
		if (!prev) return true;
		if (next.count > prev.count) return true;
		return next.count === prev.count && next.face > prev.face;
	}

	/** Every bid that legally follows `prev`, cheapest first. */
	function raisesAfter(prev, maxCount) {
		const out = [];
		for (let count = prev ? prev.count : 1; count <= maxCount; count++) {
			for (let face = 2; face <= FACES; face++) {
				const bid = { count, face };
				if (bidBeats(bid, prev)) out.push(bid);
			}
		}
		return out;
	}

	/**
	 * Who loses a die. Returns `{ actual, bidderWasRight }`.
	 *
	 * "At least" is the rule, not "exactly": a bid of four fours stands if there
	 * are five. Getting that backwards makes every close call come out wrong and
	 * still looks like a working game.
	 */
	function resolveCall(hands, bid) {
		const actual = countAll(hands, bid.face);
		return { actual, bidderWasRight: actual >= bid.count };
	}

	const rollDice = (n, rng = Math.random) =>
		Array.from({ length: n }, () => 1 + Math.floor(rng() * FACES));

	// ---------------------------------------------------------------- the bot
	//
	// One number does most of the work: an unknown die shows any given face, or
	// is a wild one, with probability 2/6. So the bot expects its own count plus
	// a third of everything it cannot see, and it bluffs by leaning on that
	// estimate rather than by pretending to have dice it has not got.

	const P_MATCH = 2 / FACES;

	/** What the bot expects the table to hold for a face. */
	const expectedCount = (myDice, unknownDice, face) =>
		countFace(myDice, face) + unknownDice * P_MATCH;

	/**
	 * Each bot's own bluffing dial for a game (Lokesh, 2026-11-24): drawn
	 * between 0.9 and 1.4 (the old fixed 1.1 sits inside), so at one table a
	 * bot calls early and another lets a bid ride. Two decimals, so it reads
	 * plainly in a log.
	 */
	const SLACK = [0.9, 1.4];
	const botSlack = (rng = Math.random) => Math.min(SLACK[1], Math.round((SLACK[0] + rng() * (SLACK[1] - SLACK[0])) * 100) / 100);

	/**
	 * Raise, or call the last bid a lie.
	 *
	 * `slack` is the bluffing dial: how far past its own estimate the bot will
	 * let a bid stand before calling. Too tight and it calls every round and
	 * bleeds dice; too loose and it never calls and can be bid off the table.
	 */
	function botAction(myDice, bid, unknownDice, rng = Math.random, slack = 1.1) {
		const totalDice = myDice.length + unknownDice;

		if (bid) {
			const expected = expectedCount(myDice, unknownDice, bid.face);
			// A bid nobody could satisfy is an easy call and must always be taken.
			if (bid.count > totalDice) return { type: "liar" };
			if (bid.count > expected + slack) return { type: "liar" };
		}

		// Bid at roughly what we believe the table holds, not at the smallest
		// legal raise.
		//
		// The cheapest-raise version was the first thing written and it looks
		// sensible — never overcommit — but it makes the game unplayable: with
		// twenty dice on the table the ladder climbs one face at a time from
		// "one two", nobody ever reaches a bid worth calling, and a round runs
		// dozens of turns. Bidding near the estimate gets the table to a
		// contestable number in two or three turns, which is where the bluffing
		// actually lives.
		const options = raisesAfter(bid, totalDice);
		let best = null;
		for (const option of options) {
			const expected = expectedCount(myDice, unknownDice, option.face);
			if (option.count > expected + 0.5) continue;
			// Aim at the expectation; a little under most of the time, a little
			// over now and then, which is what a bluff looks like from outside.
			const target = Math.max(1, Math.round(expected - 0.3 + (rng() < 0.25 ? 1 : 0)));
			const score = -Math.abs(option.count - target) * 10
				+ countFace(myDice, option.face) * 2
				+ rng() * 0.5;
			if (!best || score > best.score) best = { option, score };
		}
		if (best) return { type: "bid", ...best.option };
		// Nothing we believe in. Call if there is something to call, otherwise
		// make the smallest legal bid and hope.
		if (bid) return { type: "liar" };
		return { type: "bid", ...(options[0] ?? { count: 1, face: 2 }) };
	}

	/**
	 * Who opens a new game's first round: the seat after the one that opened
	 * the last game, or a random seat for the party's first (the arcade's
	 * rule for every turn-based game, docs/sdk-v2.md "Who starts" — which a
	 * protocol game follows itself). `prev` is { id, at }, the last opener and
	 * its place among that game's seats, or null; `ids` the seats now. A last
	 * opener who has left is followed by whoever took their place.
	 */
	function nextOpener(prev, ids, rng = Math.random) {
		if (!ids.length) return null;
		const i = prev ? ids.indexOf(prev.id) : -1;
		const at = !prev ? Math.floor(rng() * ids.length) : i >= 0 ? (i + 1) % ids.length : (Number.isInteger(prev.at) ? prev.at : 0) % ids.length;
		return { id: ids[at], at };
	}

	/**
	 * What the arcade's achievements read (game.json): each player's dice
	 * left, the fewest they held this game, and `finished` — won on a call,
	 * not because the others left.
	 */
	const seatFactsOf = (seats, lowest, finished) =>
		Object.fromEntries(seats.map((s) => [s.id, { dice: s.dice, lowest: lowest[s.id] ?? s.dice, finished: !!finished && s.dice > 0 && !s.out }]));

	globalThis.liarsDiceRules = {
		DICE, FACES, countFace, countAll, validBid, bidBeats, raisesAfter,
		resolveCall, rollDice, expectedCount, SLACK, botSlack, botAction, nextOpener, seatFactsOf,
	};
})();
