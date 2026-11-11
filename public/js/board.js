// A chess board you can click or drag pieces on. Knows nothing about bots or
// servers: it shows a position and reports moves through onMove(from, to, promo).
import { Chess } from '/vendor/chess.js';

// ︎ forces text style (stops phones turning the pawn into an emoji).
const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

export class Board {
  constructor(el, { onMove } = {}) {
    this.el = el;
    this.onMove = onMove || (() => {});
    this.orientation = 'w';
    this.movableColor = null; // 'w' | 'b' | null (no moves allowed)
    this.fen = new Chess().fen();
    this.chess = new Chess();
    this.lastMove = null;
    this.selected = null;
    this.drag = null;

    el.classList.add('board');
    this.squares = {};
    for (let i = 0; i < 64; i++) {
      const sq = document.createElement('div');
      sq.className = 'sq';
      el.appendChild(sq);
    }
    this.promoEl = document.createElement('div');
    this.promoEl.className = 'promo hidden';
    el.appendChild(this.promoEl);

    el.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', (e) => this.#up(e));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    this.render();
  }

  setPosition(fen, { lastMove = null, movableColor = null } = {}) {
    this.fen = fen;
    this.chess.load(fen);
    this.lastMove = lastMove;
    this.movableColor = movableColor;
    this.selected = null;
    this.render();
  }

  setOrientation(color) { this.orientation = color; this.render(); }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  // ---------- drawing ----------
  #squareAt(index) { // index 0..63 in screen order -> 'e4'
    const r = Math.floor(index / 8), c = index % 8;
    return this.orientation === 'w' ? FILES[c] + (8 - r) : FILES[7 - c] + (r + 1);
  }

  render() {
    const targets = this.selected ? this.chess.moves({ square: this.selected, verbose: true }).map((m) => m.to) : [];
    const checkSq = this.chess.inCheck() ? this.#kingSquare(this.chess.turn()) : null;
    const cells = this.el.querySelectorAll('.sq');
    this.squares = {};
    cells.forEach((cell, i) => {
      const name = this.#squareAt(i);
      this.squares[name] = cell;
      cell.dataset.sq = name;
      const fileIdx = FILES.indexOf(name[0]), rank = +name[1];
      const cls = ['sq', (fileIdx + rank) % 2 === 0 ? 'light' : 'dark'];
      if (this.lastMove && (this.lastMove.from === name || this.lastMove.to === name)) cls.push('last');
      if (this.selected === name) cls.push('selected');
      if (checkSq === name) cls.push('check');
      const piece = this.chess.get(name);
      if (targets.includes(name)) cls.push(piece ? 'target capture' : 'target');
      cell.className = cls.join(' ');

      let html = '';
      if (piece) {
        const draggingThis = this.drag && this.drag.from === name && this.drag.moved;
        html += `<span class="piece ${piece.color === 'w' ? 'white' : 'black'}${draggingThis ? ' ghosted' : ''}">${GLYPH[piece.type]}︎</span>`;
      }
      // coordinates on the edge squares
      const r = Math.floor(i / 8), c = i % 8;
      if (c === 0) html += `<span class="coord rank">${name[1]}</span>`;
      if (r === 7) html += `<span class="coord file">${name[0]}</span>`;
      cell.innerHTML = html;
    });
  }

  #kingSquare(color) {
    for (const row of this.chess.board()) for (const p of row) if (p && p.type === 'k' && p.color === color) return p.square;
    return null;
  }

  // ---------- input ----------
  #canPick(name) {
    const p = this.chess.get(name);
    return p && this.movableColor && p.color === this.movableColor && this.chess.turn() === this.movableColor;
  }

  #sqFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest('.sq');
    return cell && this.el.contains(cell) ? cell.dataset.sq : null;
  }

  #down(e) {
    if (e.button !== 0 || !this.promoEl.classList.contains('hidden')) return;
    const name = this.#sqFromPoint(e.clientX, e.clientY);
    if (!name) return;

    // Clicking a highlighted target finishes a click-click move.
    if (this.selected && this.selected !== name && this.#isTarget(this.selected, name)) {
      this.#tryMove(this.selected, name);
      return;
    }
    if (this.#canPick(name)) {
      e.preventDefault();
      this.selected = name;
      this.drag = { from: name, startX: e.clientX, startY: e.clientY, moved: false, ghost: null };
      this.render();
    } else {
      this.selected = null;
      this.render();
    }
  }

  #move(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 5) return;
    if (!d.moved) {
      d.moved = true;
      const p = this.chess.get(d.from);
      const size = this.el.getBoundingClientRect().width / 8;
      d.ghost = document.createElement('span');
      d.ghost.className = `piece drag-ghost ${p.color === 'w' ? 'white' : 'black'}`;
      d.ghost.textContent = GLYPH[p.type] + '︎';
      d.ghost.style.width = d.ghost.style.height = size + 'px';
      d.ghost.style.fontSize = size * 0.8 + 'px';
      document.body.appendChild(d.ghost);
      this.render();
    }
    const size = parseFloat(d.ghost.style.width);
    d.ghost.style.left = e.clientX - size / 2 + 'px';
    d.ghost.style.top = e.clientY - size / 2 + 'px';
  }

  #up(e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    if (d.ghost) d.ghost.remove();
    if (!d.moved) { this.render(); return; } // it was a click: keep the piece selected
    const to = this.#sqFromPoint(e.clientX, e.clientY);
    if (to && to !== d.from && this.#isTarget(d.from, to)) this.#tryMove(d.from, to);
    else this.render();
  }

  #isTarget(from, to) {
    return this.chess.moves({ square: from, verbose: true }).some((m) => m.to === to);
  }

  async #tryMove(from, to) {
    const options = this.chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
    if (!options.length) return;
    let promotion;
    if (options.some((m) => m.promotion)) {
      promotion = await this.#askPromotion(this.chess.turn());
      if (!promotion) { this.selected = null; this.render(); return; }
    }
    this.selected = null;
    // Show the move straight away; the controller can overwrite with setPosition.
    this.chess.move({ from, to, promotion });
    this.lastMove = { from, to };
    this.render();
    this.onMove(from, to, promotion);
  }

  #askPromotion(color) {
    return new Promise((resolve) => {
      const el = this.promoEl;
      el.innerHTML = '<div class="promo-box">' + ['q', 'r', 'b', 'n'].map((t) =>
        `<button data-p="${t}" class="piece ${color === 'w' ? 'white' : 'black'}">${GLYPH[t]}︎</button>`).join('') +
        '<button data-p="" class="promo-cancel">✕</button></div>';
      el.classList.remove('hidden');
      el.onclick = (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        el.classList.add('hidden');
        el.onclick = null;
        resolve(b.dataset.p || null);
      };
    });
  }
}
