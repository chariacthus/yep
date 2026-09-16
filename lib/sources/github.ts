import { assessConfidence } from '../confidence/score';
import { corroborate } from './corroborate';
import { requestJson } from './http';
import { sweepHandles } from './sweep-handles';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, Handle, ScanContext, Source, SourceOutcome } from './types';

/**
 * GitHub.
 *
 * Only the forward lookup is performed: does an account exist with this
 * username, and what does its public profile show. We deliberately do not
 * reverse-search commit metadata for the address — that technique is how people
 * de-anonymise developers, and building it into a self-assessment tool would
 * make it useful for the opposite purpose.
 *
 * Every handle is checked, not just the one that was typed. A name-derived
 * handle that turns out to carry the right name and town is exactly the kind of
 * account somebody has forgotten they own.
 */

/**
 * Read at call time rather than module load, so contract tests can point the
 * adapter at a local fixture server.
 */
function apiBase(): string {
  return process.env.GITHUB_API_BASE ?? 'https://api.github.com';
}

interface GitHubUser {
  login?: string;
  name?: string;
  html_url?: string;
  company?: string;
  location?: string;
  email?: string;
  blog?: string;
  bio?: string;
  created_at?: string;
}

export const githubSource: Source = {
  id: 'github',
  label: 'GitHub',
  kind: 'profile',
  description:
    'Looks up the public profile for your username. A token is optional and only raises the request limit.',
  homepage: 'https://github.com',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (context.handles.length === 0) {
      return { status: 'skipped', reason: 'No username to search for' };
    }

    const token = process.env.GITHUB_TOKEN;

    const check = async (handle: Handle): Promise<number> => {
      const user = await requestJson<GitHubUser>(
        `${apiBase()}/users/${encodeURIComponent(handle.value)}`,
        {
          headers: {
            accept: 'application/vnd.github+json',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          signal: context.signal,
          timeoutMs: 8000,
        },
      );

      if (!user?.login) return 0;

      const match = corroborate(context, {
        name: user.name,
        location: user.location,
        email: user.email,
      });

      if (match.emailMatches) context.corroboration.confirmedHosts.add('github.com');

      const exposed: Array<'username' | 'name' | 'employer' | 'geolocation' | 'email' | 'social_profile'> =
        ['username', 'social_profile'];
      if (user.name) exposed.push('name');
      if (user.company) exposed.push('employer');
      if (user.location) exposed.push('geolocation');
      if (user.email) exposed.push('email');

      emit.finding({
        id: `github:profile:${handle.value}`,
        section: 'profiles',
        title: handle.derived ? `GitHub — ${handle.value}` : 'GitHub account',
        provider: { id: 'github', label: 'GitHub', url: 'https://github.com' },
        origin: { name: 'GitHub', domain: 'github.com' },
        occurredAt: user.created_at
          ? {
              date: user.created_at.slice(0, 10),
              year: Number(user.created_at.slice(0, 4)),
              precision: 'day',
            }
          : undefined,
        dataTypes: exposed,
        confidence: assessConfidence({
          signals: ['username_exact', ...match.signals],
          nameOnly: false,
          usernameOnly: match.usernameOnly,
          derivedHandle: handle.derived,
          handleSource: handle.source,
        }),
        evidence: user.html_url
          ? { url: user.html_url, label: 'View the profile' }
          : undefined,
        whyItMatters:
          'Location, employer and bio are public, and commit history can leak an address you did not mean to publish.' +
          (match.note ? ` ${match.note}` : ''),
        actions: [
          {
            type: 'review_privacy_settings',
            label: 'Hide your email',
            detail: 'Settings → Emails → Keep my email addresses private also blocks leaky pushes.',
            url: 'https://github.com/settings/emails',
          },
          closeAccountAction('GitHub', 'github.com'),
          legalErasureAction('GitHub', 'https://github.com/settings/admin'),
        ],
        educationKey: 'public_profile',
      });

      return 1;
    };

    return sweepHandles(context, check);
  },
};
