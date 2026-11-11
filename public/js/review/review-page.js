// Game review page: Stockfish checks every move, then we label them and show
// the game with an eval bar, eval graph, best-move arrows and accuracy per player.
import { Chess } from '/vendor/chess.js';
import { Board } from '../board.js';
import { Analyzer } from './analyzer.js';
import { buildGame, classify, LABELS, LABEL_ORDER, fmtScore } from './classify.js';
import { esc, saveForReview } from '../ui.js';

const $ = (id) => document.getElementById(id);

// ---------- which game? ----------
let data = loadSaved();
let game, result, analyses, cur, board, analyzer, runId = 0;
function loadSaved() {
  try { return JSON.parse(localStorage.getItem('chess-review') || 'null'); } catch { return null; }
}

$('loadPgn').onclick = () => {
  const c = new Chess();
  try { c.loadPgn($('pgn').value.trim()); } catch (e) { alert('Could not read that PGN: ' + e.message); return; }
  const h = c.getHeaders();
  const startFen = h.FEN || new Chess().fen();
  data = { startFen, sans: c.history(), white: h.White || 'White', black: h.Black || 'Black', result: h.Result || '', orientation: 'w' };
  saveForReview(data);
  start();
};

if (!data || !data.sans?.length) {
  $('progText').textContent = 'No game to review yet. Finish a game and press "Game review", or paste a PGN below.';
  document.querySelector('details').open = true;
} else start();


function labelOf(p) {
  if (data.labels && data.labels[p.ply]) return data.labels[p.ply];
  return p.color === 'w' ? data.white : data.black;
}

function start() {
  game = buildGame(Chess, data.startFen, data.sans);
  analyses = [];
  result = classify(game, analyses, labelOf);
  cur = game.plies.length - 1;
  if (!board) {
    board = new Board($('board'));
    $('first').onclick = () => go(-1);
    $('prev').onclick = () => go(cur - 1);
    $('next').onclick = () => go(cur + 1);
    $('last').onclick = () => go(game.plies.length - 1);
    $('flip').onclick = () => { board.flip(); show(); };
    $('rerun').onclick = () => run(+$('depth').value);
    $('graph').onclick = (e) => {
      const r = $('graph').getBoundingClientRect();
      go(Math.round(((e.clientX - r.left) / r.width) * game.plies.length) - 1);
    };
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (e.key === 'ArrowLeft') go(cur - 1);
      else if (e.key === 'ArrowRight') go(cur + 1);
      else if (e.key === 'Home') go(-1);
      else if (e.key === 'End') go(game.plies.length - 1);
      else return;
      e.preventDefault();
    });
  }
  board.setOrientation(data.orientation || 'w');
  $('title').textContent = `Game review · ${data.white} vs ${data.black}${data.result ? ' · ' + data.result : ''}`;
  renderMoveList();
  show();
  run(+$('depth').value);
}

const go = (i) => { cur = Math.max(-1, Math.min(game.plies.length - 1, i)); show(); };

// ---------- analysis ----------
function cacheKey(depth) {
  const s = depth + '|' + data.startFen + '|' + data.sans.join(' ');
  let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return 'chess-review-cache:' + h;
}

async function run(depth) {
  const my = ++runId;
  const key = cacheKey(depth);
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* ignore */ }
  const positions = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  if (cached && cached.length === positions.length) {
    analyses = cached;
    finish('Loaded saved review.');
    return;
  }
  analyses = [];
  if (!analyzer) analyzer = new Analyzer();
  $('progWrap').classList.remove('hidden');
  $('rerun').disabled = true;
  const t0 = Date.now();
  for (let i = 0; i < positions.length; i++) {
    if (my !== runId) return;
    const c = new Chess(positions[i]);
    if (c.isCheckmate()) analyses[i] = { terminal: 'mate' };
    else if (c.isGameOver()) analyses[i] = { terminal: 'draw' };
    else {
      const a = await analyzer.analyze(positions[i], depth);
      if (my !== runId) return;
      a.lines = a.lines.map((l) => ({ score: l.score, pv: l.pv.slice(0, 8) }));
      analyses[i] = a;
    }
    $('prog').style.width = `${((i + 1) / positions.length) * 100}%`;
    $('progText').textContent = `Stockfish is checking move ${Math.ceil(i / 2) || 1} of ${Math.ceil(game.plies.length / 2)}… (depth ${depth})`;
    if (i % 4 === 0 || i === positions.length - 1) { result = classify(game, analyses, labelOf); renderMoveList(); renderSummary(); show(); }
  }
  try { localStorage.setItem(key, JSON.stringify(analyses)); } catch { /* storage full: fine */ }
  finish(`Checked ${positions.length - 1} moves in ${((Date.now() - t0) / 1000).toFixed(0)}s at depth ${depth}.`);
}

