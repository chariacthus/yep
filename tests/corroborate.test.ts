import { describe, expect, it } from 'vitest';
import { buildIdentity } from '@/lib/identity';
import { corroborate } from '@/lib/sources/corroborate';
import type { ScanContext } from '@/lib/sources/types';

/**
 * A false corroboration is the worst failure this tool has: it promotes a
 * stranger's account to a confident match against somebody's real name. So the
 * matching rules are pinned here, and the negative cases outnumber the positive
 * ones on purpose.
 */

function context(fields: { email?: string; name?: string; locality?: string } = {}): ScanContext {
  return {
    identity: buildIdentity({
      email: fields.email ?? 'subject@example.test',
      name: fields.name,
      locality: fields.locality,
    }),
    handles: [],
    emailVerified: false,
    includeSensitive: false,
    declinedSources: new Set(),
    corroboration: { confirmedHosts: new Set() },
    deadline: Date.now() + 10_000,
    signal: AbortSignal.timeout(10_000),
  };
}

describe('matching a profile against the details entered', () => {
  it('takes an exact email match as the strongest signal there is', () => {
    const match = corroborate(context({ email: 'jane@example.test' }), {
      email: ' Jane@Example.Test ',
    });

    expect(match.emailMatches).toBe(true);
    expect(match.signals).toContain('profile_corroborates_email');
    expect(match.usernameOnly).toBe(false);
  });

  it('matches a name through middle names, accents and punctuation', () => {
    expect(corroborate(context({ name: 'Jane Okonkwo' }), { name: 'Jane A. Okonkwo' }).nameMatches)
      .toBe(true);
    expect(corroborate(context({ name: 'Zoe Muller' }), { name: 'Zoë Müller' }).nameMatches)
      .toBe(true);
  });

  it('does not match a name that merely starts the same way', () => {
    // "Johnny Smithers" contains neither "john" nor "smith" as whole words.
    expect(corroborate(context({ name: 'John Smith' }), { name: 'Johnny Smithers' }).nameMatches)
      .toBe(false);
  });

  it('reads a town out of a free-text location field', () => {
    const match = corroborate(context({ name: 'Jane Okonkwo', locality: 'Bristol' }), {
      name: 'Jane Okonkwo',
      location: 'Bristol, UK',
    });

    expect(match.localityMatches).toBe(true);
    expect(match.signals).toContain('profile_corroborates_locality');
    expect(match.note).toBe('The name and town on it are the ones you entered.');
  });

  it('will not let a town corroborate anything on its own', () => {
    // Thousands of strangers live in the same town. Without the name lining up
    // first, a location field is worth nothing.
    const match = corroborate(context({ name: 'Jane Okonkwo', locality: 'Bristol' }), {
      name: 'Someone Else',
      location: 'Bristol, UK',
    });

    expect(match.localityMatches).toBe(false);
    expect(match.usernameOnly).toBe(true);
  });

  it('ignores a town too short to be discriminating', () => {
    const match = corroborate(context({ name: 'Jane Okonkwo', locality: 'Ur' }), {
      name: 'Jane Okonkwo',
      location: 'Urbana, Illinois',
    });

    expect(match.localityMatches).toBe(false);
  });

  it('says nothing when a profile carries nothing to compare', () => {
    const match = corroborate(context({ name: 'Jane Okonkwo' }), {});

    expect(match.usernameOnly).toBe(true);
    expect(match.signals).toEqual([]);
    expect(match.note).toBeUndefined();
  });
});
