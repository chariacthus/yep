import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { SignalId } from '../confidence/signals';
import { describeError, HttpError, requestJson } from './http';
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
    if (!context.identity.username) {
      return { status: 'skipped', reason: 'No username was provided' };
    }

    const handle = reveal(context.identity.username);

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
        title: 'A Bitbucket workspace exists with your username',
        provider: { id: 'bitbucket', label: 'Bitbucket', url: 'https://bitbucket.org' },
        origin: { name: 'Bitbucket', domain: 'bitbucket.org' },
        dataTypes: nameMatches ? ['username', 'social_profile', 'name'] : ['username', 'social_profile'],
        confidence: assessConfidence({
          signals,
          nameOnly: false,
          usernameOnly: !nameMatches,
        }),
        evidence: {
          url: `https://bitbucket.org/${encodeURIComponent(handle)}/`,
          label: 'View the workspace',
        },
        whyItMatters:
          `The workspace is named "${workspace.name ?? handle}" and is readable by anyone who guesses the slug. ` +
          'Any repository left public inside it is readable too, along with its commit history and the addresses in it.',
        actions: [
          {
            type: 'review_account',
            label: 'Check which repositories in this workspace are public',
            detail:
              'Repository visibility is per-repository on Bitbucket; a private workspace can still contain public repositories.',
            url: `https://bitbucket.org/${encodeURIComponent(handle)}/workspace/repositories/`,
          },
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
