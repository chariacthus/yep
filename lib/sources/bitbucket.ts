import { assessConfidence } from '../confidence/score';
import { corroborate } from './corroborate';
import { requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import { sweepHandles } from './sweep-handles';
import type { Emit, Handle, ScanContext, Source, SourceOutcome } from './types';

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
    if (context.handles.length === 0) {
      return { status: 'skipped', reason: 'No username to search for' };
    }

    const check = async (handle: Handle): Promise<number> => {
      const workspace = await requestJson<Workspace>(
        `${apiBase()}/workspaces/${encodeURIComponent(handle.value)}`,
        { signal: context.signal, timeoutMs: 8000 },
      );

      if (!workspace?.slug) return 0;

      const match = corroborate(context, { name: workspace.name });
      const url = `https://bitbucket.org/${encodeURIComponent(handle.value)}/`;

      emit.finding({
        id: `bitbucket:workspace:${handle.value}`,
        section: 'profiles',
        title: handle.derived ? `Bitbucket — ${handle.value}` : 'Bitbucket workspace',
        provider: { id: 'bitbucket', label: 'Bitbucket', url: 'https://bitbucket.org' },
        origin: { name: 'Bitbucket', domain: 'bitbucket.org' },
        dataTypes: workspace.name
          ? ['username', 'social_profile', 'name']
          : ['username', 'social_profile'],
        confidence: assessConfidence({
          signals: ['username_exact', ...match.signals],
          nameOnly: false,
          usernameOnly: match.usernameOnly,
          derivedHandle: handle.derived,
          handleSource: handle.source,
        }),
        evidence: { url, label: 'View the workspace' },
        whyItMatters: `Named "${workspace.name ?? handle.value}". Any public repository inside it is readable, commit history included.`,
        actions: [
          {
            type: 'review_account',
            label: 'Check repository visibility',
            detail: 'A private workspace can still contain public repositories.',
            url: `${url}workspace/repositories/`,
          },
          closeAccountAction('Bitbucket', 'bitbucket.org'),
          legalErasureAction('Atlassian', 'https://www.atlassian.com/legal/privacy-policy'),
        ],
        educationKey: 'username_reuse',
      });

      return 1;
    };

    return sweepHandles(context, check);
  },
};
