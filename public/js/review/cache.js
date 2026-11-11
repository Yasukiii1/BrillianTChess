// Remembers Stockfish results per position (in this browser), so the live
// reviewer's work during the game makes the post-game review instant.
const KEY = 'chess-evals-v2';
const MAX = 4000;
let mem = null;
let saveTimer = null;

// Same position = same placement, side to move, castling and en passant (ignore move counters).
export const posKey = (fen) => fen.split(' ').slice(0, 4).join(' ');

function load() {
  if (mem) return mem;
  try { mem = new Map(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { mem = new Map(); }
  return mem;
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const m = load();
    while (m.size > MAX) m.delete(m.keys().next().value); // forget the oldest
    try { localStorage.setItem(KEY, JSON.stringify([...m])); } catch { /* storage full */ }
  }, 300);
}

/** Cached analysis for this position at >= minDepth, or null. */
export function getEval(fen, minDepth) {
  const e = load().get(posKey(fen));
  return e && e.depth >= minDepth ? e : null;
}

export function putEval(fen, analysis) {
  if (!analysis || !analysis.lines?.length) return;
  const m = load();
  const k = posKey(fen);
  const old = m.get(k);
  if (old && old.depth > analysis.depth) return; // keep the deeper one
  m.delete(k);
  m.set(k, { depth: analysis.depth, lines: analysis.lines.map((l) => ({ score: l.score, pv: l.pv })) });
  save();
}

/** Re-read storage (e.g. the review tab picking up what the game tab analysed). */
export function reloadEvals() { mem = null; }

/** Flush pending writes now (call before opening the review tab). */
export function flushEvals() {
  clearTimeout(saveTimer);
  const m = load();
  try { localStorage.setItem(KEY, JSON.stringify([...m])); } catch { /* ignore */ }
}
