# arcade-games

Five games for [the arcade](https://www.lokeshmohanty.in/games/) — and the
worked example of a games repository the arcade lists. Nothing here is
special: it is registered exactly as anyone's repository would be
(`registry/lokeshmohanty/arcade-games.json` in
[lokeshmohanty/games](https://github.com/lokeshmohanty/games)).

| Game | Folder | Shows how to… |
|---|---|---|
| Battleship | [`battleship/`](battleship) | hide state from the host with commit-reveal (`NeonArcade.makeSecrets`) |
| Draw & Guess | [`draw-guess/`](draw-guess) | run timed rounds on the shared clock (`NeonArcade.makeRounds`); a game with no bots |
| Liar's Dice | [`liars-dice/`](liars-dice) | deal private dice, reveal on a challenge |
| Light Cycles | [`light-cycles/`](light-cycles) | a real-time game at a fixed tick, with bots steering |
| Tug of War | [`tug-of-war/`](tug-of-war) | teams of any size, a host-simulated physics loop, pausing when the host leaves the app |

Each folder is one game:

```
game.json      the manifest (id, name, kind, seats, licence…)
index.html     the entry page — only the game's own script
<game>.js      NeonArcade.registerGame({ … mount(ctx) { … } })
preview.gif    the portal card
test-<game>.mjs  rules tests (not served)
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

The rules tests load the arcade's runtime from a checkout of
`lokeshmohanty/games` next to this one (or `NEON_PLATFORM=/path/to/games`):

```sh
for t in */test-*.mjs; do node "$t" || exit 1; done
```

and the arcade's own check, with a browser, from that checkout:

```sh
just validate-game ../arcade-games/battleship  # or every folder at once
```

## Shipping a change

Commit and push here, then open a pull request on `lokeshmohanty/games`
bumping `"commit"` in `registry/lokeshmohanty/arcade-games.json` to the new
sha. The workflow is the same for anyone: see
[CONTRIBUTING.md](https://github.com/lokeshmohanty/games/blob/main/CONTRIBUTING.md).

MIT licensed.
