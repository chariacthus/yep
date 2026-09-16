import { cookies } from 'next/headers';
import {
  constantTimeEqual,
  generateVerificationCode,
  hmac,
  signPayload,
  verifyPayload,
} from './crypto';
import { normalizeEmail } from './identity';

/**
 * Email verification without a database.
 *
 * The pending code and the verified state both live in signed, HttpOnly cookies
 * on the person's own device. The server stores nothing, which means there is no
 * table of "addresses somebody tried to verify" to leak, expire or subpoena.
 *
 * The cookies contain HMACs, never the address, so they are useless to anyone
 * who obtains one — including us.
 */

const CHALLENGE_COOKIE = 'exposure_challenge';
const VERIFIED_COOKIE = 'exposure_verified';

const CHALLENGE_TTL_MS = 15 * 60 * 1000;
const VERIFIED_TTL_MS = 60 * 60 * 1000;

const MAX_ATTEMPTS = 5;

interface ChallengePayload {
  /** HMAC of the address, so the cookie never carries the address itself. */
  eid: string;
  /** HMAC of the code. */
  cid: string;
  attempts: number;
  exp: number;
  [key: string]: string | number | boolean;
}

interface VerifiedPayload {
  eid: string;
  exp: number;
  [key: string]: string | number | boolean;
}

export function emailId(rawEmail: string): string {
  return hmac(normalizeEmail(rawEmail), 'email-id');
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
} as const;

export async function issueChallenge(rawEmail: string): Promise<string> {
  const code = generateVerificationCode();
  const payload: ChallengePayload = {
    eid: emailId(rawEmail),
    cid: hmac(code, 'verification-code'),
    attempts: 0,
    exp: Date.now() + CHALLENGE_TTL_MS,
  };

  const store = await cookies();
  store.set(CHALLENGE_COOKIE, signPayload(payload, CHALLENGE_COOKIE), {
    ...COOKIE_OPTIONS,
    maxAge: CHALLENGE_TTL_MS / 1000,
  });

  return code;
}

export type ConfirmResult =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'mismatch' | 'wrong_code' | 'too_many_attempts' };

export async function confirmChallenge(rawEmail: string, code: string): Promise<ConfirmResult> {
  const store = await cookies();
  const challenge = verifyPayload<ChallengePayload>(
    store.get(CHALLENGE_COOKIE)?.value,
    CHALLENGE_COOKIE,
  );

  if (!challenge) return { ok: false, reason: 'expired' };
  if (challenge.attempts >= MAX_ATTEMPTS) {
    store.delete(CHALLENGE_COOKIE);
    return { ok: false, reason: 'too_many_attempts' };
  }

  // The code must belong to the address currently being verified, so a code
  // issued for one address cannot be replayed against another.
  if (!constantTimeEqual(challenge.eid, emailId(rawEmail))) {
    return { ok: false, reason: 'mismatch' };
  }

  if (!constantTimeEqual(challenge.cid, hmac(code.trim(), 'verification-code'))) {
    // Burn an attempt, so the six-digit space cannot be walked.
    store.set(
      CHALLENGE_COOKIE,
      signPayload({ ...challenge, attempts: challenge.attempts + 1 }, CHALLENGE_COOKIE),
      { ...COOKIE_OPTIONS, maxAge: Math.max(1, Math.floor((challenge.exp - Date.now()) / 1000)) },
    );
    return { ok: false, reason: 'wrong_code' };
  }

  store.delete(CHALLENGE_COOKIE);
  store.set(
    VERIFIED_COOKIE,
    signPayload({ eid: challenge.eid, exp: Date.now() + VERIFIED_TTL_MS } as VerifiedPayload, VERIFIED_COOKIE),
    { ...COOKIE_OPTIONS, maxAge: VERIFIED_TTL_MS / 1000 },
  );

  return { ok: true };
}

/** True when the caller has proved, in this browser, that they own the address. */
export async function isVerified(rawEmail: string): Promise<boolean> {
  const store = await cookies();
  const verified = verifyPayload<VerifiedPayload>(store.get(VERIFIED_COOKIE)?.value, VERIFIED_COOKIE);
  if (!verified) return false;
  return constantTimeEqual(verified.eid, emailId(rawEmail));
}

export async function clearVerification(): Promise<void> {
  const store = await cookies();
  store.delete(CHALLENGE_COOKIE);
  store.delete(VERIFIED_COOKIE);
}
