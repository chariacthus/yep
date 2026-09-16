import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { describeError, HttpError, requestJson } from './http';
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
    if (!context.identity.username) {
      return { status: 'skipped', reason: 'No username was provided' };
    }

    const handle = reveal(context.identity.username);

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
        title: `${total} npm package${total === 1 ? ' is' : 's are'} published under your username`,
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
        }),
        evidence: {
          url: `https://www.npmjs.com/~${encodeURIComponent(handle)}`,
          label: 'View the packages',
        },
        whyItMatters:
          (names.length > 0 ? `Including ${names.slice(0, 3).join(', ')}. ` : '') +
          'Published packages are permanent and heavily indexed, so this handle is firmly attached to a public body of work. ' +
          'Package metadata commonly carries an author email address and a personal repository link that were added years ago and never revisited — worth checking what yours say.',
        actions: [
          {
            type: 'review_account',
            label: 'Check the author metadata on your packages',
            detail:
              'Look at the "author" and "repository" fields in each package.json. Published versions cannot be edited, but future releases can use a no-reply address instead.',
            url: `https://www.npmjs.com/~${encodeURIComponent(handle)}`,
          },
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
