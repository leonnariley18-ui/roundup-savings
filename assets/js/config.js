/* Ledger — configuration
 *
 * Fill these two in after creating your Supabase project. See SETUP.md.
 *
 * The anon key belongs here in plain sight and is not a secret: it ships in
 * the bundle of a public Pages site no matter where it is written down. It
 * grants nothing on its own — every table is scoped to auth.uid() by RLS, so
 * an unauthenticated request reaches no row. What must never appear in this
 * file is the service_role key or the Lunch Money token; those live in
 * Supabase secrets and are only ever touched by Edge Functions.
 */

export const SUPABASE_URL = '';
export const SUPABASE_ANON_KEY = '';

/* Wells Fargo Rewards points are worth exactly 1 cent across every standard
 * redemption, so 3x genuinely equals 3%. Transfer partners can beat that but
 * take deliberate effort, so it is not assumed. Configurable because the
 * assumption should be changeable in one place, and it is surfaced in the UI. */
export const POINT_CENTS = 1.0;

/* Consistent closes needed before a card's date counts as confirmed. */
export const NEEDED = 3;

export const isConfigured = () =>
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;
