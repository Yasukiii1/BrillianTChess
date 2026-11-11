// Stockfish workers for game review.
//
// - Each Analyzer is one Stockfish (single-threaded WASM) in a Web Worker.
//   Jobs run strictly one at a time: a search must finish ("bestmove") before
//   the next position is sent, so an answer can never be attached to the wrong
//   position. (Sending a new position while the old search was still running is
//   what made reviews "sometimes broken".)
// - AnalyzerPool runs several of them in parallel on different positions,
//   so a review uses several CPU cores at once.
// - Returns the top 3 lines (MultiPV 3) so the move you played can usually be
//   scored inside the same search as the best move.
import { parseInfo } from './classify.js';

const SF_URL = '/vendor/stockfish/stockfish-18-lite-single.js';

export class Analyzer {
  constructor() {
    this.worker = new Worker(SF_URL);
    this.queue = [];
    this.current = null;
    this.dead = false;
    this.worker.onmessage = (e) => this.#line(typeof e.data === 'string' ? e.data : '');
    this.worker.onerror = () => { this.dead = true; this.#failAll(); };
    for (const c of ['uci', 'setoption name Hash value 32', 'setoption name MultiPV value 3',
      'setoption name Skill Level value 20', 'isready']) this.worker.postMessage(c);
  }

  #line(line) {
    const j = this.current;
    if (!j) return;
    const info = parseInfo(line);
    if (info) {
      j.lines[info.multipv - 1] = { score: info.score, pv: info.pv.slice(0, 10), depth: info.depth };
    } else if (line.startsWith('bestmove')) {
      clearTimeout(j.timer);
      this.current = null;
      const lines = j.lines.filter(Boolean);
      const depth = lines.length ? lines[0].depth : 0;
      // drop secondary lines left over from an older (shallower) iteration
      j.resolve(lines.length ? { lines: lines.filter((l, i) => i === 0 || l.depth >= depth - 1), depth } : null);
      this.#next();
    }
  }

  #next() {
    if (this.current || !this.queue.length || this.dead) return;
    const j = (this.current = this.queue.shift());
    j.timer = setTimeout(() => this.worker.postMessage('stop'), j.maxMs);
    this.worker.postMessage(`position fen ${j.fen}`);
    this.worker.postMessage(`go depth ${j.depth}`);
  }

  #failAll() {
    for (const j of [this.current, ...this.queue]) if (j) j.resolve(null);
    this.current = null; this.queue = [];
  }

  /** Resolves to { lines:[{score,pv,depth}], depth } or null if the engine failed. */
  analyze(fen, depth = 18, maxMs = 20000) {
    return new Promise((resolve) => {
      this.queue.push({ fen, depth, maxMs, resolve, lines: [] });
      this.#next();
    });
  }

  get load() { return (this.current ? 1 : 0) + this.queue.length; }

  /** Drop waiting jobs and stop the current search. */
  cancel() {
    for (const j of this.queue) j.resolve(null);
    this.queue = [];
    if (this.current) this.worker.postMessage('stop');
  }

  destroy() { this.cancel(); this.worker.terminate(); this.dead = true; }
}

/** Several Analyzers; each job goes to the least busy one. */
export class AnalyzerPool {
  constructor(size = defaultWorkers()) {
    this.workers = Array.from({ length: size }, () => new Analyzer());
  }
  analyze(fen, depth, maxMs) {
    const w = this.workers.filter((x) => !x.dead).sort((a, b) => a.load - b.load)[0];
    return w ? w.analyze(fen, depth, maxMs) : Promise.resolve(null);
  }
  cancel() { this.workers.forEach((w) => w.cancel()); }
  destroy() { this.workers.forEach((w) => w.destroy()); }
  get size() { return this.workers.length; }
}

/** Use about half the CPU cores (max 6), leaving room for the page and the game bot. */
export function defaultWorkers() {
  const cores = navigator.hardwareConcurrency || 4;
  return Math.max(1, Math.min(6, Math.floor(cores / 2)));
}
