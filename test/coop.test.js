// End-to-end check of Boss Raid turn order against a real running server.
// Run: node test/coop.test.js   (starts its own server on port 3999)
import { spawn } from 'node:child_process';
import { io } from 'socket.io-client';
import assert from 'node:assert';

const PORT = 3999;
const URL = `http://localhost:${PORT}`;
const server = spawn(process.execPath, ['server/index.js'], { env: { ...process.env, PORT }, stdio: 'pipe' });
await new Promise((res) => server.stdout.on('data', (d) => d.toString().includes('running') && res()));

const finish = (code) => { server.kill(); process.exit(code); };
setTimeout(() => { console.error('TIMEOUT'); finish(1); }, 60000);

try {
  const { code } = await (await fetch(`${URL}/api/rooms`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: 'boss', bossSkill: 3, teamColor: 'w', bossTimeMs: 200 }),
  })).json();
  console.log('room', code);

  const mk = (token, name) => {
    const s = io(URL, { transports: ['websocket'] });
    s.last = null;
    s.on('state', (st) => (s.last = st));
    s.joinRoom = () => new Promise((r) => s.emit('join', { code, token, name }, r));
    s.do = (ev, data) => new Promise((r) => s.emit(ev, data, r));
    return s;
  };
  const waitFor = (s, pred) => new Promise((res) => {
    if (s.last && pred(s.last)) return res(s.last);
    const h = (st) => { if (pred(st)) { s.off('state', h); res(st); } };
    s.on('state', h);
  });

  const p1 = mk('tok-1', 'Alice');
  const p2 = mk('tok-2', 'Bob');
  const j1 = await p1.joinRoom();
  assert.strictEqual(j1.seat, 0);
  let r = await p1.do('move', { from: 'e2', to: 'e4' });
  assert.match(r.error, /Waiting for players/); console.log('✓ cannot move before partner joins');

  const j2 = await p2.joinRoom();
  assert.strictEqual(j2.seat, 1);

  r = await p2.do('move', { from: 'e2', to: 'e4' });
  assert.match(r.error, /Not your turn/); console.log('✓ P2 cannot move first');

  r = await p1.do('move', { from: 'e2', to: 'e4' });
  assert.ok(r.ok, JSON.stringify(r)); console.log('✓ P1 moved e4');

  r = await p1.do('move', { from: 'd2', to: 'd4' });
  assert.ok(r.error); console.log('✓ P1 blocked during boss turn:', r.error);

  let st = await waitFor(p2, (s) => s.moves.length === 2);
  assert.strictEqual(st.moves[1].who, 'Boss');
  assert.strictEqual(st.whoMoves, 1); console.log('✓ Boss replied', st.moves[1].san, '→ now P2');

  r = await p1.do('move', { from: 'd2', to: 'd4' });
  assert.match(r.error, /Not your turn/); console.log('✓ P1 blocked on P2 turn');

  r = await p2.do('move', { from: 'g1', to: 'f3' });
  assert.ok(r.ok, JSON.stringify(r));
  st = await waitFor(p1, (s) => s.moves.length === 4);
  assert.strictEqual(st.whoMoves, 0);
  assert.deepStrictEqual(st.moves.map((m) => m.who), ['P1', 'Boss', 'P2', 'Boss']);
  console.log('✓ order P1 → Boss → P2 → Boss → back to P1');

  r = await p1.do('move', { from: 'a2', to: 'a6' });
  assert.match(r.error, /Illegal/); console.log('✓ illegal move rejected');

  // Reconnect: P1 "refreshes" with same token and gets the same seat back.
  p1.disconnect();
  const p1b = mk('tok-1', 'Alice');
  const j1b = await p1b.joinRoom();
  assert.strictEqual(j1b.seat, 0);
  assert.strictEqual(j1b.state.moves.length, 4); console.log('✓ reconnect keeps seat and position');

  // Third person becomes spectator
  const spec = mk('tok-3', 'Eve');
  const js = await spec.joinRoom();
  assert.strictEqual(js.seat, -1);
  r = await spec.do('move', { from: 'd2', to: 'd4' });
  assert.ok(r.error); console.log('✓ spectator cannot move');

  // Resign + rematch: P2 opens next game
  r = await p2.do('resign');
  st = await waitFor(p1b, (s) => s.result);
  assert.strictEqual(st.result.winner, 'boss');
  r = await p1b.do('rematch');
  st = await waitFor(p1b, (s) => s.gameNo === 2);
  assert.strictEqual(st.whoMoves, 1); console.log('✓ resign + rematch, P2 opens game 2');

  console.log('\nALL CO-OP TESTS PASSED');
  finish(0);
} catch (e) {
  console.error('FAILED:', e);
  finish(1);
}
