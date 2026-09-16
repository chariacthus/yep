import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildIdentity } from '@/lib/identity';
import { resetBreachCatalogCache } from '@/lib/breach-catalog';
import { runScan } from '@/lib/orchestrator';
import { SOURCES } from '@/lib/sources/registry';
import type { Finding } from '@/lib/normalize/finding';

/**
 * The breach pipeline, end to end.
 *
 * Three things have to hold together here and none of them can be checked
 * against the live services from CI:
 *
 *   1. A bare breach name from a keyless index becomes a full record, using
 *      HIBP's public catalogue. That catalogue needs no API key — only the
 *      account lookup does — which is what makes a useful report possible with
 *      no paid subscription at all.
 *   2. The same breach reported by two different indexes becomes ONE finding,
 *      crediting both, rather than the same event listed twice.
 *   3. Nothing resembling a credential survives, whatever the providers send.
 */

const CATALOG = [
  {
    Name: 'Adobe',
    Title: 'Adobe',
    Domain: 'adobe.com',
    BreachDate: '2013-10-04',
    AddedDate: '2013-12-04T00:00:00Z',
    PwnCount: 152445165,
    Description:
      'In October 2013, <a href="http://example.com">153 million Adobe accounts were breached</a> with each containing an internal ID, username, email, <em>encrypted</em> password and a password hint in plain text.',
    DataClasses: ['Email addresses', 'Password hints', 'Passwords', 'Usernames'],
    IsVerified: true,
    IsSensitive: false,
    IsMalware: false,
    IsSpamList: false,
    IsRetired: false,
  },
  {
    Name: 'AshleyMadison',
    Title: 'Ashley Madison',
    Domain: 'ashleymadison.com',
    BreachDate: '2015-07-19',
    PwnCount: 30811934,
    Description: 'A dating website for people seeking affairs.',
    DataClasses: ['Email addresses', 'Passwords'],
    IsVerified: true,
    IsSensitive: true,
    IsMalware: false,
    IsSpamList: false,
    IsRetired: false,
  },
];

let servers: Server[] = [];

