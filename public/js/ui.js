// Small helpers shared by the local and online game pages.
export const $ = (id) => document.getElementById(id);

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// moves: [{san, who?}] in order from the start position. firstColor: who moved first.
export function renderMoves(moves, firstColor = 'w', startMoveNo = 1) {
  const el = $('moves');
  const rows = [];
  let i = 0, n = startMoveNo;
  const cell = (m) => m ? `${esc(m.san)}${m.who ? `<span class="who">${esc(m.who)}</span>` : ''}` : '';
  if (firstColor === 'b' && moves.length) { rows.push([n++, null, moves[0]]); i = 1; }
  for (; i < moves.length; i += 2) rows.push([n++, moves[i], moves[i + 1]]);
  el.innerHTML = rows.map(([no, w, b]) => `<div class="mv"><span class="n">${no}.</span><span>${w ? cell(w) : '…'}</span><span>${cell(b)}</span></div>`).join('');
  el.scrollTop = el.scrollHeight;
}

export function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = 'status' + (kind ? ' ' + kind : '');
}

export function strip(el, { name, tag = '', dot = null, active = false }) {
  el.className = 'player-strip' + (active ? ' active' : '');
  el.innerHTML = `${dot === null ? '' : `<span class="dot ${dot ? 'on' : ''}"></span>`}<span class="name">${esc(name)}</span><span class="tag">${esc(tag)}</span>`;
}

export function showBanner(title, text, buttons = []) {
  $('bannerTitle').textContent = title;
  $('bannerText').textContent = text;
  const box = $('bannerButtons');
  box.innerHTML = '';
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.textContent = b.label;
    if (b.primary) btn.className = 'primary';
    btn.onclick = () => { hideBanner(); b.onClick && b.onClick(); };
    box.appendChild(btn);
  }
  $('banner').classList.remove('hidden');
}
export const hideBanner = () => $('banner').classList.add('hidden');

export function button(label, onClick, cls = '') {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.onclick = onClick;
  return b;
}

// Describe how a chess.js game ended.
export function gameOverReason(chess) {
  if (chess.isCheckmate()) return { result: chess.turn() === 'w' ? '0-1' : '1-0', reason: 'checkmate', winner: chess.turn() === 'w' ? 'b' : 'w' };
  if (chess.isStalemate()) return { result: '½-½', reason: 'stalemate', winner: null };
  if (chess.isThreefoldRepetition()) return { result: '½-½', reason: 'threefold repetition', winner: null };
  if (chess.isInsufficientMaterial()) return { result: '½-½', reason: 'insufficient material', winner: null };
  if (chess.isDrawByFiftyMoves()) return { result: '½-½', reason: '50-move rule', winner: null };
  return null;
}
