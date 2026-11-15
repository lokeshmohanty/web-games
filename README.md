# web-games

Six games for [the arcade](https://www.lokeshmohanty.in/games/) — and the
worked example of a games repository the arcade lists. Nothing here is
special: it is registered exactly as anyone's repository would be
(`registry/lokeshmohanty/web-games.json` in
[lokeshmohanty/games](https://github.com/lokeshmohanty/games)).

| Game | Folder | SDK | Shows how to… |
|---|---|---|---|
| Battleship | [`battleship/`](battleship) | v2, protocol | hide state from the host with commit-reveal (the shell's `commit` / `verify`) and run simultaneous turns on the shell's clock (`timer.*`) |
| Draw & Guess | [`draw-guess/`](draw-guess) | v2, managed | managed state with a stream beside it: the rules on the host, the strokes on a channel; a game with no bots |
| Liar's Dice | [`liars-dice/`](liars-dice) | v2, protocol | roll private dice, commit before the bidding, reveal on a challenge; the shell's turn-wait banner (`wait.turn`) |
| Light Cycles | [`light-cycles/`](light-cycles) | v2, managed, ticking | a real-time game at a fixed tick (`"tick"`), with bots steering through `bot()` |
| Tug of War | [`tug-of-war/`](tug-of-war) | v1 (retired) | teams of any size, a host-simulated physics loop, pausing when the host leaves the app |
| Sudoku | [`sudoku/`](sudoku) | v2, managed | play alone with `seats.min: 1`, or race: the host deals one puzzle, phones report only progress; a seeded daily puzzle |

The arcade's SDK v2 is documented in
[docs/sdk-v2.md](https://github.com/lokeshmohanty/games/blob/main/docs/sdk-v2.md):
**managed** games write rules (`init / apply / view / turn / bot / result /
snapshot / restore`, and `tick` for real time) and the platform runs them on
the host; games whose secrets the host must not see stay on the **protocol**
(Layer 1) and use the shell's services.

Each folder is one game:

```
game.json          the manifest (id, name, kind, seats, licence, "sdk": 2…)
index.html         the entry page — only the game's own scripts
<game>-rules.js    the rules (and the bot): no document, no platform
<game>.js          the page: arcade.managed(rules) and a view, or the protocol
preview.gif        the portal card
test-<game>.mjs    rules tests (not served)
```

## Play one from your machine

```sh
curl -fsSLO https://www.lokeshmohanty.in/games/sdk/v1/dev-server.mjs
node dev-server.mjs
```

and open the link it prints for a game: the live arcade loads it from this
folder. Edit, reload. **PLAY A BOT** to play alone; **INVITE A FRIEND** and
open the invite in a second tab to play yourself.

## Test

The rules tests need nothing but Node — each loads its game's `-rules.js`:

```sh
for t in */test-*.mjs; do node "$t" || exit 1; done
```

(Battleship's also checks its commitment against the platform's
`lib/secrets.js` when a checkout of `lokeshmohanty/games` sits next to this
one, or at `NEON_PLATFORM`.) And the arcade's own check, with a browser, from
that checkout:

```sh
just validate-game ../web-games/battleship  # or every folder at once
```

## Shipping a change

Commit and push here, then open a pull request on `lokeshmohanty/games`
bumping `"commit"` in `registry/lokeshmohanty/web-games.json` to the new
sha. The workflow is the same for anyone: see
[CONTRIBUTING.md](https://github.com/lokeshmohanty/games/blob/main/CONTRIBUTING.md).

MIT licensed.
