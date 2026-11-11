// Game review logic: turns Stockfish evaluations into move labels
// (Brilliant, Great, Best, Excellent, Good, Book, Inaccuracy, Mistake, Miss, Blunder, Forced)
// and an accuracy score per player. Pure functions: works in the browser and in Node.
//
// How a move is judged
//   Stockfish evaluates the position BEFORE the move (top 2 lines) and AFTER it.
//   Evaluations are turned into "win chance" for the player who moved (0-100%),
//   so losing 1 pawn in an equal position counts more than in a totally won one.
//   loss = win% before (with the best move) - win% after (the move played).
//
//   Best        the engine's top move
//   Excellent   loss < 2%      Good       < 5%
//   Inaccuracy  < 10%          Mistake    < 20%        Blunder >= 20%
//   Miss        your opponent just erred and you didn't punish it (loss >= 5%)
//   Great       the best move, and the 2nd-best move is much worse (only move)
//   Brilliant   a good piece sacrifice: best/near-best move that leaves a piece
//               where it can be taken for less, and you're still OK afterwards
//   Book        known opening theory      Forced  the only legal move

import { bookInfo } from './openings.js';

export const LABELS = {
  brilliant:  { name: 'Brilliant',  icon: '!!', color: '#1baca6' },
  great:      { name: 'Great',      icon: '!',  color: '#5c8bb0' },
  best:       { name: 'Best',       icon: '★',  color: '#81b64c' },
  excellent:  { name: 'Excellent',  icon: '👍︎', color: '#96bc4b' },
  good:       { name: 'Good',       icon: '✓',  color: '#95b776' },
  book:       { name: 'Book',       icon: '📖︎', color: '#a88865' },
  forced:     { name: 'Forced',     icon: '→',  color: '#97a3a7' },
  inaccuracy: { name: 'Inaccuracy', icon: '?!', color: '#f7c631' },
  mistake:    { name: 'Mistake',    icon: '?',  color: '#ffa459' },
  miss:       { name: 'Miss',       icon: '✕',  color: '#ff7769' },
  blunder:    { name: 'Blunder',    icon: '??', color: '#fa412d' },
};
export const LABEL_ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'forced', 'inaccuracy', 'mistake', 'miss', 'blunder'];

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Win chance (0-100) for the side whose point of view the score is from. */
export function winPct(score) {
  if (score.mate !== undefined && score.mate !== null) return score.mate > 0 ? 100 : 0;
  const cp = Math.max(-2000, Math.min(2000, score.cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
const neg = (s) => (s.mate !== undefined && s.mate !== null ? { mate: -s.mate } : { cp: -s.cp });

/** Parse a UCI "info" line. Returns null if it has no score/pv. */
export function parseInfo(line) {
  if (!line.startsWith('info') || !line.includes(' pv ')) return null;
  const t = line.split(' ');
  const get = (k) => { const i = t.indexOf(k); return i >= 0 ? t[i + 1] : undefined; };
  const si = t.indexOf('score');
  if (si < 0 || t.includes('lowerbound') || t.includes('upperbound')) return null;
  const score = t[si + 1] === 'mate' ? { mate: +t[si + 2] } : { cp: +t[si + 2] };
  return { depth: +get('depth'), multipv: +(get('multipv') || 1), score, pv: t.slice(t.indexOf('pv') + 1) };
}

/**
 * Replays the game and collects facts that don't need an engine.
 * Chess: the chess.js class (passed in so this file runs in browser and Node).
 */
export function buildGame(Chess, startFen, sans) {
  const chess = new Chess(startFen);
  const plies = [];
  const fromStart = chess.fen() === new Chess().fen();
  const { bookPlies, name } = fromStart ? bookInfo(sans) : { bookPlies: 0, name: null };
  for (let i = 0; i < sans.length; i++) {
    const fenBefore = chess.fen();
    const legalCount = chess.moves().length;
    const mv = chess.move(sans[i]);
    plies.push({
      ply: i, san: mv.san, uci: mv.from + mv.to + (mv.promotion || ''), color: mv.color,
      from: mv.from, to: mv.to, fenBefore, fenAfter: chess.fen(),
      forced: legalCount === 1, book: i < bookPlies,
      sacrifice: isSacrifice(chess, mv),
      mateAfter: chess.isCheckmate(), drawAfter: chess.isDraw() || chess.isStalemate(),
    });
  }
  return { startFen: new Chess(startFen).fen(), plies, opening: name, finalFen: chess.fen() };
}

// Did this move leave the moved piece where the opponent can win material by taking it?
function isSacrifice(after, mv) {
  const val = VALUE[mv.piece];
  if (val < 3) return false;                       // pawns and king don't count
  const capVal = mv.captured ? VALUE[mv.captured] : 0;
  const them = mv.color === 'w' ? 'b' : 'w';
  const attackers = after.attackers(mv.to, them);
  if (!attackers.length) return false;
  const minAtt = Math.min(...attackers.map((sq) => VALUE[after.get(sq).type] || 99));
  const defended = after.attackers(mv.to, mv.color).length > 0;
  const loss = defended ? val - minAtt - capVal : val - capVal;
  return loss >= 2;
}

/**
 * analyses[i] = engine result for the position before ply i (i = 0..plies.length),
 *   shape: { lines: [{ score, pv }] }  scores from the side-to-move point of view.
 *   For finished positions (mate/stalemate) pass { terminal: 'mate' | 'draw' }.
 * Returns the plies with labels, per-player accuracy and an eval curve.
 */
export function classify(game, analyses, labelOf = (p) => (p.color === 'w' ? 'White' : 'Black')) {
  const out = [];
  const evalCurve = []; // white win% after each position (index 0 = start)
  const whiteWin = (i) => {
    const a = analyses[i];
    const turn = i === 0 ? game.startFen.split(' ')[1] : (game.plies[i - 1].color === 'w' ? 'b' : 'w');
    if (!a) return null;
    if (a.terminal === 'draw') return 50;
    if (a.terminal === 'mate') return turn === 'w' ? 0 : 100; // side to move is mated
    const w = winPct(a.lines[0].score);
    return turn === 'w' ? w : 100 - w;
  };
  for (let i = 0; i <= game.plies.length; i++) evalCurve.push(whiteWin(i));

  let prevLoss = 0;
  for (const p of game.plies) {
    const before = analyses[p.ply], after = analyses[p.ply + 1];
    if (!before || !after || before.terminal) { out.push({ ...p, label: null }); continue; }
    const best = before.lines[0];
    const second = before.lines[1];
    const winBefore = winPct(best.score);
    // Score of the move actually played. Prefer the SAME search as the best move
    // (MultiPV line), so both are judged at the same depth; otherwise use the
    // evaluation of the position after the move.
    const playedLine = before.lines.find((l) => l.pv[0] === p.uci);
    let afterScore;
    if (after.terminal === 'mate') afterScore = { mate: 1 };       // we just mated them
    else if (after.terminal === 'draw') afterScore = { cp: 0 };
    else {
      afterScore = neg(after.lines[0].score);
      // Same-search score is less noisy, but if the position-after search found a
      // real refutation (much worse), trust that deeper look instead.
      if (playedLine && winPct(afterScore) > winPct(playedLine.score) - 10) afterScore = playedLine.score;
    }
    const winAfter = winPct(afterScore);
    const isBest = best.pv[0] === p.uci || p.mateAfter || (playedLine && winAfter >= winBefore - 0.3);
    const loss = isBest ? 0 : Math.max(0, winBefore - winAfter);

    let label;
    if (p.forced) label = 'forced';
    else if (p.book) label = 'book';
    else if (loss >= 20) label = 'blunder';
    else if (prevLoss >= 10 && loss >= 5) label = 'miss';
    else if (loss >= 10) label = 'mistake';
    else if (loss >= 5) label = 'inaccuracy';
    else if (p.sacrifice && loss <= 2 && winAfter >= 45 && winBefore < 97) label = 'brilliant';
    else if (isBest && second && winBefore - winPct(second.score) >= 15 && winBefore < 97 && winBefore > 25) label = 'great';
    else if (isBest) label = 'best';
    else if (loss < 2) label = 'excellent';
    else label = 'good';

    const accuracy = Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss) - 3.1669));
    out.push({
      ...p, label, loss, accuracy, winBefore, winAfter,
      bestUci: best.pv[0], bestScore: best.score, playedScore: afterScore,
      bestLine: best.pv.slice(0, 10), who: labelOf(p),
      // opponent's best answer after the move played (used to explain mistakes)
      replyLine: after.lines?.[0]?.pv?.slice(0, 9) || null,
    });
    prevLoss = loss;
  }

  // per-player summary
  const players = {};
  for (const m of out) {
    if (!m.label) continue;
    const pl = (players[m.who] ||= { counts: Object.fromEntries(LABEL_ORDER.map((k) => [k, 0])), accs: [] });
    pl.counts[m.label]++;
    if (m.label !== 'forced' && m.label !== 'book') pl.accs.push(m.accuracy);
  }
  for (const pl of Object.values(players)) {
    // mix of mean and harmonic mean: one huge blunder hurts, like on chess sites
    const a = pl.accs;
    if (!a.length) { pl.accuracy = 100; continue; }
    const mean = a.reduce((x, y) => x + y, 0) / a.length;
    const harm = a.length / a.reduce((x, y) => x + 1 / Math.max(y, 1), 0);
    pl.accuracy = (mean + harm) / 2;
  }
  return { moves: out, players, evalCurve, opening: game.opening };
}

/** Score as text from White's point of view: "+1.3", "-0.4", "M3", "-M2" */
export function fmtScore(score, povColor) {
  if (!score) return '';
  const sign = povColor === 'w' ? 1 : -1;
  if (score.mate !== undefined && score.mate !== null) {
    const m = score.mate * sign;
    return (m > 0 ? 'M' : '-M') + Math.abs(m);
  }
  const v = (score.cp * sign) / 100;
  return (v > 0 ? '+' : '') + v.toFixed(1);
}
