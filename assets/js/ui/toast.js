/* Ledger — toast
 *
 * One line, bottom of the screen, gone in a moment. It confirms that something
 * landed; it is never how a problem is explained, and never how a number is
 * reported. aria-live so it is announced without stealing focus.
 */

let timer;

export function toast(message) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => el.classList.remove('show'), 2400);
}
