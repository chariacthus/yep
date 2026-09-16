import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Verification is the abuse boundary: it is what makes every scan a self-search
 * rather than a lookup of somebody else. These tests cover the parts that hold
 * that boundary up -- code entropy, replay across addresses, and attempt limits.
 *
 * `next/headers` is mocked with a simple in-memory cookie jar, because the
 * mechanism under test is the signing and comparison logic, not Next's storage.
 */

const jar = new Map<string, string>();

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { value: jar.get(name)! } : undefined),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
}));

process.env.APP_SECRET ??= 'test-secret-value-at-least-sixteen-chars';

const { confirmChallenge, issueChallenge, isVerified, emailId } = await import('@/lib/verification');
const { generateVerificationCode } = await import('@/lib/crypto');

beforeEach(() => jar.clear());

describe('the verification code', () => {
  it('is always six digits', () => {
    for (let index = 0; index < 200; index += 1) {
      expect(generateVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it('is not obviously biased across the range', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 500; index += 1) seen.add(generateVerificationCode());
    // 500 draws from a million values should almost never collide much.
    expect(seen.size).toBeGreaterThan(480);
  });
});

describe('the challenge cookie', () => {
  it('never contains the address it is for', async () => {
    const email = 'someone@example.test';
    await issueChallenge(email);

    const cookie = [...jar.values()].join('');
    expect(cookie).not.toContain(email);
    expect(cookie).not.toContain('someone');
  });

  it('accepts the right code and marks the address verified', async () => {
    const email = 'someone@example.test';
    const code = await issueChallenge(email);

    expect(await confirmChallenge(email, code)).toEqual({ ok: true });
    expect(await isVerified(email)).toBe(true);
  });

  it('is case- and whitespace-insensitive about the address', async () => {
    const code = await issueChallenge('Someone@Example.test');
    expect(await confirmChallenge('someone@example.test ', code)).toEqual({ ok: true });
  });
});

describe('replay and brute force', () => {
  it('refuses a code issued for a different address', async () => {
    const code = await issueChallenge('first@example.test');

    const result = await confirmChallenge('second@example.test', code);
    expect(result).toEqual({ ok: false, reason: 'mismatch' });
    expect(await isVerified('second@example.test')).toBe(false);
  });

  it('locks out after five wrong attempts', async () => {
    const email = 'someone@example.test';
    await issueChallenge(email);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(await confirmChallenge(email, '000000')).toEqual({ ok: false, reason: 'wrong_code' });
    }

    expect(await confirmChallenge(email, '000000')).toEqual({
      ok: false,
      reason: 'too_many_attempts',
    });
  });

  it('does not treat an absent challenge as a pass', async () => {
    expect(await confirmChallenge('someone@example.test', '123456')).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('does not consider an unverified address verified', async () => {
    await issueChallenge('someone@example.test');
    expect(await isVerified('someone@example.test')).toBe(false);
  });
});

describe('the email identifier', () => {
  it('is stable for equivalent addresses and different for others', () => {
    expect(emailId('Someone@Example.test')).toBe(emailId(' someone@example.test '));
    expect(emailId('a@example.test')).not.toBe(emailId('b@example.test'));
  });
});
