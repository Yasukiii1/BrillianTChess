// Runs the Rookie engine off the main thread so the page never freezes.
import { Chess } from '/vendor/chess.js';
import { search } from './rookie.js';

self.onmessage = (e) => {
  const { id, fen, level } = e.data;
  try {
    const result = search(new Chess(fen), { level });
    self.postMessage({ id, ...result });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
