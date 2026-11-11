// Game review page: Stockfish checks every move, then we label them and show
// the game with an eval bar, eval graph, best-move arrows and accuracy per player.
import { Chess } from '/vendor/chess.js';
import { Board } from '../board.js';
import { AnalyzerPool } from './analyzer.js';
import { getEval, putEval, flushEvals, reloadEvals } from './cache.js';
import { buildGame, classify, LABELS, LABEL_ORDER, fmtScore } from './classify.js';
import { esc, saveForReview } from '../ui.js';
import { explain } from './coach.js';

const $ = (id) => document.getElementById(id);

// ---------- which game? ----------
let data = loadSaved();
let game, result, analyses, cur, board, pool, runId = 0;
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
    $('first').onclick = () => (vline ? stepLine(-99) : go(-1));
    $('prev').onclick = () => (vline ? stepLine(-1) : go(cur - 1));
    $('next').onclick = () => (vline ? stepLine(1) : go(cur + 1));
    $('last').onclick = () => (vline ? stepLine(99) : go(game.plies.length - 1));
    $('flip').onclick = () => { board.flip(); show(); };
    $('rerun').onclick = () => run(+$('depth').value);
    $('depth').onchange = () => run(+$('depth').value);
    $('graph').onclick = (e) => {
      const r = $('graph').getBoundingClientRect();
      go(Math.round(((e.clientX - r.left) / r.width) * game.plies.length) - 1);
    };
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
      if (vline && e.key === 'ArrowLeft') stepLine(-1);
      else if (vline && e.key === 'ArrowRight') stepLine(1);
      else if (vline && e.key === 'Escape') stopLine();
      else if (e.key === 'ArrowLeft') go(cur - 1);
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

const go = (i) => { if (vline) stopLine(false); cur = Math.max(-1, Math.min(game.plies.length - 1, i)); show(); };

// ---------- analysis ----------
async function run(depth) {
  const my = ++runId;
  if (pool) pool.cancel();
  reloadEvals(); // pick up what the live reviewer saved during the game
  const positions = [game.startFen, ...game.plies.map((p) => p.fenAfter)];
  analyses = positions.map((fen) => {
    const c = new Chess(fen);
    if (c.isCheckmate()) return { terminal: 'mate' };
    if (c.isGameOver()) return { terminal: 'draw' };
    return getEval(fen, depth);
  });
  const missing = analyses.map((a, i) => (a ? -1 : i)).filter((i) => i >= 0);
  const already = analyses.filter((a) => a && !a.terminal).length; // checked earlier (live or saved)
  result = classify(game, analyses, labelOf); renderMoveList(); renderSummary(); show();
  if (!missing.length) {
    finish(`All ${positions.length - 1} moves were already checked by the live reviewer (depth ${depth}+). Instant!`);
    return;
  }
  if (!pool) pool = new AnalyzerPool();
  $('rerun').disabled = true;
  const t0 = Date.now();
  let done = 0, lastDraw = 0;
  const progress = () => {
    $('prog').style.width = `${((already + done) / positions.length) * 100}%`;
    $('progText').textContent = `Stockfish ×${pool.size} checking… ${done} of ${missing.length} positions` +
      (already ? ` (${already} already checked)` : '') + ` · depth ${depth}`;
  };
  progress();
  await Promise.all(missing.map((i) => pool.analyze(positions[i], depth).then((a) => {
    if (my !== runId) return;
    if (a) { analyses[i] = a; putEval(positions[i], a); }
    done++;
    progress();
    if (Date.now() - lastDraw > 400) { lastDraw = Date.now(); result = classify(game, analyses, labelOf); renderMoveList(); renderSummary(); show(); }
  })));
  if (my !== runId) return;
  flushEvals();
  const failed = analyses.filter((a) => !a).length;
  finish(`Checked ${missing.length} positions in ${((Date.now() - t0) / 1000).toFixed(1)}s` +
    (already ? ` (${already} were already checked)` : '') + ` · depth ${depth}.` + (failed ? ` ${failed} failed, press Re-check.` : ''));
}

function finish(msg) {
  result = classify(game, analyses, labelOf);
  $('prog').style.width = '100%';
  $('progText').textContent = msg;
  $('rerun').disabled = false;
  $('rerun').textContent = 'Re-check';
  renderMoveList(); renderSummary(); show();
}

