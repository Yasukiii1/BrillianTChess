import { getName, setName } from './identity.js';

const $ = (id) => document.getElementById(id);
$('name').value = getName();
$('name').addEventListener('input', (e) => setName(e.target.value));

$('playBot').onclick = () => {
  let color = $('color').value;
  if (color === 'r') color = Math.random() < 0.5 ? 'w' : 'b';
  location.href = `/play.html?mode=bot&opp=${$('opp').value}&color=${color}`;
};

async function createRoom(body, errEl) {
  errEl.textContent = '';
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Could not create room');
    location.href = `/play.html?room=${data.code}`;
  } catch (e) {
    errEl.textContent = e.message;
  }
}

$('createBoss').onclick = () => createRoom({ mode: 'boss', bossSkill: +$('boss').value, teamColor: $('teamColor').value }, $('bossErr'));
$('createDuel').onclick = () => createRoom({ mode: 'duel' }, $('duelErr'));
$('join').onclick = () => {
  const code = $('code').value.trim().toUpperCase();
  if (code) location.href = `/play.html?room=${code}`;
};
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('join').click(); });
