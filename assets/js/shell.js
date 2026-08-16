/* Ledger — shell
 *
 * Masthead, drawer nav, tab routing, and the modal mounts.
 *
 * There is no persistent tab bar; the drawer is the only navigation. The loan
 * is not a tab — selecting it opens a modal, as does clicking the loan row in
 * the week view, so it is reachable from both without being a place you can
 * get stranded in.
 */

import { today, MFULL, DW, MN, dayIndex, isPayday } from './dates.js';

export const TABS = [
  ['cal',   'Calendar',    '\u{1F4C5}'],
  ['ru',    'Round-up',    '\u{1FA99}'],
  ['cards', 'Which card',  '\u{1F4B3}'],
  ['pb',    'Paybacks',    '\u{1F501}'],
  ['stmt',  'Statements',  '\u{1F4C4}'],
  ['loan',  'The loan',    '\u{1F3E6}'],
];

let active = 'cal';

/* The masthead word tracks context: the month being viewed on Calendar, the
 * section name everywhere else. Calendar sets this itself once it can navigate
 * months; until then it is the real current month. */
export function setMastWord(word) {
  const el = document.getElementById('mastWord');
  if (el) el.textContent = word;
}

export function currentTab() { return active; }

export function goTab(k) {
  active = k;
  const tab = TABS.find(t => t[0] === k);
  setMastWord(k === 'cal' ? MFULL[today().getMonth()].toUpperCase() : tab[1].toUpperCase());
  document.querySelectorAll('.tab').forEach(s => { s.hidden = s.id !== 't-' + k; });
  paintNav();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* Counts are passed in rather than read from here, so the shell never has to
 * know what a payback is. Nothing supplies them yet — the tabs that own those
 * numbers are not built. */
let counts = {};
export function setNavCounts(next) { counts = next || {}; paintNav(); }

export function paintNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;

  nav.innerHTML = TABS.map(([k, label, emoji]) => {
    const n = counts[k];
    const badge = n ? `<span class="b${k === 'stmt' ? ' on' : ''}">${n}</span>` : '';
    return `<button role="tab" aria-selected="${k === active}" data-t="${k}">` +
      `<span class="em" aria-hidden="true">${emoji}</span>${label}${badge}</button>`;
  }).join('');

  nav.querySelectorAll('button').forEach(b => {
    b.onclick = () => {
      closeDrawer();
      if (b.dataset.t === 'loan') openLoan(); else goTab(b.dataset.t);
    };
  });

  const where = document.getElementById('mastWhere');
  if (where) where.textContent = (TABS.find(t => t[0] === active) || ['', ''])[1].toUpperCase();

  const meta = document.getElementById('mastMeta');
  if (meta) {
    const t = today();
    meta.innerHTML = DW[dayIndex(t)] + ' ' + t.getDate() + ' ' + MN[t.getMonth()].toUpperCase() +
      (isPayday(t) ? ' &middot; <b>payday \u{1F4B8}</b>' : '');
  }
}

/* ---------------------------------------------------------------- drawer */

function drawer() { return document.getElementById('drawer'); }

export function openDrawer() {
  drawer().hidden = false;
  document.getElementById('brandBtn').setAttribute('aria-expanded', 'true');
  drawer().querySelector('.dnav button')?.focus();
}

export function closeDrawer() {
  drawer().hidden = true;
  document.getElementById('brandBtn').setAttribute('aria-expanded', 'false');
}

/* ---------------------------------------------------------------- the loan */

/* A modal, not a page. The prototype read its content out of a hidden section;
 * here it is one component the modal mounts — which is what lets the week
 * view's loan row open the same thing without duplicating any of it. */
let loanContent = () => `<div class="soon">
    <div class="t">Not built yet</div>
    <div class="b">Every figure here derives from logged payments — balance, payoff
      projection, interest avoided, months erased, the principal and interest split.
      None of it is hardcoded, so there is nothing honest to show until the table
      exists. The first payment posts September 5, 2026.</div>
    <div class="step">Build order · step 9</div>
  </div>`;

export function setLoanContent(fn) { loanContent = fn; }

export function openLoan() {
  document.getElementById('loanModal').innerHTML = `
    <div class="mhead">
      <div class="dmeta">
        <div class="dow">SoFi consolidation</div>
        <div class="dfull">The loan</div>
      </div>
      <button class="mclose" id="loanX" aria-label="Close">&times;</button>
    </div>
    <div class="lbody">${loanContent()}</div>`;
  document.getElementById('loanScrim').hidden = false;
  document.getElementById('loanX').onclick = closeLoan;
}

export function closeLoan() {
  document.getElementById('loanScrim').hidden = true;
}

/* ---------------------------------------------------------------- wiring */

export function initShell() {
  document.getElementById('brandBtn').onclick = () =>
    drawer().hidden ? openDrawer() : closeDrawer();
  document.getElementById('drawerX').onclick = closeDrawer;
  document.getElementById('drawerScrim').onclick = closeDrawer;

  document.getElementById('loanScrim').addEventListener('click', e => {
    if (e.target.id === 'loanScrim') closeLoan();
  });

  /* The pickers claim Escape first, in the capture phase, so a picker open
     inside a modal closes only itself. By the time it reaches here, nothing
     smaller is open. */
  /* The day modal's own scrim and Escape handling live here so the calendar
     screen doesn't have to own global listeners. */
  document.getElementById('scrim').addEventListener('click', e => {
    if (e.target.id === 'scrim') document.getElementById('scrim').hidden = true;
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    closeDrawer();
    closeLoan();
    const scrim = document.getElementById('scrim');
    if (scrim) scrim.hidden = true;
  });

  goTab('cal');
}
