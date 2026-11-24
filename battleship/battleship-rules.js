// battleship/battleship-rules.js — Battleship's rules, the audit and the bot.
//
// No document here and no platform: battleship.js (the page) plays them, and
// test-battleship.mjs loads this file alone to play whole games in Node.

(() => {
	const SIZE = 8;

	// Four ships, eighteen percent of the water — the same density as the
	// classic ten-by-ten, on a board that fits a phone twice over (you need to
	// see your own waters and theirs at the same time).
	const FLEET = [
		{ id: "carrier", name: "CARRIER", len: 4 },
		{ id: "cruiser", name: "CRUISER", len: 3 },
		{ id: "sub", name: "SUB", len: 3 },
		{ id: "patrol", name: "PATROL", len: 2 },
	];
	const FLEET_CELLS = FLEET.reduce((n, s) => n + s.len, 0);

	const inBounds = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
	const key = (r, c) => `${r},${c}`;

	/** The squares a placed ship occupies. */
	function cellsOf(ship) {
		const spec = FLEET.find((s) => s.id === ship.id);
		if (!spec) return [];
		const out = [];
		for (let i = 0; i < spec.len; i++) {
			out.push(ship.dir === "h" ? [ship.r, ship.c + i] : [ship.r + i, ship.c]);
		}
		return out;
	}

	/**
	 * Is this a legal fleet? Returns null when it is, or a sentence saying what
	 * is wrong — the placement UI shows that rather than silently refusing.
	 *
	 * Run on **both** sides. The placing player runs it to be told off; everyone
	 * else runs it at the reveal, because "the fleet you committed to was not a
	 * legal fleet" is its own kind of cheating and the digest alone would not
	 * catch it.
	 */
	function validateFleet(ships) {
		if (!Array.isArray(ships) || ships.length !== FLEET.length) {
			return `A fleet is ${FLEET.length} ships.`;
		}
		const ids = new Set(ships.map((s) => s.id));
		if (ids.size !== FLEET.length || FLEET.some((s) => !ids.has(s.id))) {
			return "That is not the right set of ships.";
		}
		const taken = new Set();
		for (const ship of ships) {
			if (ship.dir !== "h" && ship.dir !== "v") return "A ship lies across or down.";
			const cells = cellsOf(ship);
			for (const [r, c] of cells) {
				if (!inBounds(r, c)) return "A ship hangs off the edge.";
				if (taken.has(key(r, c))) return "Two ships overlap.";
				taken.add(key(r, c));
			}
		}
		return null;
	}

	/** A legal fleet, placed at random. Used by the bot and by RANDOMISE. */
	function randomFleet(rng = Math.random) {
		for (let attempt = 0; attempt < 500; attempt++) {
			const ships = [];
			const taken = new Set();
			let ok = true;
			for (const spec of FLEET) {
				let placed = null;
				for (let tries = 0; tries < 200 && !placed; tries++) {
					const dir = rng() < 0.5 ? "h" : "v";
					const r = Math.floor(rng() * (dir === "v" ? SIZE - spec.len + 1 : SIZE));
					const c = Math.floor(rng() * (dir === "h" ? SIZE - spec.len + 1 : SIZE));
					const candidate = { id: spec.id, r, c, dir };
					const cells = cellsOf(candidate);
					if (cells.some(([cr, cc]) => taken.has(key(cr, cc)))) continue;
					placed = candidate;
					for (const [cr, cc] of cells) taken.add(key(cr, cc));
				}
				if (!placed) {
					ok = false;
					break;
				}
				ships.push(placed);
			}
			if (ok && !validateFleet(ships)) return ships;
		}
		throw new Error("randomFleet: could not place a fleet");
	}

	/** Which ship, if any, sits on a square. */
	function shipAt(ships, r, c) {
		return ships.find((ship) => cellsOf(ship).some(([sr, sc]) => sr === r && sc === c)) ?? null;
	}

	/**
	 * The honest answer to one shot, given a fleet and every square already hit.
	 * `hits` is a Set of "r,c" and is *not* mutated — the caller decides whether
	 * the shot counts.
	 */
	function answerShot(ships, hits, r, c) {
		const ship = shipAt(ships, r, c);
		if (!ship) return { hit: false, sunk: null };
		const after = new Set(hits);
		after.add(key(r, c));
		const sunk = cellsOf(ship).every(([sr, sc]) => after.has(key(sr, sc)));
		return { hit: true, sunk: sunk ? ship.id : null };
	}

	const fleetSunk = (hits) => hits.size >= FLEET_CELLS;

	/**
	 * Re-run every answer a player gave against the fleet they finally revealed.
	 *
	 * This is what the commitment is *for*. A digest only proves the fleet was
	 * decided before the shooting started; it says nothing about whether the
	 * answers matched it. Both checks together are what make an unrefereed game
	 * honest, and either alone is theatre.
	 *
	 * Returns null when the player played straight, or the first inconsistency.
	 */
	function auditAnswers(ships, answers) {
		const bad = validateFleet(ships);
		if (bad) return `the revealed fleet is not legal: ${bad}`;
		const hits = new Set();
		for (const a of answers) {
			const [r, c] = a.at;
			if (!inBounds(r, c)) return `a shot at ${r},${c} is off the board`;
			const truth = answerShot(ships, hits, r, c);
			if (truth.hit !== !!a.hit) {
				return `${r},${c} was answered ${a.hit ? "hit" : "miss"} but the fleet says ${truth.hit ? "hit" : "miss"}`;
			}
			if ((truth.sunk ?? null) !== (a.sunk ?? null)) {
				return `${r},${c} was answered ${a.sunk ? `sinking ${a.sunk}` : "no sinking"} but the fleet disagrees`;
			}
			if (truth.hit) hits.add(key(r, c));
		}
		return null;
	}

	// ---------------------------------------------------------------- the bot
	//
	// Hunt and target, which is the standard and is genuinely most of what a
	// good human player does. Two states, no search:
	//
	//   target  a ship has been hit and not yet sunk — work outwards from the
	//           hits, and once two hits line up, only along that line
	//   hunt    nothing outstanding — shoot a parity lattice, because the
	//           smallest ship is two long and cannot hide between the squares

	function botTarget(shots, rng = Math.random) {
		const fired = new Set(shots.map((s) => key(s.at[0], s.at[1])));
		const free = (r, c) => inBounds(r, c) && !fired.has(key(r, c));

		// Hits that belong to a ship nobody has sunk yet.
		const sunkIds = new Set(shots.filter((s) => s.sunk).map((s) => s.sunk));
		const liveHits = [];
		{
			// A sinking answer accounts for that ship's hits, so walk the shots in
			// order and drop the ones a later sinking explained.
			const hitsInOrder = shots.filter((s) => s.hit);
			let accountedFor = 0;
			for (const s of shots) {
				if (s.sunk) accountedFor += FLEET.find((f) => f.id === s.sunk)?.len ?? 0;
			}
			// Everything hit beyond what the sunk ships account for is still live.
			const outstanding = hitsInOrder.length - accountedFor;
			if (outstanding > 0) {
				// Which hits are live cannot be known exactly without the fleet, so
				// take the most recent ones — they are the ones being worked on.
				liveHits.push(...hitsInOrder.slice(-outstanding).map((s) => s.at));
			}
		}

		if (liveHits.length >= 2) {
			// Two or more hits: if they share a row or a column, extend that line
			// and nothing else. This is the difference between sinking a cruiser in
			// three more shots and in nine.
			const rows = new Set(liveHits.map(([r]) => r));
			const cols = new Set(liveHits.map(([, c]) => c));
			if (rows.size === 1) {
				const r = liveHits[0][0];
				const cs = liveHits.map(([, c]) => c).sort((a, b) => a - b);
				const ends = [[r, cs[0] - 1], [r, cs[cs.length - 1] + 1]].filter(([rr, cc]) => free(rr, cc));
				if (ends.length) return ends[Math.floor(rng() * ends.length)];
			} else if (cols.size === 1) {
				const c = liveHits[0][1];
				const rs = liveHits.map(([r]) => r).sort((a, b) => a - b);
				const ends = [[rs[0] - 1, c], [rs[rs.length - 1] + 1, c]].filter(([rr, cc]) => free(rr, cc));
				if (ends.length) return ends[Math.floor(rng() * ends.length)];
			}
		}

		if (liveHits.length) {
			const around = [];
			for (const [r, c] of liveHits) {
				for (const [dr, dc] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
					if (free(r + dr, c + dc)) around.push([r + dr, c + dc]);
				}
			}
			if (around.length) return around[Math.floor(rng() * around.length)];
		}

		// Hunt. The parity lattice halves the squares worth trying: a two-long
		// ship must cover one of them wherever it lies.
		const lattice = [];
		const rest = [];
		for (let r = 0; r < SIZE; r++) {
			for (let c = 0; c < SIZE; c++) {
				if (!free(r, c)) continue;
				((r + c) % 2 === 0 ? lattice : rest).push([r, c]);
			}
		}
		const pool = lattice.length ? lattice : rest;
		if (!pool.length) return null;
		return pool[Math.floor(rng() * pool.length)];
	}

	/**
	 * What the arcade's achievements read (game.json; the arcade's
	 * docs/platform.md), from the shots everyone saw (`boards`: id → shots at
	 * them): each player's ships lost, the ships of theirs they sank, shots,
	 * hits, accuracy, and `complete` — the whole other fleet sunk, not a win
	 * because the other player left.
	 */
	function seatFactsOf(boards, seats) {
		const at = (id) => boards[id] ?? [];
		const out = {};
		for (const id of seats.filter(Boolean)) {
			const other = seats.find((s) => s && s !== id);
			const mine = other ? at(other) : [];
			const hits = mine.filter((s) => s.hit).length;
			const sunk = new Set(mine.filter((s) => s.sunk).map((s) => s.sunk)).size;
			out[id] = { lost: new Set(at(id).filter((s) => s.sunk).map((s) => s.sunk)).size, sunk, complete: sunk === FLEET.length, shots: mine.length, hits, accuracy: mine.length ? Math.round((100 * hits) / mine.length) : 0 };
		}
		return out;
	}

	globalThis.battleshipRules = {
		SIZE, FLEET, FLEET_CELLS, inBounds, key, cellsOf, validateFleet,
		randomFleet, shipAt, answerShot, fleetSunk, auditAnswers, botTarget, seatFactsOf,
	};
})();
