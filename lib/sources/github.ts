import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { describeError, HttpError, requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * GitHub.
 *
 * Only the forward lookup is performed: does an account exist with this
 * username, and what does its public profile show. We deliberately do not
 * reverse-search commit metadata for the address — that technique is how people
 * de-anonymise developers, and building it into a self-assessment tool would
 * make it useful for the opposite purpose.
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
    const primary = context.handles[0];
    if (!primary) return { status: 'skipped', reason: 'No username to search for' };

    const token = process.env.GITHUB_TOKEN;
    const handle = primary.value;

    try {
      const user = await requestJson<GitHubUser>(`${apiBase()}/users/${encodeURIComponent(handle)}`, {
        headers: {
          accept: 'application/vnd.github+json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        signal: context.signal,
        timeoutMs: 8000,
      });

      if (!user?.login) return { status: 'ok', checked: 0 };

      const exposed: Array<'username' | 'name' | 'employer' | 'geolocation' | 'email' | 'social_profile'> = [
        'username',
        'social_profile',
      ];
      if (user.name) exposed.push('name');
      if (user.company) exposed.push('employer');
      if (user.location) exposed.push('geolocation');
      if (user.email) exposed.push('email');

      // A name shown on the profile that matches the one searched for turns a
      // bare username coincidence into real corroboration.
      const searchedName = context.identity.name ? reveal(context.identity.name) : undefined;
      const nameMatches =
        Boolean(searchedName && user.name) &&
        user.name!.trim().toLowerCase() === searchedName!.trim().toLowerCase();

      // A public profile email that matches is the strongest signal available.
      const emailMatches =
        Boolean(user.email) &&
        user.email!.trim().toLowerCase() === reveal(context.identity.emailNormalized);

      if (emailMatches) context.corroboration.confirmedHosts.add('github.com');

      const signals: Parameters<typeof assessConfidence>[0]['signals'] = ['username_exact'];
      if (nameMatches) signals.push('profile_corroborates_name');
      if (emailMatches) signals.push('profile_corroborates_email');

      emit.finding({
        id: 'github:profile',
        section: 'profiles',
        title: primary.derived
          ? `GitHub has an account called ${handle}`
          : 'A GitHub account exists with your username',
        provider: { id: 'github', label: 'GitHub', url: 'https://github.com' },
        origin: { name: 'GitHub', domain: 'github.com' },
        occurredAt: user.created_at
          ? { date: user.created_at.slice(0, 10), year: Number(user.created_at.slice(0, 4)), precision: 'day' }
          : undefined,
        dataTypes: exposed,
        confidence: assessConfidence({
          signals,
          nameOnly: false,
          usernameOnly: !nameMatches && !emailMatches,
          derivedHandle: primary.derived,
        }),
        evidence: user.html_url ? { url: user.html_url, label: 'View the profile' } : undefined,
        whyItMatters:
          (emailMatches ? 'Publishes your email address directly. ' : '') +
          'Location, employer and bio are public, and commit history can leak an address you did not mean to publish.',
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

      return { status: 'ok', checked: 1 };
    } catch (error) {
      if (error instanceof HttpError && (error.status === 429 || error.status === 403)) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
