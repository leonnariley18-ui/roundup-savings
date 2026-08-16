/* Ledger — explainers
 *
 * Behind a ? in the top right of a tab, never on screen. The screens should
 * read as an instrument panel; the reasoning is available when wanted and out
 * of the way when not.
 */

const HELP = {
  cards: { t: 'How this ranks', b: `
    <p><b>Float</b> is days until the statement closes plus the grace period to the due date. Buying
    the day after a card closes gives the longest runway.</p>
    <p>A card <b>carrying a balance</b> loses its grace period — interest starts on day one — so it
    drops out of recommendations entirely until it's back at zero.</p>
    <p><b>Utilization above 30%</b> pushes a card down even when its rewards are better.</p>
    <p><b>The date sets the clock.</b> Move it forward and float shrinks toward each card's close, so
    the answer changes. A card that just closed is usually the right one.</p>
    <p><b>An amount is optional.</b> It's only needed to show dollars back, and to work out whether a
    BofA purchase would spill past the quarterly cap.</p>
    <p class="dim">Wells Fargo points are counted at 1&cent; each, which is what every standard
    redemption pays. Transfer partners can beat that but it takes real effort, so it isn't assumed.</p>` },

  stmt: { t: 'Why these dates need confirming', b: `
    <p>Most issuers close on a <b>fixed cycle length</b>, not a fixed calendar day. A card that closed
    on the 18th and then the 16th hasn't wandered — it's on a 28-day cycle, and the date drifts a
    little every month.</p>
    <p>That matters because float is measured to the close. Treating a rolling cycle as a fixed day
    can be several days out, always in the direction that costs you money.</p>
    <p>So the dates you entered when setting up are treated as a <b>working guess</b>. Log each real
    closing date as statements arrive and the pattern emerges on its own. <b>Three consistent
    closes</b> confirms a card, which takes about three months.</p>
    <p>Nothing here is ever predicted into the record. Every date in your log is one you observed,
    which is why removing a mistyped one immediately re-derives everything built on it.</p>` },
  pb: { t: 'Why the countdown runs to statement close', b: `
    <p>Once a purchase lands on a closed statement it's a bill — it shows up on the calendar, counts
    against the month's money, and stops being something you quietly clear with the next paycheck.</p>
    <p>Clear it before close and it never appears at all.</p>
    <p>Two dates get tracked. <b>Your target</b> is the day you said you'd handle it. <b>The close
    date</b> is when it stops being optional. Only the second one costs you anything.</p>
    <p class="dim">Something logged as "not a card" has no close date, so only your target applies.
    It stays open until you clear it.</p>` },
  ru: { t: 'Round-up', b: `
    <p>Pulls your categorized transactions in the selected categories, rounds each up to the next
    dollar, and totals the difference.</p>
    <p>Run it after a categorizing session. It isn't scheduled, because categorizing isn't.</p>
    <p>Groceries, subscriptions and pay-later plans stay out on purpose.</p>
    <p>Anything uncategorised in the range is counted and reported rather than guessed at —
    categorise it in Lunch Money and run it again.</p>
    <p class="dim">There's no running total and no transfer log here. A tracker that only sees money
    going in drifts into fiction the first time you withdraw some. "I moved the money" records the
    date on your calendar and nothing else.</p>` },
};

export function openHelp(kind) {
  const h = HELP[kind];
  if (!h) return;
  document.getElementById('helpModal').innerHTML = `
    <div class="mhead">
      <div class="dmeta"><div class="dow">How this works</div><div class="dfull">${h.t}</div></div>
      <button class="mclose" id="helpX" aria-label="Close">&times;</button>
    </div>
    <div class="hbody">${h.b}</div>`;
  document.getElementById('helpScrim').hidden = false;
  document.getElementById('helpX').onclick = closeHelp;
}

export function closeHelp() {
  const el = document.getElementById('helpScrim');
  if (el) el.hidden = true;
}

document.addEventListener('click', e => {
  if (e.target.id === 'helpScrim') closeHelp();
});
