/* Ledger — loan amortisation
 *
 * Every figure the loan screen shows is computed here from the loan's terms
 * and its logged payments. Nothing is hardcoded — balance, payoff date,
 * interest avoided, months erased and the principal/interest split all fall
 * out of the same schedule.
 *
 * That matters because the numbers move. The moment a real payment posts at a
 * different figure, a hardcoded projection becomes a lie that nobody notices.
 *
 * No DOM, no database.
 */

/* Interest is rounded to the cent each period, the way a lender's ledger does
 * it, rather than carried at full precision and rounded at the end. The two
 * differ by a few cents over a five-year term. */
const cents = n => Math.round(n * 100) / 100;

/* Runs the loan forward to zero at a fixed payment.
 *
 * Returns every period, so the caller can show the first payment's split or
 * total the interest without amortising twice. */
export function schedule(principal, apr, payment, { maxPeriods = 600 } = {}) {
  const monthly = apr / 100 / 12;
  let balance = cents(principal);
  let totalInterest = 0;
  const periods = [];

  while (balance > 0.005 && periods.length < maxPeriods) {
    const interest = cents(balance * monthly);
    let toPrincipal = cents(payment - interest);

    /* A payment that does not cover the interest never retires the loan — the
       balance grows every month. Reported rather than looped forever. */
    if (toPrincipal <= 0) {
      return { impossible: true, periods: [], count: 0, totalInterest: 0,
               reason: 'the payment does not cover the monthly interest' };
    }

    if (toPrincipal > balance) toPrincipal = balance;   // the final payment is short
    balance = cents(balance - toPrincipal);
    totalInterest = cents(totalInterest + interest);

    periods.push({
      n: periods.length + 1,
      interest, principal: toPrincipal,
      payment: cents(interest + toPrincipal),
      balance,
      principalShare: (toPrincipal / (interest + toPrincipal)) * 100,
    });
  }

  return { impossible: false, periods, count: periods.length, totalInterest, reason: null };
}

/* Adds n whole months to a date, clamping to short months. */
function addMonths(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth() + n, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(date.getDate(), last));
  return d;
}

export const payoffDate = (firstPayment, count) => addMonths(firstPayment, count - 1);

/* What holding the higher payment buys, against the floor.
 *
 * Both are projections until real payments exist, and the screen says so —
 * the floor exists to be used, and using it should not feel like a failure. */
export function comparison(debt) {
  const principal = Number(debt.principal);
  const apr = Number(debt.apr);
  const actual = schedule(principal, apr, Number(debt.actual_payment));
  const minimum = schedule(principal, apr, Number(debt.minimum_payment));

  return {
    actual, minimum,
    interestAvoided: cents(minimum.totalInterest - actual.totalInterest),
    monthsErased: minimum.count - actual.count,
  };
}

/* The cost of dropping to the floor for a single month, then resuming.
 *
 * The spec asks this to be stated plainly, because a floor nobody dares use is
 * not a floor. It is a small number and saying so is the point. */
export function costOfOneMinimumMonth(debt) {
  const principal = Number(debt.principal);
  const apr = Number(debt.apr);
  const actual = Number(debt.actual_payment);
  const floor = Number(debt.minimum_payment);

  const straight = schedule(principal, apr, actual);

  /* One month at the floor, then back to the usual payment. */
  const monthly = apr / 100 / 12;
  const firstInterest = cents(principal * monthly);
  const afterOne = cents(principal - cents(floor - firstInterest));
  const rest = schedule(afterOne, apr, actual);

  return cents((firstInterest + rest.totalInterest) - straight.totalInterest);
}

/* Real history once payments exist, projection until then.
 *
 * `payments` are debt_payments rows. Both portions are stored on each row, so
 * history stays accurate even if the rate changes later — this only recomputes
 * what has not happened yet. */
export function position(debt, payments = []) {
  const principal = Number(debt.principal);
  const apr = Number(debt.apr);
  const paid = payments.reduce((n, p) => n + Number(p.amount), 0);
  const principalPaid = payments.reduce((n, p) => n + Number(p.principal_portion), 0);
  const interestPaid = payments.reduce((n, p) => n + Number(p.interest_portion), 0);
  const balance = cents(principal - principalPaid);

  const remaining = balance > 0.005
    ? schedule(balance, apr, Number(debt.actual_payment))
    : { impossible: false, periods: [], count: 0, totalInterest: 0 };

  return {
    started: payments.length > 0,
    payments: payments.length,
    paid: cents(paid),
    principalPaid: cents(principalPaid),
    interestPaid: cents(interestPaid),
    balance,
    cleared: balance <= 0.005,
    remaining,
    /* Interest still to come, on top of what has already been paid. */
    projectedTotalInterest: cents(interestPaid + remaining.totalInterest),
  };
}

/* Splits one payment at today's balance. Both portions get stored on the row. */
export function splitPayment(balance, apr, amount) {
  const interest = cents(Number(balance) * (Number(apr) / 100 / 12));
  const principal = cents(Number(amount) - interest);
  return { interest, principal };
}
