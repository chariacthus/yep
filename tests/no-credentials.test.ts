import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildIdentity } from '@/lib/identity';
import { hudsonRockSource } from '@/lib/sources/hudsonrock';
import { xposedOrNotSource } from '@/lib/sources/xposedornot';
import { mapDataClass, mapDataClasses } from '@/lib/normalize/dataclasses';
import type { Finding } from '@/lib/normalize/finding';
import type { ScanContext } from '@/lib/sources/types';

/**
 * The product's hardest rule: no credential value ever reaches the report.
 *
 * Hudson Rock's API genuinely returns stolen passwords in `top_passwords` and
 * `top_logins`. This test feeds the adapter a response shaped exactly like
 * theirs, containing unmistakable marker strings, and asserts that none of them
 * survives into any emitted finding.
 *
 * This is the control. The adapter not reading those fields is the intention;
 * this is the proof.
 */

const CREDENTIAL_MARKERS = [
  'hunter2-should-never-appear',
  'correct-horse-battery-staple',
  '$2y$10$abcdefghijklmnopqrstuv',
];

function contextFor(server: Server): ScanContext {
  return {
    identity: buildIdentity({ email: 'subject@example.test', username: 'subject' }),
    emailVerified: true,
    declinedSources: new Set(),
    corroboration: { confirmedHosts: new Set() },
    deadline: Date.now() + 10_000,
    signal: AbortSignal.timeout(10_000),
  } satisfies ScanContext & Record<string, unknown> as ScanContext;
}

async function startServer(body: unknown): Promise<{ server: Server; base: string }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

describe('Hudson Rock adapter', () => {
  it('discards the credential fields its API returns', async () => {
    const { server, base } = await startServer({
      stealers: [
        {
          date_compromised: '2023-04-11',
          computer_name: 'DESKTOP-EXAMPLE',
          operating_system: 'Windows 10 Pro',
          total_user_services: 14,
          total_corporate_services: 2,
          // Exactly what the real API sends back, and exactly what must not leak.
          top_passwords: [CREDENTIAL_MARKERS[0], CREDENTIAL_MARKERS[1]],
          top_logins: ['subject@example.test'],
          credentials: [{ password: CREDENTIAL_MARKERS[2], url: 'https://bank.example' }],
        },
      ],
    });

    process.env.HUDSONROCK_API_BASE = base;
    const findings: Finding[] = [];

    try {
      const outcome = await hudsonRockSource.run(contextFor(server), {
        finding: (finding) => findings.push(finding),
        removalOpportunity: () => undefined,
        progress: () => undefined,
      });

      expect(outcome.status).toBe('ok');
      expect(findings).toHaveLength(1);

      // The finding must report that credentials were involved...
      expect(findings[0]!.dataTypes).toContain('password_credential');

      // ...without carrying any of them.
      const serialised = JSON.stringify(findings);
      for (const marker of CREDENTIAL_MARKERS) {
        expect(serialised).not.toContain(marker);
      }
      expect(serialised).not.toMatch(/top_passwords|top_logins/);
    } finally {
      delete process.env.HUDSONROCK_API_BASE;
      server.close();
    }
  });
});

describe('XposedOrNot adapter', () => {
  it('reports that credentials were breached without revealing any', async () => {
    const { server, base } = await startServer({
      ExposedBreaches: {
        breaches_details: [
          {
            breach: 'ExampleForum',
            details: 'A forum breach.',
            domain: 'forum.example',
            xposed_data: 'Email addresses;Passwords;Usernames',
            xposed_date: '2019',
            password_risk: 'plaintext',
          },
        ],
      },
    });

    process.env.XPOSEDORNOT_API_BASE = base;
    const findings: Finding[] = [];

    try {
      await xposedOrNotSource.run(contextFor(server), {
        finding: (finding) => findings.push(finding),
        removalOpportunity: () => undefined,
        progress: () => undefined,
      });

      expect(findings).toHaveLength(1);
      const finding = findings[0]!;
      expect(finding.dataTypes).toContain('password_credential');
      expect(finding.dataTypes).toContain('email');
      expect(finding.occurredAt?.year).toBe(2019);
      // Describing how credentials were stored is a fact about the breach, not
      // a credential, and it changes how urgent the response is.
      expect(finding.whyItMatters).toMatch(/without any protection/i);
      expect(finding.educationKey).toBe('password_in_breach');
    } finally {
      delete process.env.XPOSEDORNOT_API_BASE;
      server.close();
    }
  });
});

describe('the data-class mapping chokepoint', () => {
  it('collapses every credential-ish class onto the single boolean fact', () => {
    for (const raw of [
      'Passwords',
      'Password hints',
      'Historical passwords',
      'Encrypted passwords',
      'Partial credit card data and passwords',
      'Security questions and answers',
      'Auth tokens',
      'API keys',
      'PINs',
    ]) {
      expect(mapDataClass(raw)).toBe('password_credential');
    }
  });

  it('drops classes it cannot confidently map rather than inventing one', () => {
    expect(mapDataClass('Astrological signs and vibes')).toBeNull();
    expect(mapDataClasses(['Email addresses', 'Utter nonsense'])).toEqual(['email']);
  });

  it('never routes a credential class to a non-credential type', () => {
    // "Password hints" contains "hint", not "email" -- but a naive substring
    // rule could still misfire on strings like "email passwords".
    expect(mapDataClass('Email passwords')).toBe('password_credential');
  });
});
