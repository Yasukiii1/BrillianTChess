// Decides which kind of game this page runs.
const params = new URLSearchParams(location.search);

if (params.get('room')) {
  const { startOnline } = await import('./game-online.js');
  startOnline(params.get('room').toUpperCase());
} else {
  const { startLocal } = await import('./game-local.js');
  startLocal({ opp: params.get('opp') || 'rookie-medium', color: params.get('color') === 'b' ? 'b' : 'w' });
}
