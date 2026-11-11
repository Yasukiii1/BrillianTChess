// Runs Stockfish in a Web Worker and returns the top 2 lines for a position.
import { parseInfo } from './classify.js';

export class Analyzer {
  constructor() {
    this.worker = new Worker('/vendor/stockfish/stockfish-18-lite-single.js');
    this.job = null;
    this.worker.onmessage = (e) => this.#line(typeof e.data === 'string' ? e.data : '');
    for (const c of ['uci', 'setoption name MultiPV value 2', 'setoption name Skill Level value 20', 'isready']) this.worker.postMessage(c);
  }

  #line(line) {
    const j = this.job;
    if (!j) return;
    const info = parseInfo(line);
    if (info) j.lines[info.multipv - 1] = { score: info.score, pv: info.pv, depth: info.depth };
    else if (line.startsWith('bestmove')) {
      clearTimeout(j.timer);
      this.job = null;
      j.resolve({ lines: j.lines.filter(Boolean) });
    }
  }

  /** depth: search depth; maxMs: safety cap per position */
  analyze(fen, depth = 14, maxMs = 5000) {
    return new Promise((resolve) => {
      this.job = { resolve, lines: [], timer: setTimeout(() => this.worker.postMessage('stop'), maxMs) };
      this.worker.postMessage(`position fen ${fen}`);
      this.worker.postMessage(`go depth ${depth}`);
    });
  }

  destroy() { this.worker.terminate(); }
}
