import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { SignalId } from '../confidence/signals';
import type { DataType } from '../normalize/finding';
import { describeError, HttpError, requestJson } from './http';
import { presentEmail } from './mask';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * GitLab.
 *
 * Worth more than a bare existence check because GitLab profiles can publish a
 * `public_email`, which people set once and forget. Two consequences:
 *
 *   - If it matches the address being scanned, that is strong corroboration, and
 *     gitlab.com is published to the shared corroboration set so the username
 *     sweep can promote its own match on this host.
 *   - If it is a different address, it is an exposure in its own right, and is
 *     reported masked (see lib/sources/mask.ts).
 */

function apiBase(): string {
  return process.env.GITLAB_API_BASE ?? 'https://gitlab.com/api/v4';
}

interface GitLabUser {
  username?: string;
  name?: string;
  state?: string;
  public_email?: string;
  web_url?: string;
  avatar_url?: string;
}

export const gitlabSource: Source = {
  id: 'gitlab',
  label: 'GitLab',
  kind: 'profile',
  description:
    'Looks up the public GitLab profile for your username, including any email address published on it.',
  homepage: 'https://gitlab.com',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const primary = context.handles[0];
    if (!primary) return { status: 'skipped', reason: 'No username to search for' };

    const handle = primary.value;
    const entered = reveal(context.identity.emailNormalized);

    try {
      const users = await requestJson<GitLabUser[]>(
        `${apiBase()}/users?username=${encodeURIComponent(handle)}`,
        { signal: context.signal, timeoutMs: 8000 },
      );

      // An empty array is how GitLab says the username is free.
      const user = Array.isArray(users) ? users[0] : undefined;
      if (!user?.username) return { status: 'ok', checked: 0 };

      const publishedEmail = user.public_email?.trim();
      const emailMatches = Boolean(
        publishedEmail && publishedEmail.toLowerCase() === entered,
      );

      if (emailMatches) context.corroboration.confirmedHosts.add('gitlab.com');

      const searchedName = context.identity.name ? reveal(context.identity.name) : undefined;
      const nameMatches =
        Boolean(searchedName && user.name) &&
        user.name!.trim().toLowerCase() === searchedName!.trim().toLowerCase();

      const signals: SignalId[] = ['username_exact'];
      if (emailMatches) signals.push('profile_corroborates_email');
      if (nameMatches) signals.push('profile_corroborates_name');

      const dataTypes: DataType[] = ['username', 'social_profile'];
      if (user.name) dataTypes.push('name');
      if (publishedEmail) dataTypes.push('email');

      emit.finding({
        id: 'gitlab:profile',
        section: 'profiles',
        title: primary.derived
          ? `GitLab has an account called ${handle}`
          : 'A GitLab account exists with your username',
        provider: { id: 'gitlab', label: 'GitLab', url: 'https://gitlab.com' },
        origin: { name: 'GitLab', domain: 'gitlab.com' },
        dataTypes,
        confidence: assessConfidence({
          signals,
          nameOnly: false,
          usernameOnly: !emailMatches && !nameMatches,
          derivedHandle: primary.derived,
        }),
        evidence: user.web_url ? { url: user.web_url, label: 'View the profile' } : undefined,
        whyItMatters: publishedEmail
          ? `Publishes ${presentEmail(publishedEmail, entered)} where anyone can read it. ` +
            (emailMatches
              ? 'That is the address you are scanning, so this account and it are publicly linked.'
              : 'Not the address you entered — a second account of yours, or someone else.')
          : 'Public profile. Commit history can expose an email you did not mean to publish.',
        actions: [
          {
            type: 'review_privacy_settings',
            label: 'Clear your public email',
            detail: 'Clear the public email field and hide your activity under Preferences.',
            url: 'https://gitlab.com/-/profile',
          },
          closeAccountAction('GitLab', 'gitlab.com'),
          legalErasureAction('GitLab', 'https://gitlab.com/-/profile/account'),
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
