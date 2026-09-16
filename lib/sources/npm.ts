import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { describeError, HttpError, requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * The npm registry.
 *
 * Published packages are a durable, highly indexed public record tied to a
 * handle. They also frequently carry more than their author intends: an author
 * email in package.json, a personal repository URL, a homepage. We report the
 * association and the count, and point at the metadata to review — we do not
 * mine the addresses out of it.
 */

function apiBase(): string {
  return process.env.NPM_API_BASE ?? 'https://registry.npmjs.org';
}

interface SearchResponse {
  total?: number;
  objects?: Array<{
    package?: { name?: string; date?: string; links?: { npm?: string } };
  }>;
}

const SAMPLE_SIZE = 5;

export const npmSource: Source = {
  id: 'npm',
  label: 'npm registry',
  kind: 'profile',
  description:
    'Checks whether packages have been published under your username. Package metadata often contains an author email.',
  homepage: 'https://www.npmjs.com',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const primary = context.handles[0];
    if (!primary) return { status: 'skipped', reason: 'No username to search for' };

    const handle = primary.value;

    try {
      const result = await requestJson<SearchResponse>(
        `${apiBase()}/-/v1/search?text=maintainer:${encodeURIComponent(handle)}&size=${SAMPLE_SIZE}`,
        { signal: context.signal, timeoutMs: 10_000 },
      );

      const total = result?.total ?? 0;
      if (total === 0) return { status: 'ok', checked: 0 };

      const names = (result?.objects ?? [])
        .map((entry) => entry.package?.name)
        .filter((name): name is string => Boolean(name));

      emit.finding({
        id: 'npm:packages',
        section: 'profiles',
        title: primary.derived
          ? `${total} npm package${total === 1 ? '' : 's'} published by ${handle}`
          : `${total} npm package${total === 1 ? ' is' : 's are'} published under your username`,
        provider: { id: 'npm', label: 'npm registry', url: 'https://www.npmjs.com' },
        origin: { name: 'npm', domain: 'npmjs.com' },
        // No date: the API returns a page of results, so the earliest date in a
        // sample of five says nothing about when this handle started publishing.
        // Showing it as "when" would be a fabricated fact.
        dataTypes: ['username', 'social_profile'],
        confidence: assessConfidence({
          signals: ['username_exact'],
          nameOnly: false,
          usernameOnly: true,
          derivedHandle: primary.derived,
        }),
        evidence: {
          url: `https://www.npmjs.com/~${encodeURIComponent(handle)}`,
          label: 'View the packages',
        },
        whyItMatters:
          (names.length > 0 ? `Including ${names.slice(0, 3).join(', ')}. ` : '') +
          'Package metadata usually carries an author email added years ago and never revisited.',
        actions: [
          {
            type: 'review_account',
            label: 'Check your package.json author fields',
            detail: 'Published versions are frozen, but future releases can use a no-reply address.',
            url: `https://www.npmjs.com/~${encodeURIComponent(handle)}`,
          },
          {
            type: 'review_privacy_settings',
            label: 'Hide your email on your npm profile',
            detail:
              'npm shows the address on your public profile unless you clear it. Published package metadata is immutable, but the profile is not.',
            url: 'https://www.npmjs.com/settings/~/profile',
          },
          closeAccountAction('npm', 'npmjs.com'),
        ],
        educationKey: 'username_reuse',
      });

      return { status: 'ok', checked: 1 };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
