// Reviews real games with the real Stockfish engine and checks the labels make sense.
// Run: node test/review.test.js
import { createRequire } from 'node:module';
import { Chess } from 'chess.js';
import assert from 'node:assert';
import { buildGame, classify, parseInfo, fmtScore } from '../public/js/review/classify.js';
import { OPENINGS } from '../public/js/review/openings.js';
import { explain, _internals } from '../public/js/review/coach.js';

// 1. Every opening line in the book must be legal.
for (const o of OPENINGS) { const c = new Chess(); for (const m of o.moves) c.move(m); }
console.log(`✓ ${OPENINGS.length} opening lines are legal`);

// 2. Real engine
const require = createRequire(import.meta.url);
const engine = await require('stockfish')('lite-single');
let job = null;
engine.listener = (line) => {
  if (!job) return;
  const info = parseInfo(line);
  if (info) job.lines[info.multipv - 1] = { score: info.score, pv: info.pv };
  else if (line.startsWith('bestmove')) { const j = job; job = null; j.resolve({ lines: j.lines.filter(Boolean) }); }
};
engine.sendCommand('uci');
engine.sendCommand('setoption name MultiPV value 3');
const analyze = (fen, depth) => new Promise((resolve) => {
  job = { resolve, lines: [] };
  engine.sendCommand(`position fen ${fen}`);
  engine.sendCommand(`go depth ${depth}`);
});

async function review(sans, depth = 16) {
  const game = buildGame(Chess, new Chess().fen(), sans);
  const analyses = [];
  const positions = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  for (const fen of positions) {
    const c = new Chess(fen);
    if (c.isCheckmate()) analyses.push({ terminal: 'mate' });
    else if (c.isGameOver()) analyses.push({ terminal: 'draw' });
    else analyses.push(await analyze(fen, depth));
  }
  return classify(game, analyses);
}
const show = (r) => r.moves.map((m) => `${m.san}:${m.label}`).join(' ');

// Blackburne Shilling trap: White grabs e5 and walks into a mating attack.
let r = await review('e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#'.split(' '));
console.log(show(r));
const lab = (san, color) => r.moves.find((m) => m.san === san && (!color || m.color === color)).label;
assert.strictEqual(r.moves[0].label, 'book');
assert.ok(['blunder', 'mistake'].includes(lab('Nxf7')), 'Nxf7 should be a blunder/mistake');
assert.ok(['best', 'great', 'excellent', 'brilliant'].includes(lab('Nf3#')), 'mate should be best');
assert.ok(r.players.White.accuracy < r.players.Black.accuracy, 'White played worse');
console.log('✓ trap game:', 'White', r.players.White.accuracy.toFixed(1), '% vs Black', r.players.Black.accuracy.toFixed(1), '%');

// Légal's mate: 6.Nxe5!! gives up the queen.
r = await review('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#'.split(' '));
console.log(show(r));
assert.ok(['blunder', 'mistake', 'miss'].includes(lab('Bxd1')), 'taking the queen is a blunder');
console.log('✓ Légal: Nxe5 =', lab('Nxe5'), ', Bxd1 =', lab('Bxd1'));

// Scholar's-mate style blunder by Black.
r = await review('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#'.split(' '));
console.log(show(r));
assert.strictEqual(lab('Nf6'), 'blunder');
console.log('✓ Nf6?? walking into mate is a blunder');

// ---- Coach ----
const say = (res, san, color) => { const i = res.moves.findIndex((m) => m.san === san && (!color || m.color === color)); const e = explain(Chess, res.moves[i], res.moves[i - 1]); console.log('  [' + res.moves[i].label + '] ' + san + ': ' + e.text.join(' ') + (e.lines.length ? '  {lines: ' + e.lines.map((l) => l.title + ' = ' + l.sans).join(' | ') + '}' : '')); return e; };
r = await review('e4 e5 Nf3 d6 Bc4 Bg4 Nc3 g6 Nxe5 Bxd1 Bxf7+ Ke7 Nd5#'.split(' '));
let e = say(r, 'Nxe5'); assert.match(e.text.join(' '), /sacrifice/); assert.ok(e.lines.length);
e = say(r, 'Bxd1'); assert.match(e.text.join(' '), /checkmate/); assert.ok(e.lines.some((l) => /goes wrong/.test(l.title)));
say(r, 'Bxf7+'); say(r, 'Ke7');
r = await review('e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#'.split(' '));
e = say(r, 'Bc4'); assert.match(e.text.join(' '), /threatens Qxf7# checkmate/i);
e = say(r, 'Nf6'); assert.match(e.text.join(' '), /checkmate/);
r = await review('e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#'.split(' '));
say(r, 'Nxe5'); say(r, 'Qg5'); say(r, 'Nxf7'); say(r, 'Qxg2');
// pattern detectors
let c = new Chess('r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1'); let mv = c.move('Nc7+');
assert.ok(_internals.forkTargets(c, mv), 'knight fork'); console.log('✓ fork detected');
c = new Chess('4k3/3p4/2n5/8/8/8/8/4KB2 w - - 0 1'); c.remove('d7'); mv = c.move('Bb5');
assert.strictEqual(_internals.pinOrSkewer(c, mv).kind, 'pin'); console.log('✓ pin detected');
console.log('✓ coach explanations look right');

assert.strictEqual(fmtScore({ cp: 130 }, 'w'), '+1.3');
assert.strictEqual(fmtScore({ mate: 2 }, 'b'), '-M2');
console.log('\nALL REVIEW TESTS PASSED');
process.exit(0);