function finish(msg) {
  result = classify(game, analyses, labelOf);
  $('prog').style.width = '100%';
  $('progText').textContent = msg + ' Use Deep for an even more accurate check.';
  $('rerun').disabled = false;
  $('rerun').textContent = 'Re-check';
  renderMoveList(); renderSummary(); show();
}

// ---------- drawing ----------
const ico = (k) => `<span class="ico" style="background:${LABELS[k].color}">${LABELS[k].icon}</span>`;

function renderSummary() {
  const names = Object.keys(result.players);
  const el = $('summary');
  el.style.setProperty('--cols', names.length || 1);
  if (!names.length) { el.innerHTML = ''; return; }
  let html = `<div></div>${names.map((n) => `<div class="h" title="${esc(n)}">${esc(n)}</div>`).join('')}`;
  html += `<div class="lab">Accuracy</div>${names.map((n) => `<div class="acc">${result.players[n].accuracy.toFixed(1)}</div>`).join('')}`;
  for (const k of LABEL_ORDER) {
    html += `<div class="lab">${ico(k)} ${LABELS[k].name}</div>` +
      names.map((n) => `<div class="n" style="color:${result.players[n].counts[k] ? LABELS[k].color : 'var(--muted)'}">${result.players[n].counts[k]}</div>`).join('');
  }
  el.innerHTML = html;
}

function renderMoveList() {
  const first = new Chess(game.startFen);
  let no = first.moveNumber();
  const rows = [];
  let row = null;
  game.plies.forEach((p, i) => {
    if (p.color === 'w' || !row) { row = { no: no, w: null, b: null }; rows.push(row); }
    if (p.color === 'w') row.w = i; else { row.b = i; no++; }
  });
  const cell = (i) => {
    if (i === null) return '<span></span>';
    const m = result.moves[i] || game.plies[i];
    const who = data.labels ? `<span class="who">${esc((data.labels[i] || '').split(' ')[0])}</span>` : '';
    return `<span class="m${i === cur ? ' cur' : ''}" data-i="${i}">${m.label ? ico(m.label) : ''}${esc(m.san)}${who}</span>`;
  };
  $('moves').innerHTML = rows.map((r) => `<div class="r"><span class="n">${r.no}.</span>${cell(r.w)}${cell(r.b)}</div>`).join('');
  $('moves').querySelectorAll('.m').forEach((el) => (el.onclick = () => go(+el.dataset.i)));
}

function uciToSan(fen, uci) {
  try { return new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san; } catch { return uci; }
}

