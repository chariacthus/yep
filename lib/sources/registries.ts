import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { Action, Finding } from '../normalize/finding';
import { requestJson } from './http';
import { presentEmail } from './mask';
import { sweepHandles } from './sweep-handles';
import type { Emit, Handle, ScanContext, Source, SourceOutcome } from './types';

/**
 * Package registries, as a family.
 *
 * These are worth checking for a reason that is easy to underrate: a published
 * package is permanent, heavily indexed, and its metadata routinely carries an
 * author email address and a personal URL that were filled in once, years ago,
 * and never looked at again. Unlike a social profile you can edit, a published
 * version cannot be changed — which makes it one of the few genuinely
 * irreversible exposures this tool can find.
 *
 * Each registry answers "does this handle exist" differently, so the negative
 * case is spelled out per registry. Getting that wrong is how a scanner ends up
 * reporting a confident match for every username anybody types.
 */

interface RegistrySpec {
  id: string;
  label: string;
  homepage: string;
  domain: string;
  /** Builds the lookup URL for a handle. */
  endpoint(handle: string, base: string): string;
  defaultBase: string;
  envBase: string;
  /**
   * Reads the response. Returns null when the handle is not in use — each
   * registry signals that differently, and a 404 is handled before this runs.
   */
  interpret(body: unknown): RegistryHit | null;
  /** The public profile page for a handle. */
  profileUrl(handle: string): string;
  /** How somebody removes or reduces what is published here. */
  removal: { detail: string; url: string };
}

interface RegistryHit {
  /** How many packages, when the registry says. */
  packageCount?: number;
  /** A few package names, for recognition. */
  samples?: string[];
  /** An email address published in the profile, if any. */
  publishedEmail?: string;
  /** Other accounts the profile links to. */
  linkedAccounts?: Array<{ label: string; url: string }>;
  displayName?: string;
}

const SPECS: RegistrySpec[] = [
  {
    id: 'rubygems',
    label: 'RubyGems',
    homepage: 'https://rubygems.org',
    domain: 'rubygems.org',
    defaultBase: 'https://rubygems.org/api/v1',
    envBase: 'RUBYGEMS_API_BASE',
    endpoint: (handle, base) => `${base}/owners/${encodeURIComponent(handle)}/gems.json`,
    profileUrl: (handle) => `https://rubygems.org/profiles/${encodeURIComponent(handle)}`,
    // A 404 means no such account; an empty array means the account exists but
    // owns nothing, which is still an account.
    interpret(body) {
      if (!Array.isArray(body)) return null;
      return {
        packageCount: body.length,
        samples: body
          .slice(0, 3)
          .map((gem) => (gem as { name?: string }).name)
          .filter((name): name is string => Boolean(name)),
      };
    },
    removal: {
      detail:
        'RubyGems lets you remove your profile details and transfer or yank gems. Published versions stay available by design, so the realistic goal is cleaning the metadata on future releases.',
      url: 'https://rubygems.org/settings/edit',
    },
  },
  {
    id: 'packagist',
    label: 'Packagist',
    homepage: 'https://packagist.org',
    domain: 'packagist.org',
    defaultBase: 'https://packagist.org',
    envBase: 'PACKAGIST_API_BASE',
    endpoint: (handle, base) => `${base}/packages/list.json?vendor=${encodeURIComponent(handle)}`,
    profileUrl: (handle) => `https://packagist.org/packages/${encodeURIComponent(handle)}/`,
    interpret(body) {
      const names = (body as { packageNames?: unknown })?.packageNames;
      if (!Array.isArray(names) || names.length === 0) return null;
      return {
        packageCount: names.length,
        samples: names.slice(0, 3).filter((name): name is string => typeof name === 'string'),
      };
    },
    removal: {
      detail:
        'Packagist mirrors package metadata from your source repository, so the author details come from composer.json. Fixing them there and tagging a release updates what Packagist shows.',
      url: 'https://packagist.org/profile/',
    },
  },
  {
    id: 'hexpm',
    label: 'Hex.pm',
    homepage: 'https://hex.pm',
    domain: 'hex.pm',
    defaultBase: 'https://hex.pm/api',
    envBase: 'HEXPM_API_BASE',
    endpoint: (handle, base) => `${base}/users/${encodeURIComponent(handle)}`,
    profileUrl: (handle) => `https://hex.pm/users/${encodeURIComponent(handle)}`,
    // Hex publishes an email and a map of linked handles, which makes it the
    // most revealing of these registries by some distance.
    interpret(body) {
      const user = body as {
        username?: string;
        email?: string;
        handles?: Record<string, string>;
        packages?: unknown[];
      };
      if (!user?.username) return null;

      const linked = Object.entries(user.handles ?? {})
        .filter(([, url]) => typeof url === 'string' && url.startsWith('http'))
        .map(([label, url]) => ({ label, url }));

      return {
        displayName: user.username,
        publishedEmail: user.email,
        linkedAccounts: linked,
        packageCount: Array.isArray(user.packages) ? user.packages.length : undefined,
      };
    },
    removal: {
      detail:
        'Hex publishes your email address and any handles you added to your profile. Both can be cleared from your account settings.',
      url: 'https://hex.pm/dashboard/profile',
    },
  },
];

