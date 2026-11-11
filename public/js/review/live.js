// The live reviewer: a second Stockfish that quietly checks every position
// while you play. Results are saved per position (never shown during the game),
// so when the game ends the review page only has to check the last move or two.
import { Chess } from '/vendor/chess.js';
import { AnalyzerPool } from './analyzer.js';
import { getEval, putEval, flushEvals, posKey } from './cache.js';

export const REVIEW_DEPTH = 18; // the review page's default depth uses the same number, so results are reused

export class LiveReviewer {
  constructor({ workers = 2, depth = REVIEW_DEPTH } = {}) {
    this.workers = workers;
    this.depth = depth;
    this.pool = null;     // created on first use
    this.seen = new Set();
  }

  /** Queue one position (FEN) for background analysis. */
  push(fen) {
    const key = posKey(fen);
    if (this.seen.has(key)) return;
    this.seen.add(key);
    const c = new Chess(fen);
    if (c.isGameOver()) return;
    if (getEval(fen, this.depth)) return; // already known
    if (!this.pool) this.pool = new AnalyzerPool(this.workers);
    this.pool.analyze(fen, this.depth).then((a) => a && putEval(fen, a));
  }

  /** Queue every position of a game given as SAN moves. */
  pushGame(startFen, sans) {
    const c = new Chess(startFen);
    this.push(c.fen());
    for (const san of sans) {
      try { c.move(san); } catch { return; }
      this.push(c.fen());
    }
  }

  /** Make sure everything checked so far is saved (call before opening the review). */
  flush() { flushEvals(); }
}
