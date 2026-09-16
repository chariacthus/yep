/**
 * Deployment configuration read from the environment.
 *
 * Kept in one place so the answer to "is this feature on?" is greppable rather
 * than scattered across `process.env` reads.
 */

function flag(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === 'true' || value === '1';
}

/**
 * Whether a person must prove they control an address before it can be scanned.
 *
 * Off by default, because requiring it means running an email service and this
 * app is meant to be deployable for nothing. The consequences of it being off
 * are real and are handled explicitly elsewhere:
 *
 *   - Results from sensitive categories are withheld entirely (see
 *     `lib/sources/usernames` and `lib/sources/hibp.ts`). Nobody should be able
 *     to type a stranger's username and learn which dating sites they use.
 *   - The report carries a standing caveat that the identifiers were asserted,
 *     not proved.
 *
 * Turn it on — with `RESEND_API_KEY` or `SMTP_URL` set — before enabling HIBP,
 * whose terms restrict third-party use. See docs/legal.md.
 */
export function requireEmailVerification(): boolean {
  return flag('REQUIRE_EMAIL_VERIFICATION');
}

/** Google-scraping SERP providers are off unless explicitly enabled. */
export function serpScraperProvidersEnabled(): boolean {
  return flag('ENABLE_SERP_SCRAPER_PROVIDERS');
}
