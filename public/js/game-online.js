// Online rooms: Boss Raid (co-op) and 1v1. The server decides everything; this
// page just shows the server's state and sends your moves.
import { Board } from './board.js';
import { $, esc, renderMoves, setStatus, strip, showBanner, button, themePicker } from './ui.js';
import { getName, setName, getToken } from './identity.js';

export function startOnline(code) {
  let name = getName();
  if (!name) {
    name = (prompt('Your name?') || '').trim() || 'Player';
    setName(name);
  }
  const token = getToken();
  const socket = window.io();
  let state = null;
  let orientedFor = null;      // remember "gameNo:seat" so we only auto-orient once
  let bannerShownFor = 0;

  const board = new Board($('board'), {
    onMove(from, to, promotion) {
      socket.emit('move', { from, to, promotion }, (res) => {
        if (res?.error) flash(res.error);
      });
    },
  });

  themePicker(board);

  // ----- share link -----
  const link = `${location.origin}/play.html?room=${code}`;
  $('shareLink').value = link;
  $('sharePanel').classList.remove('hidden');
  $('copyBtn').onclick = async () => {
    try { await navigator.clipboard.writeText(link); $('copyBtn').textContent = 'Copied!'; }
    catch { $('shareLink').select(); }
    setTimeout(() => ($('copyBtn').textContent = 'Copy'), 1500);
  };

  // ----- controls -----
  const rematchBtn = button('Rematch', () => socket.emit('rematch', null, (r) => r?.error && flash(r.error)), 'primary');
  const resignBtn = button('Resign', () => {
    if (confirm('Resign this game?')) socket.emit('resign', null, (r) => r?.error && flash(r.error));
  });
  $('controls').append(button('Flip', () => { board.flip(); render(); }), resignBtn, rematchBtn);

  // ----- connection -----
  socket.on('connect', () => {
    socket.emit('join', { code, token, name }, (res) => {
      if (res?.error) {
        setStatus(res.error);
        showBanner('Can’t join room', res.error, [{ label: 'Home', primary: true, onClick: () => (location.href = '/') }]);
      }
    });
  });
  socket.on('disconnect', () => setStatus('Connection lost, reconnecting…'));
  socket.on('state', (s) => { state = s; render(); });

  let flashTimer = null;
  function flash(msg) {
    setStatus(msg);
    clearTimeout(flashTimer);
    flashTimer = setTimeout(render, 1500);
  }

  const seatColor = (s, seat) => (s.mode === 'boss' ? s.teamColor : seat === 0 ? 'w' : 'b');
  const colorName = (c) => (c === 'w' ? 'White' : 'Black');

  function render() {
    const s = state;
    if (!s) return;
    const me = s.yourSeat; // 0, 1, or -1 (spectator)
    const myColor = me >= 0 ? seatColor(s, me) : 'w';
    // Orientation: in Boss Raid BOTH teammates always see their team's colour at the bottom.
    // In 1v1 each player sees their own colour at the bottom. (Flip only changes your own screen.)
    const key = `${s.gameNo}:${me}:${myColor}`;
    if (orientedFor !== key) { board.setOrientation(myColor); orientedFor = key; }

    const waitingForPlayers = s.players.some((p) => !p);
    board.setPosition(s.fen, {
      lastMove: s.lastMove,
      movableColor: s.whoMoves === me && me >= 0 ? myColor : null,
      // premoves: allowed whenever you're seated and the game is running
      premoveColor: me >= 0 && !s.result && !waitingForPlayers ? myColor : null,
    });
    if (s.result) board.clearPremoves();
    $('modeLabel').textContent = s.mode === 'boss' ? `Boss Raid vs ${s.bossName} · Room ${s.code}` : `1v1 · Room ${s.code}`;

    const waiting = s.players.some((p) => !p);
    $('sharePanel').classList.toggle('hidden', !waiting);
    resignBtn.disabled = me < 0 || !!s.result || waiting;
    rematchBtn.disabled = me < 0 || !(s.result || s.moves.length === 0) || waiting;

    // ----- player strips -----
    const playerName = (i) => (s.players[i] ? s.players[i].name : 'Waiting…');
    let topInfo, bottomInfo;
    if (s.mode === 'boss') {
      const bossColor = s.teamColor === 'w' ? 'b' : 'w';
      const bossInfo = { name: `${s.bossName}`, tag: `Boss · Stockfish ${s.bossSkill} · ${colorName(bossColor)}`, active: s.whoMoves === 'boss' };
      const teamInfo = {
        name: `${playerName(0)} & ${playerName(1)}`, tag: `Team · ${colorName(s.teamColor)}`,
        active: typeof s.whoMoves === 'number',
      };
      [topInfo, bottomInfo] = board.orientation === s.teamColor ? [bossInfo, teamInfo] : [teamInfo, bossInfo];
    } else {
      const info = (i) => ({ name: playerName(i), tag: colorName(i === 0 ? 'w' : 'b') + (i === me ? ' · you' : ''), dot: !!s.players[i]?.connected, active: s.whoMoves === i });
      [topInfo, bottomInfo] = board.orientation === 'w' ? [info(1), info(0)] : [info(0), info(1)];
    }
    strip($('topStrip'), topInfo);
    strip($('bottomStrip'), bottomInfo);

    // ----- teammates panel (boss mode) -----
    const seatsEl = $('seats');
    if (s.mode === 'boss') {
      seatsEl.classList.remove('hidden');
      seatsEl.innerHTML = [0, 1].map((i) => {
        const p = s.players[i];
        const next = !s.result && s.nextHuman === i;
        return `<div class="player-strip${next ? ' active' : ''}" style="min-height:30px;padding:4px 0">
          <span class="dot ${p?.connected ? 'on' : ''}"></span>
          <span class="name">P${i + 1}: ${esc(p ? p.name : 'empty seat')}</span>
          <span class="tag">${i === me ? 'you' : ''}${next ? (i === me ? ' · moves next' : ' moves next') : ''}</span></div>`;
      }).join('');
    } else {
      seatsEl.classList.add('hidden');
    }

    renderMoves(s.moves, 'w', 1);

    // ----- status line -----
    if (s.result) {
      setStatus(resultText(s, me), 'over');
      if (bannerShownFor !== s.gameNo) {
        bannerShownFor = s.gameNo;
        showBanner(resultTitle(s, me), `${s.result.reason} · ${s.result.result}`, [
          ...(me >= 0 ? [{ label: 'Rematch', primary: true, onClick: () => rematchBtn.click() }] : []),
          { label: 'Look at board' },
        ]);
      }
    } else if (waiting) {
      setStatus(s.mode === 'boss' ? 'Waiting for your partner to join…' : 'Waiting for your opponent…');
    } else if (s.bossThinking || s.whoMoves === 'boss') {
      setStatus(`${s.bossName} is thinking…`, 'boss');
    } else if (s.whoMoves === me) {
      setStatus(s.inCheck ? 'Your move: you are in CHECK!' : 'Your move', 'mine');
    } else if (s.mode === 'boss') {
      setStatus(`${playerName(s.whoMoves)} is moving… (no talking!)`);
    } else {
      setStatus(`${playerName(s.whoMoves)} is thinking…`);
    }
  }

  function resultTitle(s, me) {
    const w = s.result.winner;
    if (!w) return 'Draw';
    if (s.mode === 'boss') return w === 'team' ? `${s.bossName} defeated!` : `${s.bossName} wins`;
    if (me < 0) return w === 'w' ? 'White wins' : 'Black wins';
    return w === seatColor(s, me) ? 'You win!' : 'You lost';
  }
  function resultText(s, me) {
    return `${resultTitle(s, me)} (${s.result.reason})`;
  }
}
