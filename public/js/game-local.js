// Single-player: you vs Rookie (our bot) or Stockfish, all in the browser.
import { Chess } from '/vendor/chess.js';
import { Board } from './board.js';
import { RookieEngine, StockfishEngine } from './engines.js';
import { $, renderMoves, setStatus, strip, showBanner, button, gameOverReason } from './ui.js';
import { getName } from './identity.js';

export function startLocal({ opp, color }) {
  const chess = new Chess();
  let myColor = color;
  let startFen = chess.fen();
  let gameId = 0;         // bumps on new game / undo so stale bot replies are ignored
  let thinking = false;
  let resigned = false;

  const engine = opp.startsWith('sf-') ? new StockfishEngine(+opp.slice(3), 1000) : new RookieEngine(opp.split('-')[1] || 'medium');
  $('modeLabel').textContent = `Practice vs ${engine.name}`;
  $('fenTools').classList.remove('hidden');

  const board = new Board($('board'), { onMove: onHumanMove });
  board.setOrientation(myColor);

  // ----- controls -----
  const controls = $('controls');
  controls.append(
    button('New game', () => newGame(myColor), 'primary'),
    button('Switch sides', () => newGame(myColor === 'w' ? 'b' : 'w')),
    button('Undo', undo),
    button('Flip', () => { board.flip(); refresh(); }),
    button('Resign', resign),
  );
  $('fenLoad').onclick = () => {
    const fen = $('fenInput').value.trim();
    try { chess.load(fen); } catch (e) { alert('Invalid FEN: ' + e.message); return; }
    startFen = chess.fen(); gameId++; thinking = false; resigned = false;
    refresh();
    maybeBotMove();
  };
  $('fenCopy').onclick = () => navigator.clipboard?.writeText(chess.fen());

  function lastMove() {
    const h = chess.history({ verbose: true });
    return h.length ? { from: h[h.length - 1].from, to: h[h.length - 1].to } : null;
  }

  function refresh() {
    const over = gameOverReason(chess);
    const myTurn = !over && !resigned && chess.turn() === myColor && !thinking;
    board.setPosition(chess.fen(), { lastMove: lastMove(), movableColor: myTurn ? myColor : null });

    const botColor = myColor === 'w' ? 'b' : 'w';
    const top = board.orientation === myColor ? 'bot' : 'me';
    const meInfo = { name: getName() || 'You', tag: myColor === 'w' ? 'White' : 'Black', active: chess.turn() === myColor && !over };
    const botInfo = { name: engine.name, tag: botColor === 'w' ? 'White' : 'Black', active: chess.turn() === botColor && !over };
    strip($('topStrip'), top === 'bot' ? botInfo : meInfo);
    strip($('bottomStrip'), top === 'bot' ? meInfo : botInfo);

    renderMoves(chess.history().map((san) => ({ san })), new Chess(startFen).turn(), new Chess(startFen).moveNumber());

    if (resigned) setStatus('You resigned', 'over');
    else if (over) setStatus(over.reason === 'checkmate' ? (over.winner === myColor ? 'Checkmate, you win!' : 'Checkmate, bot wins') : `Draw (${over.reason})`, 'over');
    else if (thinking) setStatus(`${engine.name} is thinking…`, 'boss');
    else setStatus(chess.inCheck() ? 'Your move (check!)' : 'Your move', 'mine');
  }

  function checkGameOver() {
    const over = gameOverReason(chess);
    if (!over) return false;
    const title = over.reason === 'checkmate' ? (over.winner === myColor ? 'You win!' : 'You lost') : 'Draw';
    showBanner(title, `${over.reason} · ${over.result}`, [
      { label: 'Rematch', primary: true, onClick: () => newGame(myColor) },
      { label: 'Look at board' },
    ]);
    return true;
  }

  function onHumanMove(from, to, promotion) {
    try { chess.move({ from, to, promotion }); } catch { refresh(); return; }
    refresh();
    if (!checkGameOver()) maybeBotMove();
  }

  async function maybeBotMove() {
    if (gameOverReason(chess) || resigned || chess.turn() === myColor) { refresh(); return; }
    const myGame = ++gameId;
    thinking = true;
    refresh();
    const started = Date.now();
    let uci;
    try { uci = await engine.getMove(chess.fen()); }
    catch (e) { console.error(e); thinking = false; setStatus('Bot error: ' + e.message); return; }
    // Small pause so instant bot moves don't feel jarring.
    const wait = 350 - (Date.now() - started);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    if (myGame !== gameId) return; // game changed while bot was thinking
    thinking = false;
    if (uci && uci !== '(none)') {
      chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    }
    refresh();
    checkGameOver();
  }

  function newGame(color) {
    gameId++; thinking = false; resigned = false;
    myColor = color;
    chess.reset();
    startFen = chess.fen();
    board.setOrientation(myColor);
    refresh();
    maybeBotMove();
  }

  function undo() {
    gameId++; thinking = false; resigned = false;
    // Take back moves until it's your turn again (normally 2 half-moves).
    if (chess.history().length === 0) return refresh();
    chess.undo();
    while (chess.turn() !== myColor && chess.history().length) chess.undo();
    refresh();
    maybeBotMove(); // if you're Black and undid everything, the bot moves first again
  }

  function resign() {
    if (gameOverReason(chess) || resigned) return;
    gameId++; thinking = false; resigned = true;
    refresh();
    showBanner('You resigned', 'Better luck next time.', [{ label: 'New game', primary: true, onClick: () => newGame(myColor) }, { label: 'Close' }]);
  }

  newGame(myColor);
}
