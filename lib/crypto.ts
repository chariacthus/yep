import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Hashing and signing helpers.
 *
 * Two distinct jobs live here:
 *
 *   1. Deriving the hashed forms of an email that providers accept, so the raw
 *      address does not have to be sent (HIBP k-anonymity, Gravatar).
 *   2. Signing short-lived cookies, which is how the verification flow keeps
 *      state without a database.
 */

/**
 * Generated once per process when APP_SECRET is unset, so the app runs with no
 * configuration at all.
 *
 * This secret only ever protects two things, and neither needs to survive a
 * restart: rate-limit counter keys (which are meant to expire anyway) and the
 * verification cookie (which is only used when email verification is switched
 * on). Losing it on restart resets some counters and signs people out. Nothing
 * is stored under it, because nothing is stored at all.
 *
 * A real deployment should still set APP_SECRET — across several instances an
 * ephemeral one means each instance keeps its own rate-limit counters — so we
 * say so once at startup rather than refusing to run.
 */
const ephemeralSecret = randomBytes(32).toString('base64');
let warnedAboutEphemeralSecret = false;

function appSecret(): string {
  const configured = process.env.APP_SECRET;
  if (configured && configured.length >= 16) return configured;

  if (!warnedAboutEphemeralSecret) {
    warnedAboutEphemeralSecret = true;
    if (process.env.NODE_ENV === 'production') {
      process.stderr.write(
        'APP_SECRET is not set, so a temporary one was generated for this process. ' +
          'Rate limits will not be shared between instances and will reset on restart. ' +
          'Set APP_SECRET to a random value (openssl rand -base64 32) to fix that.\n',
      );
    }
  }
  return ephemeralSecret;
}

export function sha1Hex(value: string): string {
  return createHash('sha1').update(value).digest('hex').toUpperCase();
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex').toLowerCase();
}

/**
 * The first five characters of the SHA-1 of an address, which is all that HIBP's
 * k-anonymity range endpoint receives. Thousands of addresses share any given
 * prefix, so it does not identify the person being searched for.
 */
export function hibpRangePrefix(normalizedEmail: string): { prefix: string; suffix: string } {
  const hash = sha1Hex(normalizedEmail);
  return { prefix: hash.slice(0, 6), suffix: hash.slice(6) };
}

/** Gravatar keys profiles on the SHA-256 of the trimmed, lowercased address. */
export function gravatarHash(normalizedEmail: string): string {
  return sha256Hex(normalizedEmail);
}

export function hmac(value: string, purpose: string): string {
  return createHmac('sha256', appSecret()).update(`${purpose}:${value}`).digest('base64url');
}

/**
 * A rate-limit key that cannot be reversed into the address or IP it came from.
 * The salt rotates daily so keys age out on their own even if a store leaks.
 */
export function rateLimitKey(value: string, purpose: string): string {
  const day = new Date().toISOString().slice(0, 10);
  return hmac(`${day}:${value}`, `ratelimit:${purpose}`).slice(0, 32);
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** A six-digit verification code drawn from a CSPRNG, without modulo bias. */
export function generateVerificationCode(): string {
  // 0..999999 needs 20 bits; reject values above the largest clean multiple.
  const limit = 1_000_000;
  const maxAcceptable = Math.floor(0xffffff / limit) * limit;
  for (;;) {
    const value = randomBytes(3).readUIntBE(0, 3);
    if (value < maxAcceptable) {
      return String(value % limit).padStart(6, '0');
    }
  }
}

export function randomId(bytes = 12): string {
  return randomBytes(bytes).toString('base64url');
}

export interface SignedPayload {
  [key: string]: string | number | boolean;
}

/**
 * Signs a JSON payload for storage in a cookie. The payload is readable by the
 * client, so it must never contain a raw address -- only HMACs of one.
 */
export function signPayload(payload: SignedPayload, purpose: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = hmac(body, purpose);
  return `${body}.${signature}`;
}

export function verifyPayload<T extends SignedPayload>(
  token: string | undefined,
  purpose: string,
): T | null {
  if (!token) return null;
  const separator = token.lastIndexOf('.');
  if (separator <= 0) return null;

  const body = token.slice(0, separator);
  const signature = token.slice(separator + 1);
  if (!constantTimeEqual(signature, hmac(body, purpose))) return null;

  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
    if (typeof parsed.exp === 'number' && parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
