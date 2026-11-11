// The Coach: explains WHY a move is brilliant, best, a blunder, etc.
//
// It doesn't guess. It replays Stockfish's lines with chess.js and looks for
// concrete, checkable facts:
//   - material won or lost along the line (and whether it ends in checkmate)
//   - forks, pins and skewers created by the moved piece
//   - mate threats ("threatens Qxf7#")
//   - pieces left hanging, checks, captures, promotions, castling, development
// Then it turns those facts into short sentences, plus lines you can play
// through on the board. Pure functions: works in the browser and in Node.

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };
const NAME = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const SIDE = { w: 'White', b: 'Black' };
const other = (c) => (c === 'w' ? 'b' : 'w');
const aPiece = (t) => `${/^[aeiou]/.test(NAME[t]) ? 'an' : 'a'} ${NAME[t]}`;

function uciMove(chess, uci) {
  try { return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined }); } catch { return null; }
}

/** Convert a UCI line to SAN text starting from fen, e.g. "12.Nxe5 dxe5 13.Qh5" */
export function lineToSan(Chess, fen, ucis, max = 8) {
  const c = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, max)) {
    const no = c.moveNumber(), turn = c.turn();
    const m = uciMove(c, u);
    if (!m) break;
    out.push((turn === 'w' ? `${no}.` : out.length === 0 ? `${no}...` : '') + m.san);
  }
  return out.join(' ');
}

/** Play a line and list what each side captured; also detect mate at the end. */
function playLine(Chess, fen, ucis, maxPlies = 8) {
  const c = new Chess(fen);
  const caps = { w: [], b: [] };
  const sans = [];
  const fens = [c.fen()];
  for (const u of ucis.slice(0, maxPlies)) {
    const m = uciMove(c, u);
    if (!m) break;
    if (m.captured) caps[m.color].push(m.captured);
    if (m.promotion) caps[m.color].push('promo:' + m.promotion);
    sans.push(m.san);
    fens.push(c.fen());
    if (c.isGameOver()) break;
  }
  return { caps, sans, fens, mate: c.isCheckmate(), loser: c.isCheckmate() ? c.turn() : null, final: c };
}

/** Describe net material for `color` from capture lists, e.g. "wins a knight", "wins the exchange". */
function materialPhrase(caps, color) {
  const mine = caps[color].filter((x) => !x.startsWith('promo')).slice();
  const theirs = caps[other(color)].filter((x) => !x.startsWith('promo')).slice();
  // cancel equal trades
  for (let i = mine.length - 1; i >= 0; i--) {
    const j = theirs.findIndex((t) => VAL[t] === VAL[mine[i]]);
    if (j >= 0) { theirs.splice(j, 1); mine.splice(i, 1); }
  }
  const promo = caps[color].some((x) => x.startsWith('promo'));
  const sum = (a) => a.reduce((s, t) => s + VAL[t], 0);
  const net = sum(mine) - sum(theirs) + (promo ? 8 : 0) - (caps[other(color)].some((x) => x.startsWith('promo')) ? 8 : 0);
  if (Math.abs(net) < 1) return { net: 0, text: null };
  if (net > 0) {
    if (promo && !mine.length) return { net, text: 'gets a new queen' };
    if (mine.length === 1 && mine[0] === 'r' && theirs.length === 1 && VAL[theirs[0]] === 3) return { net, text: 'wins the exchange (rook for a minor piece)' };
    const sorted = mine.sort((a, b) => VAL[b] - VAL[a]);
    const top = sorted.slice(0, 2).map(aPiece).join(' and ');
    return { net, text: theirs.length ? `comes out ahead (+${net}), winning ${top}` : `wins ${top}` };
  }
  const sorted = theirs.sort((a, b) => VAL[b] - VAL[a]);
  if (theirs.length === 1 && theirs[0] === 'r' && mine.length === 1 && VAL[mine[0]] === 3) return { net, text: 'loses the exchange' };
  return { net, text: `loses ${sorted.slice(0, 2).map(aPiece).join(' and ')}` };
}

