// Rooms and the rules of who may move when. The server is the referee: it holds
// the real game and checks every move, so both players always see the same board.
import { Chess } from 'chess.js';
import { bossMove } from './boss.js';

export const BOSS_NAMES = { 3: 'Goblin', 8: 'Knight Captain', 14: 'Dragon', 20: 'The Final Boss' };
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // forget rooms idle for 6 hours

export class Rooms {
  constructor(io, { bossThink = bossMove } = {}) {
    this.io = io;
    this.bossThink = bossThink;
    this.rooms = new Map();
    setInterval(() => this.#cleanup(), 10 * 60 * 1000).unref();
  }

  create({ mode = 'boss', bossSkill = 14, teamColor = 'w', bossTimeMs = 1000 } = {}) {
    if (!['boss', 'duel'].includes(mode)) throw new Error('Unknown mode');
    bossSkill = Math.max(0, Math.min(20, Math.round(+bossSkill) || 14));
    bossTimeMs = Math.max(200, Math.min(5000, Math.round(+bossTimeMs) || 1000));
    teamColor = teamColor === 'b' ? 'b' : 'w';
    let code;
    do { code = Array.from({ length: 5 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join(''); }
    while (this.rooms.has(code));
    const room = {
      code, mode, bossSkill, bossTimeMs, teamColor,
      bossName: BOSS_NAMES[bossSkill] || `Stockfish ${bossSkill}`,
      seats: [null, null],          // { token, name, socketIds:Set }
      chess: new Chess(),
      moves: [],                    // [{ san, who }]
      lastMove: null,
      nextHuman: 0,                 // boss mode: 0 = P1, 1 = P2
      bossThinking: false,
      result: null,                 // { result, reason, winner }
      gameNo: 1,
      touched: Date.now(),
    };
    this.rooms.set(code, room);
    return room;
  }

  // ---------- socket handlers ----------
  attach(socket) {
    socket.on('join', (data, ack) => this.#safe(ack, () => this.#join(socket, data || {})));
    socket.on('move', (data, ack) => this.#safe(ack, () => this.#move(socket, data || {})));
    socket.on('resign', (_, ack) => this.#safe(ack, () => this.#resign(socket)));
    socket.on('rematch', (_, ack) => this.#safe(ack, () => this.#rematch(socket)));
    socket.on('disconnect', () => this.#leave(socket));
  }

  #safe(ack, fn) {
    const reply = typeof ack === 'function' ? ack : () => {};
    try { reply(fn() || { ok: true }); }
    catch (e) { reply({ error: e.message }); }
  }

  #join(socket, { code, token, name }) {
    const room = this.rooms.get(String(code || '').toUpperCase());
    if (!room) throw new Error('Room not found. Check the code, or the room may have expired.');
    if (!token) throw new Error('Missing player token');
    name = String(name || '').trim().slice(0, 16) || 'Player';

    let seat = room.seats.findIndex((s) => s && s.token === token);
    if (seat === -1) {
      seat = room.seats.findIndex((s) => s === null);
      if (seat !== -1) room.seats[seat] = { token, name, socketIds: new Set() };
    }
    if (seat !== -1) {
      room.seats[seat].name = name;
      room.seats[seat].socketIds.add(socket.id);
    }
    socket.data = { code: room.code, token, seat };
    socket.join(room.code);
    room.touched = Date.now();
    this.broadcast(room);
    this.#maybeBoss(room); // team plays Black -> boss opens once both players are in
    return { ok: true, seat, state: this.publicState(room) }; // seat -1 = spectator
  }

  #leave(socket) {
    const { code, seat } = socket.data || {};
    const room = code && this.rooms.get(code);
    if (!room || seat == null || seat < 0 || !room.seats[seat]) return;
    room.seats[seat].socketIds.delete(socket.id);
    this.broadcast(room);
  }

  #roomFor(socket) {
    const room = this.rooms.get(socket.data?.code);
    if (!room) throw new Error('Not in a room');
    if (socket.data.seat < 0) throw new Error('Spectators cannot do that');
    room.touched = Date.now();
    return room;
  }

  /** Whose turn is it? Returns seat index that may move, 'boss', or null. */
  whoMoves(room) {
    if (room.result) return null;
    if (room.seats.some((s) => s === null)) return null; // waiting for players
    const turn = room.chess.turn();
    if (room.mode === 'duel') return turn === 'w' ? 0 : 1;
    if (turn !== room.teamColor) return 'boss';
    return room.nextHuman;
  }

  #move(socket, { from, to, promotion }) {
    const room = this.#roomFor(socket);
    const seat = socket.data.seat;
    const mover = this.whoMoves(room);
    if (mover !== seat) {
      this.broadcast(room);
      throw new Error(mover === 'boss' ? 'Wait for the Boss' : room.result ? 'Game is over' : mover === null ? 'Waiting for players' : 'Not your turn');
    }
    let mv;
    try { mv = room.chess.move({ from, to, promotion }); }
    catch { this.broadcast(room); throw new Error('Illegal move'); }

    room.moves.push({ san: mv.san, who: room.mode === 'boss' ? `P${seat + 1}` : '' });
    room.lastMove = { from: mv.from, to: mv.to };
    if (room.mode === 'boss') room.nextHuman = 1 - room.nextHuman; // P1 -> P2 -> P1 ...
    this.#checkOver(room);
    this.broadcast(room);
    this.#maybeBoss(room);
  }

  async #maybeBoss(room) {
    if (room.mode !== 'boss' || room.bossThinking || this.whoMoves(room) !== 'boss') return;
    const gameNo = room.gameNo;
    room.bossThinking = true;
    this.broadcast(room);
    let uci;
    try {
      uci = await this.bossThink(room.chess.fen(), { skill: room.bossSkill, movetime: room.bossTimeMs });
    } catch (e) {
      console.error('boss error', e);
    }
    if (room.gameNo !== gameNo || !this.rooms.has(room.code)) return; // rematch happened meanwhile
    room.bossThinking = false;
    if (uci && uci !== '(none)') {
      const mv = room.chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      room.moves.push({ san: mv.san, who: 'Boss' });
      room.lastMove = { from: mv.from, to: mv.to };
      this.#checkOver(room);
    }
    this.broadcast(room);
  }

  #checkOver(room) {
    const c = room.chess;
    let r = null;
    if (c.isCheckmate()) r = { reason: 'checkmate', winnerColor: c.turn() === 'w' ? 'b' : 'w' };
    else if (c.isStalemate()) r = { reason: 'stalemate' };
    else if (c.isThreefoldRepetition()) r = { reason: 'threefold repetition' };
    else if (c.isInsufficientMaterial()) r = { reason: 'insufficient material' };
    else if (c.isDrawByFiftyMoves()) r = { reason: '50-move rule' };
    if (r) room.result = this.#describe(room, r);
  }

  #describe(room, { reason, winnerColor = null }) {
    const result = winnerColor === 'w' ? '1-0' : winnerColor === 'b' ? '0-1' : '½-½';
    let winner = null;
    if (winnerColor) winner = room.mode === 'boss' ? (winnerColor === room.teamColor ? 'team' : 'boss') : winnerColor;
    return { result, reason, winner };
  }

