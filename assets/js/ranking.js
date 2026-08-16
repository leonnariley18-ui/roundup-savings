/* Ledger — which card to use
 *
 * Pure functions over card rows. No DOM, no database.
 *
 * A single additive score, never a comparator with conditional overrides. An
 * earlier version compared pairs with special cases and was non-transitive —
 * A beat B, B beat C, C beat A — and JavaScript's sort is free to produce
 * anything at all from that. One number per card cannot do it.
 */

import { POINT_CENTS } from './config.js';
import { calc } from './statements.js';

/* Points are converted at POINT_CENTS, so Wells Fargo's 3x reads as 3%. */
export const effectivePct = (value, unit) =>
  unit === 'points' ? Number(value) * POINT_CENTS : Number(value);

/* Blends a bonus rate across a quarterly cap boundary.
 *
 * Takes the amount already spent rather than a yes/no, even though the UI only
 * ever passes 0 or the whole cap. Tracking real spend in an app that never sees
 * the spending is double entry and gets abandoned, so the checkbox is the right
 * interface — but the maths should be correct for any input, and it is the part
 * worth testing directly. */
export function blendedRate(bonusPct, basePct, amount, capLimit, spentThisQuarter = 0) {
  if (capLimit == null) return { pct: bonusPct, capHit: false, capLeft: null };

  const left = Math.max(0, capLimit - spentThisQuarter);
  if (left <= 0) return { pct: basePct, capHit: true, capLeft: 0 };
  if (!amount || amount <= left) return { pct: bonusPct, capHit: false, capLeft: left };

  const blended = (left * bonusPct + (amount - left) * basePct) / amount;
  return { pct: blended, capHit: true, capLeft: left };
}

/* What a card pays on a category.
 *
 * `rewards` are that card's card_rewards rows; a row with category null is the
 * base rate. `chosenCategory` is BofA's switchable 3% slot, which lives in its
 * own table because it is a choice with a history, not a property of the card.
 *
 * A card with no rows at all earns nothing automatically — that is PayPal and
 * Amex Blue Cash, whose rewards come only from offers activated elsewhere. */
export function rewardFor(card, rewards = [], chosenCategory = null, category, amount = 0) {
  const base = rewards.find(r => r.category == null) || null;
  let row = rewards.find(r => r.category === category) || null;
  let chosen = false;

  if (!row && chosenCategory && category === chosenCategory) {
    row = { value: 3, unit: 'pct', counts_toward_cap: true, label_note: null };
    chosen = true;
  }
  if (!row) row = base;

  if (!row) {
    return { pct: 0, nominal: 0, text: '—', row: null, chosen: false,
             capHit: false, capLeft: null, offersOnly: true };
  }

  const nominal = effectivePct(row.value, row.unit);
  const basePct = base ? effectivePct(base.value, base.unit) : 1;
  const capLimit = card.cap_limit == null ? null : Number(card.cap_limit);
  const spent = card.cap_blown ? (capLimit || 0) : 0;

  const { pct, capHit, capLeft } = row.counts_toward_cap
    ? blendedRate(nominal, basePct, amount, capLimit, spent)
    : { pct: nominal, capHit: false, capLeft: null };

  return {
    pct, nominal, row, chosen, capHit, capLeft,
    offersOnly: false,
    text: Number(row.value) + (row.unit === 'points' ? 'x pts' : '%'),
  };
}

/* The score. Every term is additive and every card gets the same treatment,
 * which is what keeps the ordering transitive.
 *
 *   + the rate itself
 *   + float, worth up to 1.2 points across a 58-day maximum
 *   - 2 if utilization is over 30%, which matters more than a point of rewards
 *   - 0.15 if the closing date is still a guess, so a confirmed card edges out
 *     an unconfirmed one that otherwise ties
 */
export function scoreOf({ pct, float, util, certain }) {
  return pct
    + (float / 58) * 1.2
    - (util > 30 ? 2 : 0)
    - (certain ? 0 : 0.15);
}

/* Ranks every card for a purchase, from a reference date.
 *
 * Carrying any balance excludes a card outright — not a penalty, an exclusion.
 * A balance forfeits the grace period, so interest starts on day one and the
 * float that the whole score is built around does not exist. It is shown
 * greyed with the reason rather than hidden. */
export function rankCards({ cards, rewardsByCard, choiceByCard, closesByCard, category, amount = 0, on }) {
  const rows = cards.map(card => {
    const timing = calc(card, closesByCard[card.id] || [], on);
    const reward = rewardFor(card, rewardsByCard[card.id] || [], choiceByCard[card.id] || null, category, amount);
    const carrying = Number(card.current_balance) > 0;

    return {
      card, ...timing, ...reward,
      carrying,
      back: amount * reward.pct / 100,
      score: carrying ? null : scoreOf({ pct: reward.pct, float: timing.float, util: timing.util, certain: timing.certain }),
    };
  });

  const eligible = rows
    .filter(r => !r.carrying)
    .sort((a, b) => b.score - a.score || b.float - a.float || a.card.name.localeCompare(b.card.name));

  /* Table order: eligible cards by score, then the excluded ones. */
  const all = [...eligible, ...rows.filter(r => r.carrying).sort((a, b) => b.pct - a.pct)];

  return { rows: all, eligible, best: eligible[0] || null };
}