// ---------- tactical patterns on a position right after `mv` was played ----------
function forkTargets(after, mv) {
  const me = mv.color, them = other(me);
  const targets = [];
  for (const row of after.board()) for (const p of row) {
    if (!p || p.color !== them) continue;
    if (!after.attackers(p.square, me).includes(mv.to)) continue;
    const undefended = p.type !== 'k' && after.attackers(p.square, them).length === 0;
    if (p.type === 'k' || VAL[p.type] > VAL[mv.piece] || (undefended && VAL[p.type] >= 3)) targets.push(p);
  }
  return targets.length >= 2 ? targets : null;
}

function pinOrSkewer(after, mv) {
  if (!['b', 'r', 'q'].includes(mv.piece)) return null;
  const dirs = { b: [[1, 1], [1, -1], [-1, 1], [-1, -1]], r: [[1, 0], [-1, 0], [0, 1], [0, -1]] };
  const list = mv.piece === 'q' ? [...dirs.b, ...dirs.r] : dirs[mv.piece];
  const f0 = 'abcdefgh'.indexOf(mv.to[0]), r0 = +mv.to[1];
  for (const [df, dr] of list) {
    let f = f0 + df, r = r0 + dr, first = null;
    while (f >= 0 && f < 8 && r >= 1 && r <= 8) {
      const sq = 'abcdefgh'[f] + r;
      const p = after.get(sq);
      if (p) {
        if (!first) { if (p.color === mv.color) break; first = { ...p, square: sq }; }
        else {
          if (p.color !== mv.color) {
            if (first.type === 'k') return { kind: 'skewer', front: first, back: { ...p, square: sq } };
            // only pins that matter: to the king or queen, or a minor/pawn pinned to a rook
            const important = p.type === 'k' || p.type === 'q' || (p.type === 'r' && VAL[first.type] <= 3);
            if (important && VAL[p.type] > VAL[first.type]) return { kind: 'pin', front: first, back: { ...p, square: sq } };
            if (VAL[first.type] > VAL[p.type] && VAL[first.type] >= 5) return { kind: 'skewer', front: first, back: { ...p, square: sq } };
          }
          break;
        }
      }
      f += df; r += dr;
    }
  }
  return null;
}

/** If `color` could move again right now, which moves would checkmate? */
function mateThreats(Chess, fen, color) {
  const parts = fen.split(' ');
  if (parts[1] === color) return [];
  parts[1] = color; parts[3] = '-';
  let c;
  try { c = new Chess(parts.join(' ')); } catch { return []; }
  if (c.inCheck()) return [];
  const out = [];
  for (const m of c.moves({ verbose: true })) {
    c.move(m);
    if (c.isCheckmate()) out.push(m.san);
    c.undo();
    if (out.length) break;
  }
  return out;
}

function hangingAfter(after, color) {
  // pieces of `color` that are attacked and not defended (or attacked by something cheaper)
  const them = other(color), res = [];
  for (const row of after.board()) for (const p of row) {
    if (!p || p.color !== color || p.type === 'k' || p.type === 'p') continue;
    const att = after.attackers(p.square, them);
    if (!att.length) continue;
    const def = after.attackers(p.square, color).length;
    const cheapest = Math.min(...att.map((s) => VAL[after.get(s).type]));
    if (!def || cheapest < VAL[p.type]) res.push(p);
  }
  return res.sort((a, b) => VAL[b.type] - VAL[a.type]);
}

