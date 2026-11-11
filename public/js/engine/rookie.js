// Rookie: our own chess engine.
//
// How it thinks:
//   1. Evaluation  - counts material and uses "piece-square tables" (bonuses for
//                    good squares, e.g. knights in the centre, pawns advancing).
//   2. Search      - negamax with alpha-beta pruning: it looks N moves ahead and
//                    skips branches that can't change the result.
//   3. Quiescence  - at the end of the search it keeps looking at captures so it
//                    doesn't stop in the middle of a trade.
//   4. Iterative deepening + transposition table - search depth 1, 2, 3 ... until
//                    time runs out, remembering positions it has already seen.
//
// chess.js only supplies the rules (legal move generation). This file talks to
// chess.js internals (_moves, _makeMove, _undoMove, _board, _hash) because the
// public API is ~20x slower for search. chess.js is pinned to 1.4.0 in package.json.

const VALUE = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 0 };

// Piece-square tables, written from White's point of view, a8 first (row 0 = rank 8).
// Source idea: Tomasz Michniewski's "Simplified Evaluation Function".
const PST = {
  p: [
     0,  0,  0,  0,  0,  0,  0,  0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
     5,  5, 10, 25, 25, 10,  5,  5,
     0,  0,  0, 20, 20,  0,  0,  0,
     5, -5,-10,  0,  0,-10, -5,  5,
     5, 10, 10,-20,-20, 10, 10,  5,
     0,  0,  0,  0,  0,  0,  0,  0],
  n: [
   -50,-40,-30,-30,-30,-30,-40,-50,
   -40,-20,  0,  0,  0,  0,-20,-40,
   -30,  0, 10, 15, 15, 10,  0,-30,
   -30,  5, 15, 20, 20, 15,  5,-30,
   -30,  0, 15, 20, 20, 15,  0,-30,
   -30,  5, 10, 15, 15, 10,  5,-30,
   -40,-20,  0,  5,  5,  0,-20,-40,
   -50,-40,-30,-30,-30,-30,-40,-50],
  b: [
   -20,-10,-10,-10,-10,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5, 10, 10,  5,  0,-10,
   -10,  5,  5, 10, 10,  5,  5,-10,
   -10,  0, 10, 10, 10, 10,  0,-10,
   -10, 10, 10, 10, 10, 10, 10,-10,
   -10,  5,  0,  0,  0,  0,  5,-10,
   -20,-10,-10,-10,-10,-10,-10,-20],
  r: [
     0,  0,  0,  0,  0,  0,  0,  0,
     5, 10, 10, 10, 10, 10, 10,  5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
    -5,  0,  0,  0,  0,  0,  0, -5,
     0,  0,  0,  5,  5,  0,  0,  0],
  q: [
   -20,-10,-10, -5, -5,-10,-10,-20,
   -10,  0,  0,  0,  0,  0,  0,-10,
   -10,  0,  5,  5,  5,  5,  0,-10,
    -5,  0,  5,  5,  5,  5,  0, -5,
     0,  0,  5,  5,  5,  5,  0, -5,
   -10,  5,  5,  5,  5,  5,  0,-10,
   -10,  0,  5,  0,  0,  0,  0,-10,
   -20,-10,-10, -5, -5,-10,-10,-20],
  k: [ // middlegame: stay safe behind pawns
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -30,-40,-40,-50,-50,-40,-40,-30,
   -20,-30,-30,-40,-40,-30,-30,-20,
   -10,-20,-20,-20,-20,-20,-20,-10,
    20, 20,  0,  0,  0,  0, 20, 20,
    20, 30, 10,  0,  0, 10, 30, 20],
  kEnd: [ // endgame: walk to the centre
   -50,-40,-30,-20,-20,-30,-40,-50,
   -30,-20,-10,  0,  0,-10,-20,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 30, 40, 40, 30,-10,-30,
   -30,-10, 20, 30, 30, 20,-10,-30,
   -30,-30,  0,  0,  0,  0,-30,-30,
   -50,-30,-30,-30,-30,-30,-30,-50],
};

const BITS_CAPTURE = 2, BITS_EP = 8, BITS_PROMO = 16;
const MATE = 100000;
const INF = 1000000;
const TT_EXACT = 0, TT_LOWER = 1, TT_UPPER = 2;

