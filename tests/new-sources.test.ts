import { describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { buildIdentity } from '@/lib/identity';
import { gitlabSource } from '@/lib/sources/gitlab';
import { dockerHubSource } from '@/lib/sources/dockerhub';
import { npmSource } from '@/lib/sources/npm';
import { bitbucketSource } from '@/lib/sources/bitbucket';
import { maskEmail, presentEmail } from '@/lib/sources/mask';
import type { Finding } from '@/lib/normalize/finding';
import type { ScanContext, Source } from '@/lib/sources/types';

/**
 * Contract tests for the keyless profile sources, against recorded response
 * shapes served locally.
 *
 * The shapes here were taken from live responses while building these adapters,
 * so they are what the real APIs actually return rather than what their docs
 * claim. The cases that matter most are the negative ones: each of these APIs
 * signals "no such user" differently, and getting that wrong means a confident
 * false positive on every scan. (PyPI was dropped from the plan for exactly this
 * reason — it answers 200 for every username, real or not.)
 */

function context(username: string, overrides: Partial<{ email: string; name: string }> = {}): ScanContext {
  return {
    identity: buildIdentity({
      email: overrides.email ?? 'subject@example.test',
      username,
      name: overrides.name,
    }),
    handles: [{ value: username, derived: false, source: 'given' }],
    emailVerified: false,
    includeSensitive: false,
    declinedSources: new Set(),
    corroboration: { confirmedHosts: new Set() },
    deadline: Date.now() + 10_000,
    signal: AbortSignal.timeout(10_000),
  };
}

async function serve(handler: (path: string) => { status: number; body: unknown }) {
  const server: Server = createServer((request, response) => {
    const { status, body } = handler(request.url ?? '');
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  return { server, base: `http://127.0.0.1:${port}` };
}

async function collect(source: Source, ctx: ScanContext) {
  const findings: Finding[] = [];
  const outcome = await source.run(ctx, {
    finding: (finding) => findings.push(finding),
    removalOpportunity: () => undefined,
    progress: () => undefined,
  });
  return { outcome, findings };
}

describe('GitLab', () => {
  it('reports a published email address, masked when it is not the one being scanned', async () => {
    const { server, base } = await serve(() => ({
      status: 200,
      body: [
        {
          username: 'someone',
          name: 'Jane Okonkwo',
          public_email: 'jane.other@elsewhere.test',
          web_url: 'https://gitlab.com/someone',
        },
      ],
    }));
    process.env.GITLAB_API_BASE = base;

    try {
      const { findings } = await collect(gitlabSource, context('someone'));
      const finding = findings[0]!;

      expect(finding.dataTypes).toContain('email');
      expect(finding.whyItMatters).toContain('j••••••••@elsewhere.test');
      // The full address must not leak into a machine-readable report.
      expect(JSON.stringify(finding)).not.toContain('jane.other@elsewhere.test');
    } finally {
      delete process.env.GITLAB_API_BASE;
      server.close();
    }
  });

  it('shows the address in full when it is the one being scanned, and corroborates', async () => {
    const { server, base } = await serve(() => ({
      status: 200,
      body: [{ username: 'someone', public_email: 'subject@example.test', web_url: 'https://gitlab.com/someone' }],
    }));
    process.env.GITLAB_API_BASE = base;

    try {
      const ctx = context('someone');
      const { findings } = await collect(gitlabSource, ctx);

      expect(findings[0]!.whyItMatters).toContain('subject@example.test');
      expect(findings[0]!.confidence.signals.map((s) => s.id)).toContain('profile_corroborates_email');
      // Published so the username sweep can promote its own gitlab.com match.
      expect(ctx.corroboration.confirmedHosts.has('gitlab.com')).toBe(true);
    } finally {
      delete process.env.GITLAB_API_BASE;
      server.close();
    }
  });

  it('treats an empty array as "no such user"', async () => {
    const { server, base } = await serve(() => ({ status: 200, body: [] }));
    process.env.GITLAB_API_BASE = base;

    try {
      const { outcome, findings } = await collect(gitlabSource, context('nobody'));
      expect(findings).toHaveLength(0);
      expect(outcome).toEqual({ status: 'ok', checked: 0 });
    } finally {
      delete process.env.GITLAB_API_BASE;
      server.close();
    }
  });
});

describe('Docker Hub', () => {
  it('names the profile fields that are published', async () => {
    const { server, base } = await serve(() => ({
      status: 200,
      body: {
        username: 'someone',
        full_name: 'Jane Okonkwo',
        location: 'Bristol',
        company: 'Example Ltd',
        date_joined: '2015-03-04T00:00:00Z',
      },
    }));
    process.env.DOCKERHUB_API_BASE = base;

    try {
      const { findings } = await collect(dockerHubSource, context('someone', { name: 'Jane Okonkwo' }));
      const finding = findings[0]!;

      expect(finding.dataTypes).toEqual(
        expect.arrayContaining(['name', 'geolocation', 'employer']),
      );
      expect(finding.whyItMatters).toContain('a name, an employer and a location');
      expect(finding.whyItMatters).toContain('The name on it is the one you entered.');
      expect(finding.occurredAt?.year).toBe(2015);
      // The profile name matching the one searched for is real corroboration.
      expect(finding.confidence.signals.map((s) => s.id)).toContain('profile_corroborates_name');
    } finally {
      delete process.env.DOCKERHUB_API_BASE;
      server.close();
    }
  });

  it('treats a 404 as "no such user"', async () => {
    const { server, base } = await serve(() => ({ status: 404, body: { detail: 'Not found' } }));
    process.env.DOCKERHUB_API_BASE = base;

    try {
      const { findings } = await collect(dockerHubSource, context('nobody'));
      expect(findings).toHaveLength(0);
    } finally {
      delete process.env.DOCKERHUB_API_BASE;
      server.close();
    }
  });
});

describe('npm', () => {
  it('reports the package count and stays at "possible" on a username alone', async () => {
    const { server, base } = await serve(() => ({
      status: 200,
      body: {
        total: 42,
        objects: [
          { package: { name: 'left-pad', date: '2014-01-01T00:00:00Z' } },
          { package: { name: 'right-pad', date: '2016-01-01T00:00:00Z' } },
        ],
      },
    }));
    process.env.NPM_API_BASE = base;

    try {
      const { findings } = await collect(npmSource, context('someone'));
      expect(findings[0]!.title).toContain('42 packages');
      expect(findings[0]!.whyItMatters).toContain('left-pad');
      expect(findings[0]!.confidence.level).toBe('possible');
    } finally {
      delete process.env.NPM_API_BASE;
      server.close();
    }
  });

  it('treats a zero total as "no such maintainer"', async () => {
    const { server, base } = await serve(() => ({ status: 200, body: { total: 0, objects: [] } }));
    process.env.NPM_API_BASE = base;

    try {
      const { findings } = await collect(npmSource, context('nobody'));
      expect(findings).toHaveLength(0);
    } finally {
      delete process.env.NPM_API_BASE;
      server.close();
    }
  });
});

describe('Bitbucket', () => {
  it('reports a workspace and treats a 404 as absence', async () => {
    const present = await serve(() => ({
      status: 200,
      body: { slug: 'someone', name: 'Someone', is_private: false },
    }));
    process.env.BITBUCKET_API_BASE = present.base;

    try {
      const { findings } = await collect(bitbucketSource, context('someone'));
      expect(findings).toHaveLength(1);
      expect(findings[0]!.evidence?.url).toContain('bitbucket.org/someone');
    } finally {
      delete process.env.BITBUCKET_API_BASE;
      present.server.close();
    }

    const absent = await serve(() => ({ status: 404, body: { type: 'error' } }));
    process.env.BITBUCKET_API_BASE = absent.base;

    try {
      const { findings } = await collect(bitbucketSource, context('nobody'));
      expect(findings).toHaveLength(0);
    } finally {
      delete process.env.BITBUCKET_API_BASE;
      absent.server.close();
    }
  });
});

describe('every profile source', () => {
  it('skips cleanly when there is no handle to search', async () => {
    const identity = buildIdentity({ email: 'subject@example.test' });
    const ctx: ScanContext = { ...context('x'), identity, handles: [] };

    for (const source of [gitlabSource, dockerHubSource, npmSource, bitbucketSource]) {
      const { outcome } = await collect(source, ctx);
      expect(outcome.status).toBe('skipped');
    }
  });
});

describe('email masking', () => {
  it('keeps the domain readable but hides the local part', () => {
    expect(maskEmail('jane.okonkwo@example.com')).toBe('j••••••••@example.com');
    expect(maskEmail('a@example.com')).toBe('a•••@example.com');
    expect(maskEmail('not-an-address')).toBe('•••');
  });

  it('only shows an address in full when it is the one the person entered', () => {
    expect(presentEmail('Jane@Example.com', 'jane@example.com')).toBe('Jane@Example.com');
    expect(presentEmail('other@example.com', 'jane@example.com')).toBe('o••••@example.com');
  });
});
