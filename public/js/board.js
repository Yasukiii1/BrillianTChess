// The chess board UI. Knows nothing about bots or servers: it shows a position
// and reports your moves through onMove(from, to, promotion).
//
// Features
//  - SVG pieces (cburnett set), 5 colour themes
//  - smooth sliding animation for every move (FLIP-style: pieces are kept as
//    persistent elements and their transform is changed with a CSS transition)
//  - click-click or drag to move, legal-move dots, promotion picker
//  - right-click + drag = arrow, right-click a square = highlight
//      plain = orange, Shift = green, Ctrl = red, Alt = blue. Left-click clears.
//  - premoves like chess.com: while it's not your turn you can queue moves
//    (several in a row). They play in order as soon as it's your turn; if one is
//    illegal it and all later ones are cancelled. Right-click cancels all.
import { Chess } from '/vendor/chess.js';

const FILES = 'abcdefgh';
export const THEMES = {
  green:  'Tournament Green',
  wood:   'Walnut',
  ocean:  'Ocean Slate',
  ember:  'Boss Ember',
  night:  'Midnight',
};
const ANNOT_COLORS = { orange: 'rgba(255,150,20,.85)', green: 'rgba(40,190,90,.85)', red: 'rgba(230,50,50,.85)', blue: 'rgba(40,140,255,.85)' };
const ANIM_MS = 180;

const code = (p) => p.color + p.type.toUpperCase();          // 'wN'
const pieceUrl = (c) => `/pieces/${c}.svg`;
const fileOf = (sq) => FILES.indexOf(sq[0]);
const rankOf = (sq) => +sq[1];

export class Board {
  constructor(el, { onMove, theme } = {}) {
    this.el = el;
    this.onMove = onMove || (() => {});
    this.orientation = 'w';
    this.movableColor = null;   // colour you may move right now (when it's that colour's turn)
    this.premoveColor = null;   // colour you may premove for (while waiting)
    this.chess = new Chess();
    this.lastMove = null;
    this.selected = null;
    this.premoves = [];         // [{from,to,promotion}]
    this.arrows = [];           // [{from,to,color}]
    this.marks = [];            // [{sq,color}]
    this.pieceEls = new Map();  // square -> element (shown on board)
    this.drag = null;
    this.rdrag = null;          // right-button drag (drawing arrows)

    el.classList.add('board');
    el.innerHTML = `
      <div class="b-squares"></div>
      <div class="b-pieces"></div>
      <svg class="b-arrows" viewBox="0 0 8 8" preserveAspectRatio="none"></svg>
      <div class="promo hidden"></div>`;
    this.sqLayer = el.querySelector('.b-squares');
    this.pcLayer = el.querySelector('.b-pieces');
    this.svg = el.querySelector('.b-arrows');
    this.promoEl = el.querySelector('.promo');
    for (let i = 0; i < 64; i++) this.sqLayer.appendChild(document.createElement('div'));

    this.setTheme(theme || Board.savedTheme(), !theme);

    el.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#moveEvt(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('resize', () => this.render({ animate: false }));
    this.render({ animate: false });
  }

  // ---------- public API ----------
  static savedTheme() { try { return localStorage.getItem('chess-theme') || 'green'; } catch { return 'green'; } }
  setTheme(t, persist = true) {
    if (!THEMES[t]) t = 'green';
    this.el.dataset.theme = t;
    if (persist) try { localStorage.setItem('chess-theme', t); } catch { /* ignore */ }
  }

  /**
   * movableColor: colour you control if it's its turn now (null = view only)
   * premoveColor: colour you may queue premoves for while waiting (null = off)
   */
  setPosition(fen, { lastMove = null, movableColor = null, premoveColor = null, animate = true } = {}) {
    const changed = fen !== this.chess.fen();
    this.chess.load(fen);
    this.lastMove = lastMove;
    this.movableColor = movableColor;
    this.premoveColor = premoveColor;
    if (changed) this.selected = null;
    if (!premoveColor && !movableColor) this.premoves = [];
    this.render({ animate });
    this.#maybePlayPremove();
  }