function buildFinding(
  spec: RegistrySpec,
  hit: RegistryHit,
  handle: string,
  enteredEmail: string,
  context: ScanContext,
  derivedHandle: boolean,
  handleSource: 'given' | 'email' | 'name',
): Finding {
  const emailMatches = Boolean(
    hit.publishedEmail && hit.publishedEmail.trim().toLowerCase() === enteredEmail,
  );
  if (emailMatches) context.corroboration.confirmedHosts.add(spec.domain);

  const signals: Parameters<typeof assessConfidence>[0]['signals'] = ['username_exact'];
  if (emailMatches) signals.push('profile_corroborates_email');

  const dataTypes: Finding['dataTypes'] = ['username', 'social_profile'];
  if (hit.publishedEmail) dataTypes.push('email');
  if (hit.displayName) dataTypes.push('name');

  // An account that owns nothing is still an account, but saying "you publish
  // packages" about somebody who publishes none would be plainly wrong.
  const publishes = (hit.packageCount ?? 0) > 0;

  const details: string[] = [];
  if (publishes) {
    details.push(
      `${hit.packageCount} package${hit.packageCount === 1 ? '' : 's'} published under this handle` +
        (hit.samples?.length ? `, including ${hit.samples.join(', ')}` : '') +
        '.',
    );
  } else {
    details.push(
      'An account exists under this handle but publishes nothing.',
    );
  }
  if (hit.publishedEmail) {
    details.push(
      `Publishes ${presentEmail(hit.publishedEmail, enteredEmail)} — scraped addresses get spam and phishing.`,
    );
  }
  if (hit.linkedAccounts?.length) {
    details.push(
      `Links to ${hit.linkedAccounts.map((account) => account.label).join(', ')}.`,
    );
  }
  if (publishes) {
    details.push('Published versions are immutable — the author details in them cannot be edited.');
  }

  const actions: Action[] = [
    {
      type: 'review_privacy_settings',
      label: `Clean up your ${spec.label} profile`,
      detail: spec.removal.detail,
      url: spec.removal.url,
    },
  ];

  if (publishes) {
    actions.push({
      type: 'review_account',
      label: 'Use a no-reply address on future releases',
      detail:
        'Package metadata does not have to carry a real address. A dedicated alias, or the no-reply address your code host provides, keeps future versions from adding to this.',
    });
  } else {
    actions.push({
      type: 'close_account',
      label: `Close the ${spec.label} account if you do not use it`,
      detail:
        'An unused account still holds whatever you gave it at signup, and is one more place that can be breached. Closing it removes both.',
      url: spec.removal.url,
    });
  }

  if (hit.linkedAccounts?.length) {
    actions.push({
      type: 'review_privacy_settings',
      label: 'Unlink the accounts you did not mean to connect',
      detail: `This profile publicly links: ${hit.linkedAccounts.map((account) => account.label).join(', ')}. Each one can be removed from your profile settings.`,
      url: spec.removal.url,
    });
  }

  return {
    id: `registry:${spec.id}:${handle}`,
    section: 'profiles',
    title: publishes
      ? `${spec.label} — ${derivedHandle ? `${handle}, ` : ''}${hit.packageCount} package${hit.packageCount === 1 ? '' : 's'}`
      : derivedHandle
        ? `${spec.label} — ${handle}`
        : `${spec.label} account`,
    provider: { id: spec.id, label: spec.label, url: spec.homepage },
    origin: { name: spec.label, domain: spec.domain },
    dataTypes,
    confidence: assessConfidence({
      signals,
      nameOnly: false,
      usernameOnly: !emailMatches,
      derivedHandle,
      handleSource,
    }),
    evidence: { url: spec.profileUrl(handle), label: `View the ${spec.label} profile` },
    whyItMatters: details.join(' '),
    actions,
    educationKey: 'username_reuse',
  };
}

function makeSource(spec: RegistrySpec): Source {
  return {
    id: spec.id,
    label: spec.label,
    kind: 'profile',
    description: `Checks whether packages are published under your username on ${spec.label}. Package metadata often carries an author email.`,
    homepage: spec.homepage,
    requires: ['username'],
    sendsRawEmail: false,
    requiredEnv: [],

    async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
      if (context.handles.length === 0) {
        return { status: 'skipped', reason: 'No username to search for' };
      }

      const base = process.env[spec.envBase] ?? spec.defaultBase;

      const check = async (handle: Handle): Promise<number> => {
        const body = await requestJson<unknown>(spec.endpoint(handle.value, base), {
          signal: context.signal,
          timeoutMs: 8000,
        });

        // requestJson turns a 404 into null, which every one of these registries
        // uses to mean "no such handle".
        if (body === null) return 0;

        const hit = spec.interpret(body);
        if (!hit) return 0;

        emit.finding(
          buildFinding(
            spec,
            hit,
            handle.value,
            reveal(context.identity.emailNormalized),
            context,
            handle.derived,
            handle.source,
          ),
        );
        return 1;
      };

      return sweepHandles(context, check);
    },
  };
}

export const registrySources: Source[] = SPECS.map(makeSource);