/** What does this single move do? Returns a list of short phrases. */
function moveIdeas(Chess, fen, uci, plyIndex) {
  const c = new Chess(fen);
  const mover = c.turn();
  const wasInCheck = c.inCheck();
  const threatenedBefore = hangingAfter(c, mover);
  const mv = uciMove(c, uci);
  if (!mv) return { ideas: [], mv: null };
  const ideas = [];
  if (c.isCheckmate()) return { ideas: ['delivers checkmate'], mv, after: c };
  if (wasInCheck) ideas.push('gets the king out of check');
  if (mv.flags.includes('k') || mv.flags.includes('q')) ideas.push('castles, tucking the king away safely and connecting the rooks');
  if (mv.promotion) ideas.push(`promotes to a ${NAME[mv.promotion]}`);
  if (mv.captured) {
    const defended = c.attackers(mv.to, other(mover)).length > 0;
    ideas.push(defended ? `captures the ${NAME[mv.captured]} on ${mv.to}` : `grabs the ${NAME[mv.captured]} on ${mv.to} for free`);
  }
  const fork = forkTargets(c, mv);
  if (fork) ideas.push(`forks ${fork.map((p) => (p.type === 'k' ? 'the king' : `the ${NAME[p.type]} on ${p.square}`)).join(' and ')}`);
  else {
    if (c.inCheck()) ideas.push('gives check');
    // a single threat: attacks an undefended piece, or a more valuable one
    const them = other(mover);
    for (const row of c.board()) for (const p of row) {
      if (!p || p.color !== them || p.type === 'k' || p.type === 'p') continue;
      if (!c.attackers(p.square, mover).includes(mv.to)) continue;
      const undefended = c.attackers(p.square, them).length === 0;
      if (undefended || VAL[p.type] > VAL[mv.piece]) {
        ideas.push(`attacks the ${undefended ? 'undefended ' : ''}${NAME[p.type]} on ${p.square}`);
        break;
      }
    }
  }
  const ps = pinOrSkewer(c, mv);
  if (ps?.kind === 'pin') ideas.push(`pins the ${NAME[ps.front.type]} on ${ps.front.square} to the ${NAME[ps.back.type]}${ps.back.type === 'k' ? '' : ' behind it'}`);
  if (ps?.kind === 'skewer') ideas.push(`skewers the ${NAME[ps.front.type]}: when it moves, the ${NAME[ps.back.type]} on ${ps.back.square} falls`);
  const threats = mateThreats(Chess, c.fen(), mover);
  if (threats.length) ideas.push(`threatens ${threats[0]} checkmate`);
  // saved a piece that was under attack?
  const savedPiece = threatenedBefore.find((p) => p.square === mv.from);
  if (savedPiece && !mv.captured) ideas.push(`moves the attacked ${NAME[savedPiece.type]} to safety`);
  if (plyIndex < 16 && ['n', 'b'].includes(mv.piece) && /[18]/.test(mv.from[1])) ideas.push(`develops the ${NAME[mv.piece]}`);
  if (plyIndex < 12 && mv.piece === 'p' && ['d4', 'e4', 'd5', 'e5', 'c4', 'c5'].includes(mv.to)) ideas.push('fights for the center');
  return { ideas, mv, after: c };
}

