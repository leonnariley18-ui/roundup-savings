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

export const SUPABASE_URL = 'https://pukzhmhevjbfwvhjzppr.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB1a3pobWhldmpiZnd2aGp6cHByIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NjUzNTYsImV4cCI6MjA5MzM0MTM1Nn0.-Jl1tv-xeOTwv6cd-OgF-ovooLfYyzoaA2c7Seax3Zo';

/* Wells Fargo Rewards points are worth exactly 1 cent across every standard
 * redemption, so 3x genuinely equals 3%. Transfer partners can beat that but
 * take deliberate effort, so it is not assumed. Configurable because the
 * assumption should be changeable in one place, and it is surfaced in the UI. */
export const POINT_CENTS = 1.0;

/* Consistent closes needed before a card's date counts as confirmed. */
export const NEEDED = 3;

/* The date this app starts caring about.
 *
 * Only bills need this. Everything else here — statement closes, paybacks,
 * notes, round-up runs, card decisions, loan payments — starts empty and only
 * ever holds what you logged, so there is no history to inherit. Round-up asks
 * for its own date range each run.
 *
 * Bills are the exception because they sync from Lunch Money recurring items,
 * which carry history back to whenever the account started. Without a floor,
 * the first sync would manufacture months of bill instances that were paid long
 * ago and mark the calendar with them. Nothing before this date is generated.
 *
 * Changing it later is safe: it only gates what sync creates, and it never
 * deletes an instance that already exists. */
export const BILLS_FROM = '2026-08-01';

export const isConfigured = () =>
  SUPABASE_URL.startsWith('https://') && SUPABASE_ANON_KEY.length > 20;
