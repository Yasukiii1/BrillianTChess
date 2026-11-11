// Run: node test/rookie.test.js
import { Chess } from 'chess.js';
import { search } from '../public/js/engine/rookie.js';
import assert from 'node:assert';

const run = (fen, level, extra = {}) => { const c = new Chess(fen); const before = c.fen(); const r = search(c, { level, ...extra }); assert.strictEqual(c.fen(), before, 'board must be restored'); return r; };

// 1. Mate in one (back-rank): Re8#
let r = run('6k1/5ppp/8/8/8/8/5PPP/4R1K1 w - - 0 1', 'hard');
assert.strictEqual(r.move, 'e1e8'); console.log('mate-in-1 ok', r);

// 2. Grab a free queen
r = run('4k3/8/8/3q4/8/8/8/3QK3 w - - 0 1', 'medium');
assert.strictEqual(r.move, 'd1d5'); console.log('free queen ok', r);

// 3. Mate in two: hard should find it
r = run('r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', 'hard');
assert.strictEqual(r.move, 'h5f7'); console.log('scholar mate ok', r);

// 4. Time budget respected from the start position
for (const lvl of ['easy', 'medium', 'hard']) {
  const t = Date.now(); r = run(new Chess().fen(), lvl);
  console.log(lvl, r.move, 'depth', r.depth, 'nodes', r.nodes, Date.now() - t, 'ms');
}
// 5. Self-play a few moves for crashes
const g = new Chess();
for (let i = 0; i < 40 && !g.isGameOver(); i++) { const m = search(g, { level: 'medium', timeMs: 200 }); g.move(m.move); }
console.log('self-play ok:', g.pgn().slice(0, 200));