const join = (arr) => (arr.length <= 1 ? arr.join('') : arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Explain one reviewed move.
 *  m       : a move from classify() (has label, fenBefore, uci, san, bestUci, bestLine, replyLine, ...)
 *  prev    : the previous reviewed move (for "Miss")
 * Returns { text: [sentences], lines: [{ title, fen, ucis, sans }] }
 */
export function explain(Chess, m, prev) {
  const text = [];
  const lines = [];
  if (!m || !m.label) return { text, lines };
  const me = m.color, them = other(m.color);
  const played = moveIdeas(Chess, m.fenBefore, m.uci, m.ply);
  const bestSan = (() => { const c = new Chess(m.fenBefore); const x = uciMove(c, m.bestUci || ''); return x ? x.san : null; })();
  const best = m.bestUci && m.bestUci !== m.uci ? moveIdeas(Chess, m.fenBefore, m.bestUci, m.ply) : played;
  const bestRun = m.bestLine?.length ? playLine(Chess, m.fenBefore, m.bestLine) : null;
  const playedRun = m.replyLine ? playLine(Chess, m.fenBefore, [m.uci, ...m.replyLine]) : null;

  const lineFor = (title, ucis) => ({ title, fen: m.fenBefore, ucis: ucis.slice(0, 10), sans: lineToSan(Chess, m.fenBefore, ucis, 10) });
  const outcome = (run, color) => {
    if (!run) return null;
    if (run.mate) return run.loser === color ? 'ends in checkmate against ' + SIDE[color] : 'ends in checkmate';
    return materialPhrase(run.caps, color).text;
  };

  const L = m.label;
  if (L === 'forced') {
    text.push(played.ideas.includes('gets the king out of check') ? 'The king was in check and this was the only legal move.' : 'This was the only legal move.');
    return { text, lines };
  }
  if (L === 'book') {
    text.push(`A known opening move${played.ideas.length ? ' that ' + join(played.ideas) : ''}.`);
    return { text, lines };
  }

  if (L === 'brilliant') {
    text.push(`A real sacrifice: the ${NAME[played.mv.piece]} on ${m.to} can be captured, but taking it is a trap.`);
    if (bestRun) {
      const o = outcome(bestRun, me);
      const r = materialPhrase(bestRun.caps, me);
      if (bestRun.mate && bestRun.loser === them) text.push(`If ${SIDE[them]} accepts, the line ends in checkmate.`);
      else if (r.net >= 0) text.push(`${SIDE[me]} gets the material back with interest: the line ${o || 'leaves ' + SIDE[me] + ' with a strong position'}.`);
      else text.push(`${SIDE[me]} is down material on paper, but Stockfish rates the attack/position as worth more.`);
    }
    if (played.ideas.length) text.push(`The move also ${join(played.ideas)}.`);
    if (m.bestLine?.length) lines.push(lineFor('Show why it works', m.bestLine));
    return { text, lines };
  }

  if (L === 'great') {
    text.push(`The only move that keeps ${SIDE[me]}'s position together. Every other move is clearly worse.`);
    if (played.ideas.length) text.push(`It ${join(played.ideas)}.`);
    if (m.bestLine?.length) lines.push(lineFor('Show the line', m.bestLine));
    return { text, lines };
  }

  if (L === 'best' || L === 'excellent' || L === 'good') {
    const o = outcome(bestRun, me);
    if (L === 'best') {
      text.push(played.ideas.length ? `${cap(join(played.ideas))}.` : 'The strongest move in the position, improving the pieces without allowing anything.');
      if (o && !played.ideas.some((i) => i.includes('checkmate'))) text.push(`Following the best line, ${SIDE[me]} ${o}.`);
      if (m.bestLine?.length) lines.push(lineFor('Show the best line', m.bestLine));
    } else {
      text.push(`A ${L === 'excellent' ? 'very good' : 'decent'} move${played.ideas.length ? ' that ' + join(played.ideas) : ''}.`);
      if (bestSan) text.push(`Slightly stronger was ${bestSan}${best.ideas.length ? ', which ' + join(best.ideas) : ''}.`);
      if (m.bestLine?.length) lines.push(lineFor(`Show ${bestSan || 'best'}`, m.bestLine));
    }
    return { text, lines };
  }

  // ----- inaccuracy / mistake / blunder / miss -----
  const word = { inaccuracy: 'a slight slip', mistake: 'a mistake', blunder: 'a serious blunder', miss: 'a missed chance' }[L];
  let why = null;
  if (playedRun) {
    const reply = playedRun.sans[1];
    if (playedRun.mate && playedRun.loser === me) why = `it allows a forced checkmate, starting with ${reply}`;
    else {
      const hang = played.after ? hangingAfter(played.after, me)[0] : null;
      const r = materialPhrase({ w: playedRun.caps.w, b: playedRun.caps.b }, me);
      if (r.net < 0) why = `after ${reply}, ${SIDE[me]} ${r.text}`;
      else if (hang) why = `it leaves the ${NAME[hang.type]} on ${hang.square} under attack`;
      else if (reply) why = `${SIDE[them]} answers ${reply} and gets the better position`;
    }
  }
  if (L === 'miss' && prev) text.push(`${SIDE[them]}'s last move (${prev.san}) was a mistake, and this move doesn't take advantage of it.`);
  text.push(`${m.san} is ${word}${why ? ': ' + why : ''}.`);
  if (bestSan) {
    // only mention the best line's result when it's good news for the mover
    let gain = '';
    if (bestRun && !best.ideas.some((i) => i.includes('checkmate'))) {
      if (bestRun.mate && bestRun.loser === them) gain = ' and leads to checkmate';
      else { const r = materialPhrase(bestRun.caps, me); if (r.net > 0) gain = `. In that line ${SIDE[me]} ${r.text}`; }
    }
    text.push(`Better was ${bestSan}${best.ideas.length ? ', which ' + join(best.ideas) : ''}${gain}.`);
  }
  if (m.replyLine?.length) lines.push(lineFor(`Show what goes wrong after ${m.san}`, [m.uci, ...m.replyLine]));
  if (m.bestLine?.length) lines.push(lineFor(`Show ${bestSan || 'the best move'}`, m.bestLine));
  return { text, lines };
}

export const _internals = { materialPhrase, forkTargets, pinOrSkewer, mateThreats, playLine, moveIdeas };