function show() {
  if (!game) return;
  const p = cur >= 0 ? game.plies[cur] : null;
  const m = cur >= 0 ? result.moves[cur] : null;
  const fen = p ? p.fenAfter : game.startFen;
  board.setPosition(fen, { lastMove: p ? { from: p.from, to: p.to } : null });

  // arrows + badge
  const arrows = [];
  const quiet = ['best', 'brilliant', 'great', 'book', 'forced'];
  if (m && m.label && !quiet.includes(m.label) && m.bestUci) arrows.push({ from: m.bestUci.slice(0, 2), to: m.bestUci.slice(2, 4), color: 'green' });
  board.setDecor({ arrows, badge: m && m.label ? { sq: p.to, icon: LABELS[m.label].icon, color: LABELS[m.label].color } : null });

  // names next to the board
  const top = board.orientation === 'w' ? data.black : data.white;
  const bot = board.orientation === 'w' ? data.white : data.black;
  $('topName').innerHTML = `<span class="name">${esc(top)}</span>`;
  $('bottomName').innerHTML = `<span class="name">${esc(bot)}</span>`;

  // eval bar (white's share from the bottom when White is at the bottom)
  const a = analyses[cur + 1];
  const w = result.evalCurve[cur + 1];
  const whitePct = w == null ? 50 : w;
  $('evalbar').style.transform = board.orientation === 'w' ? '' : 'rotate(180deg)';
  $('evalWhite').style.height = whitePct + '%';
  let scoreTxt = '';
  if (a?.terminal === 'mate') scoreTxt = '#';
  else if (a?.terminal === 'draw') scoreTxt = '½';
  else if (a?.lines?.[0]) scoreTxt = fmtScore(a.lines[0].score, new Chess(fen).turn()).replace('+', '');
  const whiteAhead = whitePct >= 50;
  $('evalTop').textContent = whiteAhead ? '' : scoreTxt;
  $('evalBottom').textContent = whiteAhead ? scoreTxt : '';
  $('evalTop').style.transform = $('evalBottom').style.transform = board.orientation === 'w' ? '' : 'rotate(180deg)';

  // comment
  let html;
  if (!p) {
    html = `<b>${esc(data.white)} vs ${esc(data.black)}</b><br>${game.opening ? 'Opening: ' + esc(game.opening) + '<br>' : ''}<span class="small">Use ◀ ▶ or the arrow keys to step through the game.</span>`;
  } else if (!m || !m.label) {
    html = `<b>${esc(p.san)}</b><br><span class="small">Waiting for Stockfish…</span>`;
  } else {
    const L = LABELS[m.label];
    const noTxt = `${Math.floor(p.ply / 2) + new Chess(game.startFen).moveNumber()}${p.color === 'w' ? '.' : '...'}`;
    const article = /^[AEIOU]/.test(L.name) ? 'an' : 'a';
    const extra = {
      brilliant: 'A brilliant sacrifice that still keeps a good position!',
      great: 'The only good move here, well found!',
      book: game.opening ? `Opening theory (${esc(game.opening)}).` : 'Opening theory.',
      forced: 'The only legal move.',
      miss: 'Your opponent just made a mistake, and this move doesn’t take advantage of it.',
    }[m.label] || '';
    let best = '';
    if (!quiet.includes(m.label) && m.bestUci) {
      best = `<br>Best was <b>${esc(uciToSan(p.fenBefore, m.bestUci))}</b> (${fmtScore(m.bestScore, p.color === 'w' ? 'w' : 'b')} for White).`;
    }
    html = `${ico(m.label)} <b style="color:${L.color}">${noTxt} ${esc(p.san)} is ${m.label === 'best' ? 'the best move' : article + ' ' + L.name.toLowerCase() + (m.label === 'book' ? ' move' : '')}</b>` +
      `<span class="small"> · ${esc(m.who)}</span><br>${extra}${best}` +
      `<br><span class="small">Eval after: ${fmtScore(m.playedScore, p.color)} · win chance lost: ${m.loss.toFixed(1)}%</span>`;
  }
  $('comment').innerHTML = html;

  // highlight in move list
  $('moves').querySelectorAll('.m').forEach((el) => el.classList.toggle('cur', +el.dataset.i === cur));
  $('moves').querySelector('.m.cur')?.scrollIntoView({ block: 'nearest' });
  drawGraph();
}

function drawGraph() {
  const svg = $('graph');
  const pts = result.evalCurve;
  const n = Math.max(1, pts.length - 1);
  svg.setAttribute('viewBox', `0 0 ${n} 100`);
  let d = `M0,100`;
  pts.forEach((w, i) => { d += ` L${i},${100 - (w == null ? 50 : w)}`; });
  d += ` L${pts.length - 1},100 Z`;
  let dots = '';
  result.moves.forEach((m, i) => {
    if (['blunder', 'mistake', 'miss', 'brilliant', 'great'].includes(m.label)) {
      const w = pts[i + 1] ?? 50;
      dots += `<line x1="${i + 1}" x2="${i + 1}" y1="${100 - w - 5}" y2="${100 - w + 5}" stroke="${LABELS[m.label].color}" stroke-width="5" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
    }
  });
  svg.innerHTML = `<path d="${d}" fill="#f2f2f2"/><line x1="0" x2="${n}" y1="50" y2="50" stroke="#888" stroke-width="0.5" vector-effect="non-scaling-stroke"/>` +
    `<line x1="${cur + 1}" x2="${cur + 1}" y1="0" y2="100" stroke="var(--accent)" stroke-width="2" vector-effect="non-scaling-stroke"/>${dots}`;
}
