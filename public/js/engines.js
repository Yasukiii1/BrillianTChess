// Browser-side bots. Both expose: await engine.getMove(fen) -> 'e2e4' (UCI string)

export class RookieEngine {
  constructor(level = 'medium') {
    this.level = level;
    this.worker = new Worker('/js/engine/rookie-worker.js', { type: 'module' });
    this.nextId = 1;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data.move);
    };
  }
  get name() { return `Rookie (${this.level})`; }
  getMove(fen) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, fen, level: this.level });
    });
  }
  destroy() { this.worker.terminate(); this.pending.clear(); }
}

// Stockfish 18 (lite, single-threaded WASM) running in a Web Worker.
export class StockfishEngine {
  constructor(skill = 10, moveTimeMs = 1000) {
    this.skill = skill;
    this.moveTimeMs = moveTimeMs;
    this.worker = new Worker('/vendor/stockfish/stockfish-18-lite-single.js');
    this.waiting = null;
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : '';
      if (line.startsWith('bestmove') && this.waiting) {
        const move = line.split(' ')[1];
        const w = this.waiting; this.waiting = null;
        w(move);
      }
    };
    this.send('uci');
    this.send(`setoption name Skill Level value ${skill}`);
    this.send('isready');
  }
  get name() { return `Stockfish (level ${this.skill})`; }
  send(cmd) { this.worker.postMessage(cmd); }
  getMove(fen) {
    return new Promise((resolve) => {
      this.waiting = resolve;
      this.send(`position fen ${fen}`);
      this.send(`go movetime ${this.moveTimeMs}`);
    });
  }
  destroy() { this.worker.terminate(); this.waiting = null; }
}