// ---------- drawing ----------
function ico(k) { return `<span class="ico" style="background:${LABELS[k].color}">${LABELS[k].icon}</span>`; }

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

// ---------- line player: plays a coach line on the board ----------
let coachLines = [];
let vline = null; // { title, fens, moves:[{from,to,san}], idx, timer }

function startLine(line) {
  stopLine(false);
  const c = new Chess(line.fen);
  const fens = [c.fen()], moves = [];
  for (const u of line.ucis) {
    let mv;
    try { mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined }); } catch { break; }
    moves.push({ from: mv.from, to: mv.to, san: mv.san, color: mv.color, no: Math.ceil(fens.length / 2) });
    fens.push(c.fen());
  }
  vline = { title: line.title, fens, moves, idx: 0, startNo: new Chess(line.fen).moveNumber(), firstColor: new Chess(line.fen).turn() };
  renderLine();
  // auto-play the line once, one move every 0.9s
  vline.timer = setInterval(() => {
    if (!vline || vline.idx >= vline.moves.length) { if (vline) clearInterval(vline.timer); return; }
    vline.idx++; renderLine();
  }, 900);
}

function stepLine(d) {
  if (!vline) return;
  clearInterval(vline.timer);
  vline.idx = Math.max(0, Math.min(vline.moves.length, vline.idx + d));
  renderLine();
}

function stopLine(redraw = true) {
  if (vline) clearInterval(vline.timer);
  vline = null;
  if (redraw) show();
}

function renderLine() {
  const v = vline;
  const last = v.idx > 0 ? v.moves[v.idx - 1] : null;
  board.setPosition(v.fens[v.idx], { lastMove: last ? { from: last.from, to: last.to } : null });
  const next = v.moves[v.idx];
  board.setDecor({ arrows: next ? [{ from: next.from, to: next.to, color: 'blue' }] : [], badge: null });
  let no = v.startNo;
  const parts = v.moves.map((mv, i) => {
    const prefix = mv.color === 'w' ? `${no}.` : i === 0 ? `${no}...` : '';
    if (mv.color === 'b') no++;
    return `<span class="vm${i === v.idx - 1 ? ' cur' : ''}" data-i="${i + 1}">${prefix}${esc(mv.san)}</span>`;
  });
  $('comment').innerHTML = `<div class="vline-head"><b>▶ ${esc(v.title)}</b><button id="exitLine">✕ Back to game</button></div>` +
    `<div class="vline">${parts.join(' ')}</div>` +
    `<div class="small">Move ${v.idx} of ${v.moves.length} · ◀ ▶ to step · Esc to go back</div>`;
  $('exitLine').onclick = () => stopLine();
  $('comment').querySelectorAll('.vm').forEach((el) => (el.onclick = () => { clearInterval(v.timer); v.idx = +el.dataset.i; renderLine(); }));
}

function show() {
  if (!game || vline) return; // while a coach line is playing, leave the board alone
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
    // The Coach explains why, using the engine's lines
    const ex = explain(Chess, m, result.moves[cur - 1]);
    if (m.label === 'book' && game.opening) ex.text.push(`Opening: ${game.opening}.`);
    coachLines = ex.lines;
    html = `${ico(m.label)} <b style="color:${L.color}">${noTxt} ${esc(p.san)} is ${m.label === 'best' ? 'the best move' : article + ' ' + L.name.toLowerCase() + (m.label === 'book' ? ' move' : '')}</b>` +
      `<span class="small"> · ${esc(m.who)}</span>` +
      `<div class="coach"><span class="coach-tag">Coach</span>${ex.text.map((t) => `<p>${esc(t)}</p>`).join('')}</div>` +
      ex.lines.map((l, i) => `<button class="line-btn" data-line="${i}">▶ ${esc(l.title)}</button><div class="line-san">${esc(l.sans)}</div>`).join('') +
      `<div class="small" style="margin-top:6px">Eval after: ${fmtScore(m.playedScore, p.color)} · win chance lost: ${m.loss.toFixed(1)}%</div>`;
  }
  $('comment').innerHTML = html;
  $('comment').querySelectorAll('.line-btn').forEach((b) => (b.onclick = () => startLine(coachLines[+b.dataset.line])));

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

// ---------- go! (last, so every helper above is defined) ----------
if (!data || !data.sans?.length) {
  $('progText').textContent = 'No game to review yet. Finish a game and press "Game review", or paste a PGN below.';
  document.querySelector('details').open = true;
} else start();
