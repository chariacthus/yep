import { normalizeEmail } from './identity';

/**
 * Username candidates derived from an email address.
 *
 * Most people never type a username into this form, and without one the site
 * sweep — by far the widest source here — has nothing to work with. But the
 * local part of an address is very often the handle somebody uses elsewhere, so
 * deriving a couple of candidates turns an email-only scan into one that can
 * actually find social accounts.
 *
 * Two rules keep this from manufacturing false positives:
 *
 *   - Only forms that are already present in the address. `john.smith` gives
 *     `john.smith` and `johnsmith`; it does not invent `john_smith` or
 *     `jsmith`, because those are guesses about a person rather than facts
 *     about their address.
 *   - Anything found this way is marked as derived, so the report can say the
 *     handle came from the address and was never confirmed — and the confidence
 *     engine caps it accordingly.
 */

/** Local parts too generic to be anybody's handle. */
const GENERIC = new Set([
  'admin',
  'info',
  'contact',
  'hello',
  'hi',
  'mail',
  'email',
  'me',
  'support',
  'help',
  'sales',
  'team',
  'noreply',
  'no-reply',
  'office',
  'enquiries',
  'inquiries',
  'billing',
  'accounts',
  'webmaster',
  'postmaster',
  'test',
  'user',
]);

const MIN_LENGTH = 4;
const MAX_CANDIDATES = 2;

/**
 * Strips the parts of a local address that are routing rather than identity:
 * the +tag suffix everywhere, and the dots Gmail ignores.
 */
function localPart(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return '';
  const local = email.slice(0, at);
  const plus = local.indexOf('+');
  return plus > 0 ? local.slice(0, plus) : local;
}

export interface DerivedUsername {
  value: string;
  /** Shown in the report so a derived handle is never mistaken for a given one. */
  derivedFrom: 'email';
}

export function deriveUsernames(rawEmail: string): DerivedUsername[] {
  const local = localPart(normalizeEmail(rawEmail)).trim();
  if (!local) return [];

  const candidates: string[] = [];
  const add = (value: string) => {
    const cleaned = value.trim().toLowerCase();
    if (cleaned.length < MIN_LENGTH) return;
    if (GENERIC.has(cleaned)) return;
    // A local part that is mostly digits is an account number, not a handle.
    if (/^\d+$/.test(cleaned)) return;
    if (!/^[a-z0-9._-]+$/.test(cleaned)) return;
    if (!candidates.includes(cleaned)) candidates.push(cleaned);
  };

  add(local);
  // The same handle without separators, which is how many sites store it.
  const squashed = local.replace(/[._-]/g, '');
  if (squashed !== local) add(squashed);

  return candidates.slice(0, MAX_CANDIDATES).map((value) => ({ value, derivedFrom: 'email' }));
}
