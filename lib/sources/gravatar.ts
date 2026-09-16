import { gravatarHash } from '../crypto';
import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { Finding } from '../normalize/finding';
import { describeError, HttpError, requestJson } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * Gravatar.
 *
 * Two reasons this source punches above its weight:
 *
 *   1. It is keyed on the SHA-256 of the address, so we send a hash rather than
 *      the address itself.
 *   2. Profiles list *verified* linked accounts. Those are the strongest
 *      corroboration signal available for the username sweep: if a person's
 *      Gravatar links to a GitHub account, a username match there stops being a
 *      coincidence. The linked accounts are published to
 *      `context` via the returned set so the username source can use them.
 */

/**
 * Read at call time rather than module load, so contract tests can point the
 * adapter at a local fixture server.
 */
function apiBase(): string {
  return process.env.GRAVATAR_API_BASE ?? 'https://api.gravatar.com/v3/profiles';
}

interface VerifiedAccount {
  service_type?: string;
  service_label?: string;
  url?: string;
}

interface GravatarProfile {
  hash?: string;
  display_name?: string;
  profile_url?: string;
  location?: string;
  description?: string;
  job_title?: string;
  company?: string;
  verified_accounts?: VerifiedAccount[];
}

function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return null;
  }
}

export const gravatarSource: Source = {
  id: 'gravatar',
  label: 'Gravatar',
  kind: 'profile',
  description:
    'Gravatar publishes a public profile for any address registered with it. We look this up by hash, so your address is never sent.',
  homepage: 'https://gravatar.com',
  requires: ['email'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const hash = gravatarHash(reveal(context.identity.emailNormalized));
    const apiKey = process.env.GRAVATAR_API_KEY;

    try {
      const profile = await requestJson<GravatarProfile>(`${apiBase()}/${hash}`, {
        headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {},
        signal: context.signal,
        timeoutMs: 8000,
      });

      // 404 means no Gravatar exists for this address. That is a clean result.
      if (!profile) return { status: 'ok', checked: 0 };

      const linked = (profile.verified_accounts ?? []).filter((account) => account.url);

      // Publish confirmed hosts so the username sweep can upgrade a bare
      // username match on one of these sites from "possible" to "likely".
      for (const account of linked) {
        const host = hostOf(account.url);
        if (host) context.corroboration.confirmedHosts.add(host);
      }

      const exposed: Finding['dataTypes'] = ['email', 'social_profile'];
      if (profile.display_name) exposed.push('name');
      if (profile.location) exposed.push('geolocation');
      if (profile.job_title || profile.company) exposed.push('employer');

      emit.finding({
        id: 'gravatar:profile',
        section: 'profiles',
        title: 'You have a public Gravatar profile',
        provider: { id: 'gravatar', label: 'Gravatar', url: 'https://gravatar.com' },
        origin: { name: 'Gravatar', domain: 'gravatar.com' },
        dataTypes: exposed,
        confidence: assessConfidence({
          signals: ['email_hash_exact', 'email_exact'],
          nameOnly: false,
        }),
        evidence: profile.profile_url
          ? { url: profile.profile_url, label: 'View your Gravatar profile' }
          : undefined,
        whyItMatters:
          'Looked up by a hash of your address, so any site you have commented on can fetch it. ' +
          (linked.length > 0
            ? `Yours links ${linked.length} other account${linked.length === 1 ? '' : 's'}.`
            : 'Yours is minimal.'),
        actions: [
          {
            type: 'review_privacy_settings',
            label: 'Hide your profile fields',
            detail: 'Anything visible is readable by anyone who knows your address.',
            url: 'https://gravatar.com/profile',
          },
          closeAccountAction('Gravatar', 'gravatar.com'),
          legalErasureAction('Automattic, who run Gravatar', 'https://automattic.com/privacy/'),
        ],
        educationKey: 'public_profile',
      });

      // Each verified linked account is itself a public exposure worth listing.
      for (const account of linked) {
        const host = hostOf(account.url);
        emit.finding({
          id: `gravatar:linked:${host ?? account.service_type ?? 'unknown'}`,
          section: 'profiles',
          title: `Your Gravatar links to ${account.service_label ?? host ?? 'another account'}`,
          provider: { id: 'gravatar', label: 'Gravatar', url: 'https://gravatar.com' },
          origin: { name: account.service_label ?? host ?? 'Linked account', domain: host ?? undefined },
          dataTypes: ['social_profile', 'username'],
          confidence: assessConfidence({
            signals: ['linked_account_verified', 'email_hash_exact'],
            nameOnly: false,
          }),
          evidence: account.url ? { url: account.url, label: 'Open the linked profile' } : undefined,
          whyItMatters:
            'Verified on Gravatar, so this account and your address are provably linked.',
          actions: [
            {
              type: 'review_privacy_settings',
              label: 'Unlink it',
              detail: 'Verified accounts can be removed at any time.',
              url: 'https://gravatar.com/profile',
            },
          ],
          educationKey: 'public_profile',
        });
      }

      return { status: 'ok', checked: 1 + linked.length };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
