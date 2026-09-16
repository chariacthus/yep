import { describe, expect, it } from 'vitest';
import { probeSite } from '@/lib/sources/usernames/prober';
import { qualifyHandles } from '@/lib/sources/usernames';
import type { Handle } from '@/lib/sources/types';
import { applyStripBadChars, evaluate, prepareSites, type PreparedSite } from '@/lib/sources/usernames/wmn';

/**
 * The username sweep makes roughly 700 outbound requests per scan against URLs
 * that come from a vendored community dataset. Two things are tested here: that
 * the match rule is applied exactly as the dataset defines it, and that a
 * malicious or mistaken dataset entry cannot turn this server into an SSRF
 * proxy against the network it runs in.
 */

function site(overrides: Partial<PreparedSite> = {}): PreparedSite {
  return {
    name: 'Example',
    uri_check: 'https://example.test/{account}',
    e_code: 200,
    e_string: 'profile-header',
    m_code: 404,
    m_string: 'not found',
    cat: 'social',
    host: 'example.test',
    tier: 2,
    sensitive: false,
    unreliable: false,
    ...overrides,
  };
}

describe('the match rule', () => {
  it('needs both the expected status and the expected body fragment', () => {
    expect(evaluate(site(), 200, '<div class="profile-header">')).toBe('found');
    expect(evaluate(site(), 200, 'something else entirely')).toBe('indeterminate');
  });

  it('treats an empty expectation string as "status alone is enough"', () => {
    expect(evaluate(site({ e_string: '' }), 200, '')).toBe('found');
  });

  it('recognises the dataset\'s negative case', () => {
    expect(evaluate(site(), 404, 'not found')).toBe('absent');
  });

  it('reports anything ambiguous as indeterminate rather than guessing', () => {
    // A 500, a captcha page, a redirect to a login wall -- all unknown, and
    // reporting them as "absent" would produce a false all-clear.
    expect(evaluate(site(), 500, 'server error')).toBe('indeterminate');
    expect(evaluate(site(), 403, 'cloudflare')).toBe('indeterminate');
  });

  it('strips characters the site cannot handle', () => {
    expect(applyStripBadChars('john.doe', site({ strip_bad_char: '.' }))).toBe('johndoe');
    expect(applyStripBadChars('john.doe', site())).toBe('john.doe');
  });
});

describe('the SSRF guard', () => {
  const options = { timeoutMs: 3000, signal: AbortSignal.timeout(5000) };

  it('refuses a host that is not in the vendored dataset', async () => {
    const result = await probeSite(
      site({ uri_check: 'https://attacker-controlled.invalid/{account}', host: 'attacker-controlled.invalid' }),
      'someone',
      options,
    );

    expect(result.blocked).toBe(true);
    expect(result.verdict).toBe('indeterminate');
  });

  it('refuses plain HTTP even for an allowed host', async () => {
    const real = prepareSites()[0]!;
    const result = await probeSite(
      { ...real, uri_check: real.uri_check.replace('https://', 'http://') },
      'someone',
      options,
    );

    expect(result.blocked).toBe(true);
  });

  it('refuses a dataset host that resolves to a private address', async () => {
    // localhost is a real, resolvable name that points at the loopback range.
    const result = await probeSite(
      site({ uri_check: 'https://localhost/{account}', host: 'localhost' }),
      'someone',
      options,
    );

    expect(result.blocked).toBe(true);
  });
});

describe('the prepared site list', () => {
  it('is non-empty and sorted with mainstream sites first', () => {
    const sites = prepareSites();

    expect(sites.length).toBeGreaterThan(500);
    expect(sites[0]!.tier).toBe(1);
    expect(sites.some((entry) => entry.tier === 1)).toBe(true);
  });

  it('marks categories where a match could out somebody', () => {
    const sites = prepareSites();
    const sensitive = sites.filter((entry) => entry.sensitive);

    expect(sensitive.length).toBeGreaterThan(0);
    for (const entry of sensitive) {
      expect(['xx NSFW xx', 'dating', 'political', 'health']).toContain(entry.cat);
    }
  });

  it('only ever contains https URLs', () => {
    for (const entry of prepareSites()) {
      expect(entry.uri_check.startsWith('https://')).toBe(true);
    }
  });
});

describe('handle qualification', () => {
  const given: Handle = { value: 'sindresorhus', derived: false, source: 'given' };
  const fromEmail: Handle = { value: 'jsmith', derived: true, source: 'email' };
  const fromName: Handle = { value: 'johnsmith', derived: true, source: 'name' };

  it('always sweeps the handle the person typed, hit or not', () => {
    expect(qualifyHandles([given], new Set())).toEqual([given]);
  });

  it('drops a guessed handle that exists nowhere mainstream', () => {
    // 670 more requests on behalf of a string we invented, producing matches
    // that are almost certainly other people. Not worth making.
    expect(qualifyHandles([given, fromEmail, fromName], new Set(['johnsmith']))).toEqual([
      given,
      fromName,
    ]);
  });

  it('keeps a guessed handle once something mainstream confirms it exists', () => {
    expect(qualifyHandles([fromEmail], new Set(['jsmith']))).toEqual([fromEmail]);
  });
});
