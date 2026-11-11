# Chess Co-op

Play chess against a bot, play a friend 1v1, or team up for a **Boss Raid**:
two players share one army against Stockfish, taking turns
(P1 → Boss → P2 → Boss → P1 …) with no talking.

## Run it on your PC
```bash
npm install
npm start
```
Open http://localhost:3000. To try Boss Raid alone, open the room link in two
browser tabs. Each tab counts as a different player.

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
