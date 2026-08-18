/* Ledger mobile — toast. Same pattern as desktop's ui/toast.js, targeting the
 * mobile shell's own #mtoast element (the desktop one lives outside this page). */

let timer;

export function toast(message) {
  const el = document.getElementById('mtoast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 2400);
}