  #resign(socket) {
    const room = this.#roomFor(socket);
    if (room.result) return;
    const seat = socket.data.seat;
    const myColor = room.mode === 'boss' ? room.teamColor : seat === 0 ? 'w' : 'b';
    room.result = this.#describe(room, { reason: `${room.seats[seat].name} resigned`, winnerColor: myColor === 'w' ? 'b' : 'w' });
    this.broadcast(room);
  }

  #rematch(socket) {
    const room = this.#roomFor(socket);
    if (!room.result && room.moves.length > 0) throw new Error('Finish or resign the current game first');
    room.chess = new Chess();
    room.moves = [];
    room.lastMove = null;
    room.result = null;
    room.bossThinking = false;
    room.gameNo++;
    if (room.mode === 'boss') {
      // P1 and P2 swap who opens, so both get to lead.
      room.nextHuman = (room.gameNo - 1) % 2;
    } else {
      // swap colors in 1v1
      room.seats.reverse();
      for (const s of this.io.sockets.sockets.values()) {
        if (s.data?.code === room.code && s.data.seat >= 0) s.data.seat = 1 - s.data.seat;
      }
    }
    this.broadcast(room);
    this.#maybeBoss(room);
  }

  // ---------- state sent to browsers (no secret tokens) ----------
  publicState(room) {
    return {
      code: room.code,
      mode: room.mode,
      fen: room.chess.fen(),
      lastMove: room.lastMove,
      moves: room.moves,
      inCheck: room.chess.inCheck(),
      players: room.seats.map((s) => s && { name: s.name, connected: s.socketIds.size > 0 }),
      whoMoves: this.whoMoves(room),
      nextHuman: room.nextHuman,
      teamColor: room.teamColor,
      bossName: room.bossName,
      bossSkill: room.bossSkill,
      bossThinking: room.bossThinking,
      result: room.result,
      gameNo: room.gameNo,
    };
  }

  broadcast(room) {
    // Each socket gets its own seat number too (it can change after a 1v1 rematch).
    const state = this.publicState(room);
    for (const s of this.io.sockets.sockets.values()) {
      if (s.data?.code === room.code) s.emit('state', { ...state, yourSeat: s.data.seat });
    }
  }

  #cleanup() {
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      const online = room.seats.some((s) => s && s.socketIds.size > 0);
      if (!online && now - room.touched > ROOM_TTL_MS) this.rooms.delete(code);
    }
  }
}