  setOrientation(color) {
    if (this.orientation === color) return;
    this.orientation = color;
    this.render({ animate: false });
  }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }
  clearPremoves() { if (this.premoves.length) { this.premoves = []; this.render(); } }
  clearAnnotations() { if (this.arrows.length || this.marks.length) { this.arrows = []; this.marks = []; this.#drawArrows(); this.#paintSquares(); } }

  // Static display: show a position with extra decorations (used by the theme gallery).
  showcase({ arrows = [], marks = [], premoves = [], selected = null } = {}) {
    this.arrows = arrows; this.marks = marks; this.premoves = premoves; this.selected = selected;
    this.render({ animate: false });
  }

  // ---------- geometry ----------
  #xy(sq) { // screen column/row (0..7) of a square
    const f = fileOf(sq), r = rankOf(sq);
    return this.orientation === 'w' ? [f, 8 - r] : [7 - f, r - 1];
  }
  #sqAtIndex(i) {
    const c = i % 8, r = Math.floor(i / 8);
    return this.orientation === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1);
  }
  #sqFromPoint(x, y) {
    const b = this.el.getBoundingClientRect();
    const c = Math.floor(((x - b.left) / b.width) * 8), r = Math.floor(((y - b.top) / b.height) * 8);
    if (c < 0 || c > 7 || r < 0 || r > 7) return null;
    return this.#sqAtIndex(r * 8 + c);
  }
  #place(el, sq, animate) {
    const [x, y] = this.#xy(sq);
    el.classList.toggle('anim', !!animate);
    el.style.transform = `translate(${x * 100}%, ${y * 100}%)`;
  }

  // What the board shows = the real position + your queued premoves applied on top.
  #display() {
    const map = new Map();
    for (const row of this.chess.board()) for (const p of row) if (p) map.set(p.square, { type: p.type, color: p.color });
    for (const pm of this.premoves) {
      const p = map.get(pm.from);
      if (!p) continue;
      map.delete(pm.from);
      map.set(pm.to, pm.promotion ? { type: pm.promotion, color: p.color } : p);
      // castling premove: move the rook too
      if (p.type === 'k' && Math.abs(fileOf(pm.to) - fileOf(pm.from)) === 2) {
        const r = pm.from[1], kside = fileOf(pm.to) > fileOf(pm.from);
        const rf = (kside ? 'h' : 'a') + r, rt = (kside ? 'f' : 'd') + r;
        const rook = map.get(rf);
        if (rook) { map.delete(rf); map.set(rt, rook); }
      }
    }
    return map;
  }

  #mode() {
    const turn = this.chess.turn();
    if (this.movableColor && turn === this.movableColor) return 'move';
    if (this.premoveColor) return 'premove'; // e.g. opponent's turn, or your partner's turn in co-op
    return null;
  }

  // ---------- drawing ----------
  render({ animate = true } = {}) {
    this.#paintSquares();
    this.#paintPieces(animate);
    this.#drawArrows();
    this.#drawBadge();
  }

  /** Review mode extras: engine arrows and a move-quality badge on a square. */
  setDecor({ arrows = [], badge = null } = {}) {
    this.arrows = arrows;
    this.badge = badge; // { sq, icon, color }
    this.#drawArrows();
    this.#drawBadge();
  }

  #drawBadge() {
    let el = this.el.querySelector('.b-badge');
    if (!this.badge) { if (el) el.remove(); return; }
    if (!el) { el = document.createElement('div'); el.className = 'b-badge'; this.el.appendChild(el); }
    const [x, y] = this.#xy(this.badge.sq);
    el.style.left = `calc(${(x + 1) * 12.5}% - 3.4%)`;
    el.style.top = `calc(${y * 12.5}% - 1.6%)`;
    el.style.background = this.badge.color;
    el.textContent = this.badge.icon;
  }

  #targets() {
    if (!this.selected) return [];
    return this.#mode() === 'premove' ? this.#premoveDests(this.selected) : this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to);
  }

  #paintSquares() {
    const targets = this.#targets();
    const display = this.#display();
    const checkSq = this.chess.inCheck() ? this.#kingSquare(this.chess.turn()) : null;
    const pmSquares = new Set(this.premoves.flatMap((p) => [p.from, p.to]));
    const markMap = new Map(this.marks.map((m) => [m.sq, m.color]));
    [...this.sqLayer.children].forEach((cell, i) => {
      const name = this.#sqAtIndex(i);
      const light = (fileOf(name) + rankOf(name)) % 2 === 1;
      const cls = ['sq', light ? 'light' : 'dark'];
      if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) cls.push('last');
      if (pmSquares.has(name)) cls.push('pre');
      if (this.selected === name) cls.push('selected');
      if (checkSq === name) cls.push('check');
      if (targets.includes(name)) cls.push(display.has(name) ? 'target capture' : 'target');
      if (markMap.has(name)) cls.push('mark', 'mark-' + markMap.get(name));
      cell.className = cls.join(' ');
      const c = i % 8, r = Math.floor(i / 8);
      cell.innerHTML = (c === 0 ? `<span class="coord rank">${name[1]}</span>` : '') + (r === 7 ? `<span class="coord file">${name[0]}</span>` : '');
    });
  }

  #paintPieces(animate) {
    const display = this.#display();
    const next = new Map();
    const loose = []; // old elements whose piece left their square
    for (const [sq, el] of this.pieceEls) {
      const p = display.get(sq);
      if (p && code(p) === el.dataset.piece) next.set(sq, el);
      else loose.push([sq, el]);
    }
    for (const [sq, p] of display) {
      if (next.has(sq)) continue;
      const c = code(p);
      // re-use the nearest element of the same piece so it slides over
      let best = -1, bestD = Infinity;
      loose.forEach(([osq, el], i) => {
        if (el.dataset.piece !== c) return;
        const d = Math.hypot(fileOf(osq) - fileOf(sq), rankOf(osq) - rankOf(sq));
        if (d < bestD) { bestD = d; best = i; }
      });
      let el;
      if (best >= 0) {
        el = loose.splice(best, 1)[0][1];
        this.#place(el, sq, animate && !(this.dropSq === sq));
      } else {
        el = document.createElement('div');
        el.className = 'pc';
        el.dataset.piece = c;
        el.style.backgroundImage = `url(${pieceUrl(c)})`;
        this.#place(el, sq, false);
        this.pcLayer.appendChild(el);
      }
      next.set(sq, el);
    }
    for (const [, el] of loose) { // captured / removed pieces fade out
      if (animate) { el.classList.add('fade'); setTimeout(() => el.remove(), ANIM_MS); } else el.remove();
    }
    // re-place stationary pieces (needed after flipping the board)
    for (const [sq, el] of next) if (!animate || !el.classList.contains('anim')) this.#place(el, sq, false);
    this.pieceEls = next;
    this.dropSq = null;
    const ghostOf = this.drag?.moved ? this.drag.from : null;
    for (const [sq, el] of next) el.classList.toggle('dragging', sq === ghostOf);
  }

  #kingSquare(color) {
    for (const row of this.chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
    return null;
  }

  // ---------- arrows ----------
  #drawArrows() {
    const list = [...this.arrows];
    if (this.rdrag && this.rdrag.to && this.rdrag.to !== this.rdrag.from) list.push({ from: this.rdrag.from, to: this.rdrag.to, color: this.rdrag.color, preview: true });
    const center = (sq) => { const [x, y] = this.#xy(sq); return [x + 0.5, y + 0.5]; };
    let html = '<defs>' + Object.entries(ANNOT_COLORS).map(([n, c]) =>
      `<marker id="ah-${n}" markerWidth="4" markerHeight="4" refX="2.05" refY="2" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L4,2 L0,4 Z" fill="${c}"/></marker>`).join('') + '</defs>';
    for (const a of list) {
      const [x1, y1] = center(a.from), [x2, y2] = center(a.to);
      const df = Math.abs(fileOf(a.to) - fileOf(a.from)), dr = Math.abs(rankOf(a.to) - rankOf(a.from));
      const pts = [[x1, y1]];
      if ((df === 1 && dr === 2) || (df === 2 && dr === 1)) { // knight: L-shape, long leg first
        pts.push(Math.abs(x2 - x1) > Math.abs(y2 - y1) ? [x2, y1] : [x1, y2]);
      }
      // shorten the end so the arrow head lands in the target square
      const [px, py] = pts[pts.length - 1];
      const len = Math.hypot(x2 - px, y2 - py);
      const end = [x2 - ((x2 - px) / len) * 0.32, y2 - ((y2 - py) / len) * 0.32];
      pts.push(end);
      // start a bit away from the centre of the origin square
      const [nx, ny] = pts[1];
      const l0 = Math.hypot(nx - x1, ny - y1);
      pts[0] = [x1 + ((nx - x1) / l0) * 0.2, y1 + ((ny - y1) / l0) * 0.2];
      html += `<polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="${ANNOT_COLORS[a.color]}" stroke-width="0.17" stroke-linejoin="round" marker-end="url(#ah-${a.color})" opacity="${a.preview ? 0.7 : 1}"/>`;
    }
    this.svg.innerHTML = html;
  }

  #annotColor(e) { return e.shiftKey ? 'green' : e.ctrlKey ? 'red' : e.altKey ? 'blue' : 'orange'; }

  // ---------- premove geometry (where a piece could go, ignoring blockers) ----------
  #premoveDests(sq) {
    const p = this.#display().get(sq);
    if (!p) return [];
    const f = fileOf(sq), r = rankOf(sq), out = [];
    const add = (df, dr) => { const nf = f + df, nr = r + dr; if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(FILES[nf] + nr); };
    const rays = (dirs) => { for (const [a, b] of dirs) for (let k = 1; k < 8; k++) add(a * k, b * k); };
    const dir = p.color === 'w' ? 1 : -1;
    switch (p.type) {
      case 'p': add(0, dir); if (r === (p.color === 'w' ? 2 : 7)) add(0, 2 * dir); add(-1, dir); add(1, dir); break;
      case 'n': for (const [a, b] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) add(a, b); break;
      case 'b': rays([[1, 1], [1, -1], [-1, 1], [-1, -1]]); break;
      case 'r': rays([[1, 0], [-1, 0], [0, 1], [0, -1]]); break;
      case 'q': rays([[1, 1], [1, -1], [-1, 1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]); break;
      case 'k':
        for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (a || b) add(a, b);
        if (sq === (p.color === 'w' ? 'e1' : 'e8')) { add(2, 0); add(-2, 0); }
        break;
    }
    const own = this.#display();
    return out.filter((s) => !(own.get(s) && own.get(s).color === p.color && own.get(s).type === 'k'));
  }

  #maybePlayPremove() {
    if (!this.premoves.length || this.#mode() !== 'move') return;
    const fen = this.chess.fen();
    setTimeout(() => {
      if (this.chess.fen() !== fen || this.#mode() !== 'move' || !this.premoves.length) return;
      const pm = this.premoves[0];
      const legal = this.chess.moves({ square: pm.from, verbose: true }).find((m) => m.to === pm.to && (!m.promotion || m.promotion === (pm.promotion || 'q')));
      if (!legal) { this.premoves = []; this.render(); return; } // illegal now: cancel the whole chain
      this.premoves.shift();
      this.#commit(pm.from, pm.to, legal.promotion);
    }, 60);
  }

  // ---------- input ----------
  #canPick(sq) {
    const mode = this.#mode();
    if (mode === 'move') { const p = this.chess.get(sq); return p && p.color === this.movableColor; }
    if (mode === 'premove') { const p = this.#display().get(sq); return p && p.color === this.premoveColor; }
    return false;
  }
  #targetsFor(from) {
    return this.#mode() === 'premove' ? this.#premoveDests(from) : this.chess.moves({ square: from, verbose: true }).map((m) => m.to);
  }

  #down(e) {
    if (!this.promoEl.classList.contains('hidden')) return;
    const sq = this.#sqFromPoint(e.clientX, e.clientY);
    if (!sq) return;

    if (e.button === 2) { // right button: cancel premoves, start drawing
      e.preventDefault();
      if (this.premoves.length) { this.premoves = []; this.selected = null; this.render(); }
      this.rdrag = { from: sq, to: sq, color: this.#annotColor(e) };
      return;
    }
    if (e.button !== 0) return;
    this.clearAnnotations();

    if (this.selected && this.selected !== sq && this.#targetsFor(this.selected).includes(sq)) {
      this.#finish(this.selected, sq, false);
      return;
    }
    if (this.#canPick(sq)) {
      e.preventDefault();
      const wasSelected = this.selected === sq;
      this.selected = sq;
      this.drag = { from: sq, startX: e.clientX, startY: e.clientY, moved: false, wasSelected };
      this.#paintSquares();
    } else if (this.selected) {
      this.selected = null;
      this.#paintSquares();
    }
  }

  #moveEvt(e) {
    if (this.rdrag) {
      const sq = this.#sqFromPoint(e.clientX, e.clientY);
      if (sq && sq !== this.rdrag.to) { this.rdrag.to = sq; this.#drawArrows(); }
      return;
    }
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 4) return;
    const el = this.pieceEls.get(d.from);
    if (!el) return;
    d.moved = true;
    const b = this.el.getBoundingClientRect(), size = b.width / 8;
    el.classList.remove('anim');
    el.classList.add('dragging');
    el.style.transform = `translate(${e.clientX - b.left - size / 2}px, ${e.clientY - b.top - size / 2}px)`;
    // hover highlight
    const over = this.#sqFromPoint(e.clientX, e.clientY);
    [...this.sqLayer.children].forEach((c, i) => c.classList.toggle('hover', this.#sqAtIndex(i) === over));
  }

  #up(e) {
    if (this.rdrag && e.button === 2) {
      const { from, color } = this.rdrag;
      const to = this.#sqFromPoint(e.clientX, e.clientY) || this.rdrag.to;
      this.rdrag = null;
      if (to === from) {
        const i = this.marks.findIndex((m) => m.sq === from);
        if (i >= 0 && this.marks[i].color === color) this.marks.splice(i, 1);
        else { if (i >= 0) this.marks.splice(i, 1); this.marks.push({ sq: from, color }); }
        this.#paintSquares();
      } else {
        const i = this.arrows.findIndex((a) => a.from === from && a.to === to);
        if (i >= 0 && this.arrows[i].color === color) this.arrows.splice(i, 1);
        else { if (i >= 0) this.arrows.splice(i, 1); this.arrows.push({ from, to, color }); }
      }
      this.#drawArrows();
      return;
    }
    const d = this.drag;
    if (!d || e.button !== 0) return;
    this.drag = null;
    [...this.sqLayer.children].forEach((c) => c.classList.remove('hover'));
    const el = this.pieceEls.get(d.from);
    el?.classList.remove('dragging');
    if (!d.moved) { // a click: second click on the same piece deselects it
      if (d.wasSelected) { this.selected = null; this.#paintSquares(); }
      return;
    }
    const to = this.#sqFromPoint(e.clientX, e.clientY);
    if (to && to !== d.from && this.#targetsFor(d.from).includes(to)) {
      if (el) this.#place(el, to, false); // drop exactly where released, no slide
      this.dropSq = to;
      this.#finish(d.from, to, true);
    } else {
      if (el) this.#place(el, d.from, true); // slide back
      if (to !== d.from) { this.selected = null; this.#paintSquares(); }
    }
  }

  async #finish(from, to) {
    if (this.#mode() === 'premove') {
      const p = this.#display().get(from);
      const promotion = p && p.type === 'p' && (rankOf(to) === 8 || rankOf(to) === 1) ? 'q' : undefined; // auto-queen like chess.com
      // keep the pieceEls map consistent with what's dropped
      if (this.dropSq) { const el = this.pieceEls.get(from); this.pieceEls.delete(from); if (el) { const old = this.pieceEls.get(to); if (old) old.remove(); this.pieceEls.set(to, el); } }
      this.premoves.push({ from, to, promotion });
      this.selected = null;
      this.render();
      return;
    }
    const options = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return;
    let promotion;
    if (options.some((m) => m.promotion)) {
      promotion = await this.#askPromotion(this.chess.turn(), to);
      if (!promotion) { this.selected = null; this.dropSq = null; this.render(); return; }
    }
    this.#commit(from, to, promotion);
  }

  #commit(from, to, promotion) {
    if (this.dropSq) { // the dragged element already sits on `to`: re-key it so it doesn't slide
      const el = this.pieceEls.get(from);
      if (el) { this.pieceEls.delete(from); const old = this.pieceEls.get(to); if (old && old !== el) old.remove(); this.pieceEls.set(to, el); }
    }
    this.selected = null;
    try { this.chess.move({ from, to, promotion }); } catch { this.render(); return; }
    this.lastMove = { from, to };
    this.render();
    this.onMove(from, to, promotion);
  }

  #askPromotion(color, to) {
    return new Promise((resolve) => {
      const el = this.promoEl;
      el.innerHTML = '<div class="promo-box">' + ['q', 'n', 'r', 'b'].map((t) =>
        `<button data-p="${t}" style="background-image:url(${pieceUrl(color + t.toUpperCase())})" aria-label="${t}"></button>`).join('') +
        '<button data-p="" class="promo-cancel">✕</button></div>';
      el.classList.remove('hidden');
      el.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        el.classList.add('hidden');
        el.onclick = null;
        resolve(b.dataset.p || null);
      };
      void to;
    });
  }
}