export const LEVELS = {
  easy:   { maxDepth: 2,  timeMs: 400,  noise: 120, blunder: 0.10 },
  medium: { maxDepth: 4,  timeMs: 1200, noise: 30,  blunder: 0 },
  hard:   { maxDepth: 64, timeMs: 2500, noise: 0,   blunder: 0 },
};

const FILES = 'abcdefgh';
const sqName = (sq) => FILES[sq & 7] + (8 - (sq >> 4));
export const toUci = (m) => sqName(m.from) + sqName(m.to) + (m.promotion || '');
const moveKey = (m) => m.from * 128 + m.to + (m.promotion ? VALUE[m.promotion] * 100000 : 0);

// ---------- evaluation (score for the side to move) ----------
export function evaluate(chess) {
  const board = chess._board;
  let mg = 0;              // white-minus-black
  let nonPawnMaterial = 0; // to detect endgame
  let wk = -1, bk = -1;
  let bishopsW = 0, bishopsB = 0;

  for (let sq = 0; sq < 128; sq++) {
    if (sq & 0x88) { sq += 7; continue; }
    const p = board[sq];
    if (!p) continue;
    const row = sq >> 4, col = sq & 7;
    const idx = p.color === 'w' ? row * 8 + col : (7 - row) * 8 + col;
    if (p.type === 'k') { if (p.color === 'w') wk = idx; else bk = idx; continue; }
    const s = VALUE[p.type] + PST[p.type][idx];
    if (p.type !== 'p') nonPawnMaterial += VALUE[p.type];
    if (p.type === 'b') { if (p.color === 'w') bishopsW++; else bishopsB++; }
    mg += p.color === 'w' ? s : -s;
  }
  const endgame = nonPawnMaterial <= 1600;
  const kt = endgame ? PST.kEnd : PST.k;
  if (wk >= 0) mg += kt[wk];
  if (bk >= 0) mg -= kt[bk];
  if (bishopsW >= 2) mg += 30;
  if (bishopsB >= 2) mg -= 30;
  return chess._turn === 'w' ? mg : -mg;
}

// ---------- search ----------
class Abort extends Error {}