async function serve(handler: (url: string) => { status: number; body: unknown }): Promise<string> {
  const server = createServer((request, response) => {
    const { status, body } = handler(request.url ?? '');
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  servers.push(server);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return `http://127.0.0.1:${port}`;
}

beforeEach(() => {
  resetBreachCatalogCache();
});

afterEach(() => {
  for (const server of servers) server.close();
  servers = [];
  for (const key of [
    'HIBP_API_BASE',
    'XPOSEDORNOT_API_BASE',
    'LEAKCHECK_API_BASE',
  ]) {
    delete process.env[key];
  }
});

async function scanWithOnly(sourceIds: string[], emailVerified = false) {
  const declined = new Set(SOURCES.map((source) => source.id).filter((id) => !sourceIds.includes(id)));
  const findings: Finding[] = [];
  let counts = { findings: 0, removalOpportunities: 0, withheld: 0 };

  for await (const event of runScan({
    identity: buildIdentity({ email: 'subject@example.test' }),
    emailVerified,
    declinedSources: declined,
    budgetMs: 15_000,
  })) {
    if (event.type === 'finding') {
      const index = findings.findIndex((item) => item.id === event.finding.id);
      if (index === -1) findings.push(event.finding);
      else findings[index] = event.finding;
    }
    if (event.type === 'scan_complete') counts = event.counts;
  }
  return { findings, counts };
}

describe('enriching a bare breach name from the keyless catalogue', () => {
  it('turns a name into a full record with a link', async () => {
    // The catalogue endpoint is the keyless one; no API key is set anywhere.
    process.env.HIBP_API_BASE = await serve(() => ({ status: 200, body: CATALOG }));
    process.env.XPOSEDORNOT_API_BASE = await serve(() => ({
      status: 200,
      body: { ExposedBreaches: { breaches_details: [{ breach: 'Adobe' }] } },
    }));

    const { findings } = await scanWithOnly(['xposedornot']);
    expect(findings).toHaveLength(1);

    const finding = findings[0]!;
    expect(finding.title).toContain('Adobe');
    expect(finding.origin.domain).toBe('adobe.com');
    expect(finding.occurredAt?.year).toBe(2013);
    // The description arrives as HTML and must be rendered as plain text.
    expect(finding.whyItMatters).toContain('153 million Adobe accounts were breached');
    expect(finding.whyItMatters).not.toContain('<a href');
    expect(finding.whyItMatters).toContain('152 million accounts');
    // A real link to the write-up, which is what makes the finding checkable.
    expect(finding.evidence?.url).toContain('haveibeenpwned.com/PwnedWebsites#Adobe');
    // Both "Passwords" and "Password hints" collapse to the one boolean fact.
    expect(finding.dataTypes).toContain('password_credential');
    expect(finding.dataTypes).toContain('username');
  });

  it('still produces a usable finding when the catalogue is unreachable', async () => {
    process.env.HIBP_API_BASE = 'http://127.0.0.1:1/dead';
    process.env.XPOSEDORNOT_API_BASE = await serve(() => ({
      status: 200,
      body: {
        ExposedBreaches: {
          breaches_details: [
            { breach: 'SomeForum', xposed_date: '2019', xposed_data: 'Email addresses;Passwords' },
          ],
        },
      },
    }));

    const { findings } = await scanWithOnly(['xposedornot']);
    expect(findings).toHaveLength(1);
    // Sparse, but never wrong, and it still says what to do.
    expect(findings[0]!.title).toContain('SomeForum');
    expect(findings[0]!.dataTypes).toContain('password_credential');
    expect(findings[0]!.actions.length).toBeGreaterThan(0);
  });
});

describe('two indexes reporting the same breach', () => {
  it('produces one finding, crediting both', async () => {
    process.env.HIBP_API_BASE = await serve(() => ({ status: 200, body: CATALOG }));
    process.env.XPOSEDORNOT_API_BASE = await serve(() => ({
      status: 200,
      body: { ExposedBreaches: { breaches_details: [{ breach: 'Adobe' }] } },
    }));
    // LeakCheck names the same breach by its domain rather than its title.
    process.env.LEAKCHECK_API_BASE = await serve(() => ({
      status: 200,
      body: {
        success: true,
        found: 1,
        fields: ['password', 'username'],
        sources: [{ name: 'adobe.com', date: '2013-10' }],
      },
    }));

    const { findings, counts } = await scanWithOnly(['xposedornot', 'leakcheck']);

    expect(findings).toHaveLength(1);
    expect(counts.findings).toBe(1);

    const finding = findings[0]!;
    expect(finding.alsoSeenBy).toBeDefined();
    expect([finding.provider.label, ...(finding.alsoSeenBy ?? [])].sort()).toEqual([
      'LeakCheck',
      'XposedOrNot',
    ]);
  });
});

describe('sensitive breaches', () => {
  it('are withheld while ownership is unproved', async () => {
    process.env.HIBP_API_BASE = await serve(() => ({ status: 200, body: CATALOG }));
    process.env.XPOSEDORNOT_API_BASE = await serve(() => ({
      status: 200,
      body: { ExposedBreaches: { breaches_details: [{ breach: 'AshleyMadison' }] } },
    }));

    const unverified = await scanWithOnly(['xposedornot'], false);
    expect(unverified.findings).toHaveLength(0);

    resetBreachCatalogCache();
    const verified = await scanWithOnly(['xposedornot'], true);
    expect(verified.findings).toHaveLength(1);
    expect(verified.findings[0]!.flags?.sensitive).toBe(true);
  });
});

describe('the credential rule, across the whole pipeline', () => {
  it('reports that credentials were taken without carrying any', async () => {
    process.env.HIBP_API_BASE = await serve(() => ({ status: 200, body: CATALOG }));
    process.env.LEAKCHECK_API_BASE = await serve(() => ({
      status: 200,
      body: {
        success: true,
        found: 1,
        // Even if a provider sent values in this field, they are categories to
        // us and are mapped, never echoed.
        fields: ['password', 'hunter2-should-never-appear'],
        sources: [{ name: 'Adobe' }],
      },
    }));

    const { findings } = await scanWithOnly(['leakcheck']);
    const serialised = JSON.stringify(findings);

    expect(findings[0]!.dataTypes).toContain('password_credential');
    expect(serialised).not.toContain('hunter2-should-never-appear');
  });
});
