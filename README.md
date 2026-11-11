# Chess Co-op

Play chess against a bot, play a friend 1v1, or team up for a **Boss Raid**:
two players share one army against Stockfish, taking turns
(P1 → Boss → P2 → Boss → P1 …) with no talking.

## Run it on your PC
**Easiest:** double-click **Start Chess Co-op.bat**. It installs packages the first time,
starts the server and opens http://localhost:3000 in your browser. Close the black window to stop it.

From a terminal instead:
```bash
npm start
```

**Different port:** edit the `set PORT=3000` line in the .bat file, or in PowerShell run
`$env:PORT=8080; npm start`. Use a port from 1024 to 65535. Very low ports like 1 are
blocked by browsers as "unsafe ports".

**Don't open index.html by double-clicking it.** The pages need the server: the bots run in
Web Workers and multiplayer goes through the server, and neither works from a `file://` page.

**Friends on the same Wi-Fi** can join at `http://YOUR-PC-IP:3000`. Find the IP with `ipconfig`
(the "IPv4 Address" line). Windows may ask you to allow Node.js through the firewall.
Friends elsewhere should use the Render link.

To try Boss Raid alone, open the room link in two browser tabs. Each tab counts as a different player.

## Tests
```bash
npm test
```
- `test/rookie.test.js`: our bot finds mates, wins free material, and keeps to its time limit.
- `test/coop.test.js`: starts a server and checks the Boss Raid turn order, illegal moves, reconnecting and rematch.

## Put it online (free, Render.com)
1. Push this folder to a new GitHub repo.
2. On https://render.com: **New → Blueprint**, then pick the repo (it reads `render.yaml`).
3. You get a link like `https://chess-coop-xxxx.onrender.com`. Send it to your friend.

The free tier sleeps after ~15 minutes without visitors, so the first visit can take ~30 seconds to wake up.
Rooms are kept in memory, so they disappear when the server restarts or sleeps.

## How it's built
| Part | File |
|---|---|
| Board (click and drag, promotion, highlights) | `public/js/board.js` |
| **Rookie**, our own engine (alpha-beta, quiescence, TT) | `public/js/engine/rookie.js` |
| Practice games in the browser | `public/js/game-local.js` |
| Online rooms UI | `public/js/game-online.js` |
| Server: rooms, turn rules, referee | `server/rooms.js` |
| The Boss (Stockfish 18 lite, inside the server) | `server/boss.js` |

Rules come from [chess.js](https://github.com/jhlywa/chess.js) (pinned to 1.4.0 because Rookie uses its internals for speed).
Stockfish.js is GPLv3.