export function search(chess, opts = {}) {
  const level = typeof opts.level === 'string' ? LEVELS[opts.level] : (opts.level || LEVELS.medium);
  const maxDepth = opts.maxDepth ?? level.maxDepth;
  const timeMs = opts.timeMs ?? level.timeMs;
  const noise = level.noise || 0;
  const deadline = Date.now() + timeMs;

  const rootMoves = chess._moves({ legal: true });
  if (rootMoves.length === 0) return null;
  if (rootMoves.length === 1) return { move: toUci(rootMoves[0]), score: 0, depth: 0, nodes: 0 };

  // Easy level sometimes just plays something silly.
  if (level.blunder && Math.random() < level.blunder) {
    const m = rootMoves[Math.floor(Math.random() * rootMoves.length)];
    return { move: toUci(m), score: 0, depth: 0, nodes: 0, blunder: true };
  }

  const tt = new Map();
  const killers = [];
  const pathHashes = [];
  let nodes = 0;

  const leafEval = () => {
    const e = evaluate(chess);
    return noise ? e + Math.round((Math.random() * 2 - 1) * noise) : e;
  };

  const orderScore = (m, ttKey, ply) => {
    const k = moveKey(m);
    if (k === ttKey) return 1e9;
    let s = 0;
    if (m.flags & (BITS_CAPTURE | BITS_EP)) s += 1e6 + 10 * VALUE[m.captured || 'p'] - VALUE[m.piece]; // MVV-LVA
    if (m.flags & BITS_PROMO) s += 9e5 + VALUE[m.promotion];
    const kl = killers[ply];
    if (kl && (kl[0] === k || kl[1] === k)) s += 5e5;
    return s;
  };

  const sortMoves = (moves, ttKey, ply) => {
    const scored = moves.map((m) => ({ m, s: orderScore(m, ttKey, ply) }));
    scored.sort((a, b) => b.s - a.s);
    return scored.map((x) => x.m);
  };

  const checkTime = () => {
    if ((++nodes & 2047) === 0 && Date.now() > deadline) throw new Abort();
  };

  function quiesce(alpha, beta, qply) {
    checkTime();
    const standPat = leafEval();
    if (standPat >= beta) return beta;
    if (standPat > alpha) alpha = standPat;
    if (qply > 8) return alpha;

    const caps = chess._moves({ legal: true }).filter((m) => m.flags & (BITS_CAPTURE | BITS_EP | BITS_PROMO));
    for (const m of sortMoves(caps, -1, 99)) {
      chess._makeMove(m);
      const score = -quiesce(-beta, -alpha, qply + 1);
      chess._undoMove();
      if (score >= beta) return beta;
      if (score > alpha) alpha = score;
    }
    return alpha;
  }

  function negamax(depth, alpha, beta, ply) {
    checkTime();
    const hash = chess._hash;

    // Repetition inside the search line = draw.
    if (ply > 0 && pathHashes.includes(hash)) return 0;

    const inCheck = chess._isKingAttacked(chess._turn);
    if (inCheck) depth++; // check extension: don't stop the search while in check

    if (depth <= 0) return quiesce(alpha, beta, 0);

    const alphaOrig = alpha;
    const entry = tt.get(hash);
    let ttMoveKey = -1;
    if (entry) {
      ttMoveKey = entry.best;
      if (ply > 0 && entry.depth >= depth) {
        if (entry.flag === TT_EXACT) return entry.score;
        if (entry.flag === TT_LOWER && entry.score >= beta) return entry.score;
        if (entry.flag === TT_UPPER && entry.score <= alpha) return entry.score;
      }
    }

    const moves = chess._moves({ legal: true });
    if (moves.length === 0) return inCheck ? -MATE + ply : 0;

    let best = -INF, bestKey = -1;
    pathHashes.push(hash);
    try {
      for (const m of sortMoves(moves, ttMoveKey, ply)) {
        chess._makeMove(m);
        const score = -negamax(depth - 1, -beta, -alpha, ply + 1);
        chess._undoMove();
        if (score > best) { best = score; bestKey = moveKey(m); }
        if (score > alpha) alpha = score;
        if (alpha >= beta) {
          if (!(m.flags & (BITS_CAPTURE | BITS_EP))) {
            const kl = killers[ply] || (killers[ply] = [-1, -1]);
            if (kl[0] !== moveKey(m)) { kl[1] = kl[0]; kl[0] = moveKey(m); }
          }
          break;
        }
      }
    } finally {
      pathHashes.pop();
    }

    const flag = best <= alphaOrig ? TT_UPPER : best >= beta ? TT_LOWER : TT_EXACT;
    if (tt.size > 500000) tt.clear();
    tt.set(hash, { depth, score: best, flag, best: bestKey });
    return best;
  }

  // Root: iterative deepening. Shuffle first so equal moves vary between games.
  let ordered = rootMoves.slice().sort(() => Math.random() - 0.5);
  let bestMove = ordered[0], bestScore = 0, completedDepth = 0;

  const startLen = chess._history.length;
  for (let depth = 1; depth <= maxDepth; depth++) {
    try {
      let alpha = -INF, iterBest = null, iterScore = -INF;
      pathHashes.push(chess._hash);
      for (const m of ordered) {
        chess._makeMove(m);
        const score = -negamax(depth - 1, -INF, -alpha, 1);
        chess._undoMove();
        if (score > iterScore) { iterScore = score; iterBest = m; }
        if (score > alpha) alpha = score;
      }
      pathHashes.pop();
      bestMove = iterBest; bestScore = iterScore; completedDepth = depth;
      ordered = [iterBest, ...ordered.filter((m) => m !== iterBest)]; // best first next time
      if (Math.abs(iterScore) > MATE - 1000) break; // found a forced mate
    } catch (e) {
      if (!(e instanceof Abort)) throw e;
      // Time ran out mid-search: put the board back exactly as we found it.
      while (chess._history.length > startLen) chess._undoMove();
      pathHashes.length = 0;
      break;
    }
    if (Date.now() > deadline) break;
  }

  return { move: toUci(bestMove), score: bestScore, depth: completedDepth, nodes };
}
