// Remembers who you are so a refresh puts you back in your seat.
// The player token lives in sessionStorage: it survives a refresh of the same tab,
// but every new tab is a new player (handy for testing both seats on one PC).
// The name lives in localStorage so you only type it once.
function get(store, k) { try { return window[store].getItem(k); } catch { return null; } }
function set(store, k, v) { try { window[store].setItem(k, v); } catch { /* private mode */ } }

let memToken = null;
export function getToken() {
  let t = get('sessionStorage', 'chess-token') || memToken;
  if (!t) {
    t = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
    set('sessionStorage', 'chess-token', t);
    memToken = t;
  }
  return t;
}
export const getName = () => get('localStorage', 'chess-name') || '';
export const setName = (n) => set('localStorage', 'chess-name', n.trim().slice(0, 16));
