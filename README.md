# BrillianTChess

A chess website with:

- **Practice vs Bot**: play **Rookie** (our own chess engine) or **Stockfish 18** at levels 3–20
- **1v1 a friend** online
- **Boss Raid (co-op)**: two players share one army against a Stockfish "Boss".
  Turns go P1 → Boss → P2 → Boss → P1 …, and **no talking** to your partner
- **Game review** like the big chess sites: Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy,
  Mistake, Miss, Blunder, plus accuracy per player (P1 and P2 scored separately in Boss Raid)
- **Live reviewer**: a background Stockfish checks every move while you play, so the review is instant
- **Coach**: explains *why* each move is good or bad (forks, pins, hanging pieces, mate threats, sacrifices)
  and plays the lines on the board. Includes "What if they take?" and an **Explore** mode for trying your own moves
- Smooth piece animation, 5 board themes, right-click arrows, and chess.com-style premoves

---

## Setup (Windows)

### 1. Install Node.js (one time)
Download the **LTS** version from https://nodejs.org and install it with the default options.
Check that it worked by opening **Command Prompt** (press Start, type `cmd`, Enter) and running:
```bash
node -v
```
It should print a version like `v22.x.x`.

### 2. Download BrillianTChess
**Option A, with Git:**
```bash
cd /d "%USERPROFILE%\Desktop" && git clone https://github.com/Yasukiii1/BrillianTChess.git
```
**Option B, without Git:** on the GitHub page click **Code → Download ZIP**, then right-click the ZIP and choose
**Extract All…** to your Desktop. Rename the extracted folder from `BrillianTChess-main` to `BrillianTChess`.

### 3. Install the packages (one time)
```bash
cd /d "%USERPROFILE%\Desktop\BrillianTChess" && npm install
```

### 4. Run it on port 3000
In **Command Prompt (cmd)**:
```bash
cd /d "%USERPROFILE%\Desktop\BrillianTChess" && set PORT=3000&& npm start
```
When it prints `Chess Co-op running at http://localhost:3000`, open **http://localhost:3000** in your browser.
Keep the window open while you play. Press **Ctrl + C** in it to stop the server.

> Write `3000&&` with no space in between. In cmd, a space there becomes part of the port number.

**PowerShell instead of cmd:**
```bash
cd "$env:USERPROFILE\Desktop\BrillianTChess"; $env:PORT=3000; npm start
```

**No terminal at all:** double-click **`Start Chess Co-op.bat`** in the folder. It installs packages if needed,
starts the server and opens your browser.

### 5. Check the port is running
In a **second** Command Prompt window:
```bash
netstat -ano | findstr :3000
```
A line containing `LISTENING` means the server is up on port 3000. The last number on that line is the process ID (PID).

**"EADDRINUSE: address already in use :::3000"** means something else is already using port 3000. Either:
- close the other server window, or
- end it using the PID from the `netstat` line, replacing 12345 with that number:
  ```bash
  taskkill /PID 12345 /F
  ```
- or run on another port, e.g. `set PORT=8080&& npm start`, then open http://localhost:8080

Use a port from 1024 to 65535. Very low ports like 1 are blocked by browsers as "unsafe ports".

---

## Playing with a friend
- **Same Wi-Fi:** they open `http://YOUR-PC-IP:3000`. Find your IP with `ipconfig` (the "IPv4 Address" line).
  Allow Node.js through the Windows firewall if Windows asks.
- **Anywhere on the internet:** deploy it for free on Render (below) and share that link.
- **Testing Boss Raid alone:** open the room link in two browser tabs. Each tab counts as a different player.

Don't open `index.html` by double-clicking it. The site needs the server: the bots run in Web Workers and
multiplayer goes through the server, and neither works from a `file://` page.

## Put it online (free, Render.com)
1. Sign in at https://render.com with GitHub.
2. Click **New → Blueprint** and pick this repo. It reads `render.yaml` and sets everything up.
3. You get a link like `https://brilliantchess-xxxx.onrender.com`. Every `git push` updates the site.

The free tier sleeps after ~15 minutes without visitors, so the first visit can take ~30 s to wake up.
Rooms live in memory and disappear when the server restarts or sleeps.

## Tests
```bash
npm test
```
- `test/rookie.test.js`: Rookie finds mates, wins free material, and keeps to its time limit
- `test/review.test.js`: the review labels and Coach explanations on real games, with real Stockfish
- `test/coop.test.js`: Boss Raid turn order, illegal moves, reconnecting, rematch

## How it's built
| Part | File |
|---|---|
| Board (drag/click, animation, arrows, premoves, themes) | `public/js/board.js` |
| **Rookie**, our own engine (alpha-beta, quiescence, transposition table) | `public/js/engine/rookie.js` |
| Practice games | `public/js/game-local.js` |
| Online rooms UI | `public/js/game-online.js` |
| Server: rooms, turn rules, referee | `server/rooms.js` |
| The Boss (Stockfish 18 lite, in the server) | `server/boss.js` |
| Review: move labels and accuracy | `public/js/review/classify.js` |
| Review: live background checker | `public/js/review/live.js`, `analyzer.js` |
| Review: the Coach | `public/js/review/coach.js` |

Built with Node.js, Express, Socket.IO, [chess.js](https://github.com/jhlywa/chess.js) (pinned to 1.4.0)
and [Stockfish.js](https://github.com/nmrugg/stockfish.js). Pieces: "cburnett" set by Colin M.L. Burnett.

## License
GPL-3.0 (see `LICENSE`). Stockfish and the cburnett pieces are GPL-licensed, so this project is too.
