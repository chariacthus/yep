import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildIdentity, identityStrings, priv, reveal } from '@/lib/identity';
import { logger, sanitizeForLog } from '@/lib/logger';
import { runScan } from '@/lib/orchestrator';

/**
 * The control behind "we do not log personal information".
 *
 * A convention is not a guarantee. This runs a real scan with distinctive
 * marker values and fails if any of them appears in captured stdout. If
 * somebody later adds `logger.info('scanning', { email })`, this test breaks
 * before the change ships.
 */

const CANARIES = {
  email: 'zx-canary-address@canary-domain.invalid',
  name: 'Zxcanaryfirst Zxcanarylast',
  username: 'zxcanaryhandle',
  locality: 'Zxcanarytown',
};

let captured: string[] = [];
let originalWrite: typeof process.stdout.write;

beforeEach(() => {
  captured = [];
  originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    captured.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8'));
    return true;
  }) as typeof process.stdout.write;
});

afterEach(() => {
  process.stdout.write = originalWrite;
});

function assertNoCanaries(): void {
  const output = captured.join('');
  for (const value of Object.values(CANARIES)) {
    expect(output, `"${value}" reached the log`).not.toContain(value);
  }
}

describe('the private value wrapper', () => {
  it('redacts itself when interpolated or serialised', () => {
    const wrapped = priv(CANARIES.email);

    expect(`${wrapped}`).toBe('[redacted]');
    expect(JSON.stringify({ email: wrapped })).not.toContain(CANARIES.email);
    // The value is still retrievable deliberately, which is the whole point.
    expect(reveal(wrapped)).toBe(CANARIES.email);
  });
});

describe('the log sanitiser', () => {
  it('strips addresses even when they are passed unwrapped', () => {
    const cleaned = JSON.stringify(
      sanitizeForLog({ note: `contacted ${CANARIES.email} today`, nested: { q: 'secret' } }),
    );

    expect(cleaned).not.toContain(CANARIES.email);
    expect(cleaned).toContain('[redacted]');
  });

  it('redacts known-sensitive keys whatever they hold', () => {
    const cleaned = JSON.stringify(sanitizeForLog({ username: CANARIES.username }));
    expect(cleaned).not.toContain(CANARIES.username);
  });

  it('does not blow up on cycles or exotic values', () => {
    const cyclic: Record<string, unknown> = { name: 'x' };
    cyclic.self = cyclic;
    expect(() => sanitizeForLog(cyclic)).not.toThrow();
  });
});

describe('direct logger calls', () => {
  it('cannot be tricked into writing an address', () => {
    logger.info(`about to contact ${CANARIES.email}`, {
      email: CANARIES.email,
      username: priv(CANARIES.username),
      detail: { nested: { personName: CANARIES.name } },
    });

    assertNoCanaries();
  });
});

describe('a real scan', () => {
  it('writes no part of the submitted identity to the log', async () => {
    const identity = buildIdentity(CANARIES);

    // Every source is declined or unconfigured, so this exercises the
    // orchestrator's own logging without depending on network access.
    const declined = new Set([
      'xposedornot',
      'hudsonrock',
      'openpgp',
      'gravatar',
      'github',
      'wayback',
      'usernames',
      'brokers',
    ]);

    for await (const event of runScan({
      identity,
      emailVerified: true,
      declinedSources: declined,
      budgetMs: 5000,
    })) {
      // Findings are streamed to the browser, never logged -- but they must not
      // contain the raw identity either, beyond what the person typed.
      if (event.type === 'finding') {
        expect(JSON.stringify(event.finding)).not.toContain(CANARIES.email);
      }
    }

    assertNoCanaries();
  });

  it('exposes every identity string to the canary check', () => {
    // Guards the guard: if a field is added to Identity and not listed in
    // identityStrings, this test would silently stop covering it.
    const strings = identityStrings(buildIdentity(CANARIES));
    for (const value of Object.values(CANARIES)) {
      expect(strings).toContain(value);
    }
  });
});
