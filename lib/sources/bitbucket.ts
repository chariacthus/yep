import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { SignalId } from '../confidence/signals';
import { describeError, HttpError, requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * Bitbucket.
 *
 * Atlassian retired the public user endpoint, but workspaces — which are created
 * with the same slug as the account — remain publicly readable and carry a
 * display name. It is a modest signal on its own; its value is as another
 * corroborating point in a chain of reused handles.
 */

function apiBase(): string {
  return process.env.BITBUCKET_API_BASE ?? 'https://api.bitbucket.org/2.0';
}

interface Workspace {
  slug?: string;
  name?: string;
  is_private?: boolean;
}

export const bitbucketSource: Source = {
  id: 'bitbucket',
  label: 'Bitbucket',
  kind: 'profile',
  description: 'Checks for a public Bitbucket workspace matching your username.',
  homepage: 'https://bitbucket.org',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const primary = context.handles[0];
    if (!primary) return { status: 'skipped', reason: 'No username to search for' };

    const handle = primary.value;

    try {
      const workspace = await requestJson<Workspace>(
        `${apiBase()}/workspaces/${encodeURIComponent(handle)}`,
        { signal: context.signal, timeoutMs: 8000 },
      );

      if (!workspace?.slug) return { status: 'ok', checked: 0 };

      const searchedName = context.identity.name ? reveal(context.identity.name) : undefined;
      const nameMatches =
        Boolean(searchedName && workspace.name) &&
        workspace.name!.trim().toLowerCase() === searchedName!.trim().toLowerCase();

      const signals: SignalId[] = ['username_exact'];
      if (nameMatches) signals.push('profile_corroborates_name');

      emit.finding({
        id: 'bitbucket:workspace',
        section: 'profiles',
        title: primary.derived
          ? `Bitbucket has a workspace called ${handle}`
          : 'A Bitbucket workspace exists with your username',
        provider: { id: 'bitbucket', label: 'Bitbucket', url: 'https://bitbucket.org' },
        origin: { name: 'Bitbucket', domain: 'bitbucket.org' },
        dataTypes: nameMatches ? ['username', 'social_profile', 'name'] : ['username', 'social_profile'],
        confidence: assessConfidence({
          signals,
          nameOnly: false,
          usernameOnly: !nameMatches,
          derivedHandle: primary.derived,
        }),
        evidence: {
          url: `https://bitbucket.org/${encodeURIComponent(handle)}/`,
          label: 'View the workspace',
        },
        whyItMatters: `Named "${workspace.name ?? handle}". Any public repository inside it is readable, commit history included.`,
        actions: [
          {
            type: 'review_account',
            label: 'Check repository visibility',
            detail: 'A private workspace can still contain public repositories.',
            url: `https://bitbucket.org/${encodeURIComponent(handle)}/workspace/repositories/`,
          },
          closeAccountAction('Bitbucket', 'bitbucket.org'),
          legalErasureAction('Atlassian', 'https://www.atlassian.com/legal/privacy-policy'),
        ],
        educationKey: 'username_reuse',
      });

      return { status: 'ok', checked: 1 };
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 403)) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
