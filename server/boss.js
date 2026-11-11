// The Boss: Stockfish 18 (lite, single-threaded WASM) running inside the server.
// One engine instance is shared by all rooms; requests wait in a queue.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const initEngine = require('stockfish');

let enginePromise = null;
let queue = Promise.resolve();

function getEngine() {
  if (!enginePromise) {
    enginePromise = initEngine('lite-single').then((engine) => {
      engine.listener = () => {};
      engine.sendCommand('uci');
      engine.sendCommand('isready');
      return engine;
    });
  }
  return enginePromise;
}

function think(engine, fen, skill, movetime) {
  return new Promise((resolve, reject) => {
    const safety = setTimeout(() => engine.sendCommand('stop'), movetime + 4000);
    const giveUp = setTimeout(() => reject(new Error('Boss did not answer')), movetime + 10000);
    engine.listener = (line) => {
      if (typeof line !== 'string' || !line.startsWith('bestmove')) return;
      clearTimeout(safety); clearTimeout(giveUp);
      engine.listener = () => {};
      resolve(line.split(' ')[1]);
    };
    engine.sendCommand(`setoption name Skill Level value ${skill}`);
    engine.sendCommand(`position fen ${fen}`);
    engine.sendCommand(`go movetime ${movetime}`);
  });
}

/** Ask the Boss for a move. Returns a UCI string like 'e7e5' (or '(none)'). */
export function bossMove(fen, { skill = 14, movetime = 1000 } = {}) {
  const job = queue.then(async () => think(await getEngine(), fen, skill, movetime));
  queue = job.catch(() => {}); // keep the queue alive after an error
  return job;
}

/** Start loading the engine early so the first boss move isn't slow. */
export function warmUp() { getEngine().catch((e) => console.error('Stockfish failed to load:', e)); }
