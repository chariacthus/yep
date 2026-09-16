import { hibpSource } from './hibp';
import { xposedOrNotSource } from './xposedornot';
import { hudsonRockSource } from './hudsonrock';
import { gravatarSource } from './gravatar';
import { openPgpSource } from './openpgp';
import { githubSource } from './github';
import { gitlabSource } from './gitlab';
import { bitbucketSource } from './bitbucket';
import { dockerHubSource } from './dockerhub';
import { npmSource } from './npm';
import { leakCheckSource } from './leakcheck';
import { registrySources } from './registries';
import { emailDomainSource } from './email-domain';
import { waybackSource } from './wayback';
import { usernameSource } from './usernames';
import { brokerSource } from './brokers';
import { braveSearchSource } from './search/brave';
import { searxngSource } from './search/searxng';
import type { Source } from './types';

/**
 * Every source the scanner knows about.
 *
 * Order matters in one respect: the priming sources run first, because the
 * accounts they verify are used to corroborate later username matches.
 */
export const SOURCES: readonly Source[] = [
  gravatarSource,
  gitlabSource,
  xposedOrNotSource,
  leakCheckSource,
  hibpSource,
  hudsonRockSource,
  openPgpSource,
  emailDomainSource,
  githubSource,
  bitbucketSource,
  dockerHubSource,
  npmSource,
  ...registrySources,
  waybackSource,
  searxngSource,
  braveSearchSource,
  usernameSource,
  brokerSource,
];

/**
 * Sources that run to completion before the rest.
 *
 * Gravatar and GitLab can both prove that a specific account belongs to the
 * address being scanned, and publish that to `context.corroboration`. Running
 * them first means a later username match on one of those hosts is scored as
 * corroborated rather than as a bare coincidence.
 */
export const PRIMING_SOURCE_IDS: readonly string[] = ['gravatar', 'gitlab'];

/**
 * Hosts a dedicated source already covers.
 *
 * The WhatsMyName sweep checks these sites too, but a dedicated adapter returns
 * far more — a published email address, a real name, a package count — so a bare
 * "an account exists here" from the sweep is strictly worse information about
 * the same fact. The sweep skips them rather than reporting each site twice.
 *
 * Known at build time, so this needs no coordination between concurrent sources.
 */
const DEDICATED_DOMAINS: readonly string[] = [
  'github.com',
  'gitlab.com',
  'bitbucket.org',
  'docker.com',
  'npmjs.com',
  'gravatar.com',
  'openpgp.org',
  'rubygems.org',
  'packagist.org',
  'hex.pm',
];

/**
 * True when a dedicated source already covers this host.
 *
 * Matched by suffix rather than equality, because the dataset reaches the same
 * services through different hostnames — its GitHub entries call
 * `api.github.com`, not `github.com`, so an exact-match check let every GitHub
 * account be reported twice.
 */
export function hasDedicatedSource(host: string): boolean {
  const normalised = host.toLowerCase().replace(/^www\./, '');
  return DEDICATED_DOMAINS.some(
    (domain) => normalised === domain || normalised.endsWith(`.${domain}`),
  );
}

export function sourceById(id: string): Source | undefined {
  return SOURCES.find((source) => source.id === id);
}

/**
 * The sources that would transmit the raw address to a third party. Shown in
 * the consent step so the person can decline any of them individually.
 */
export function sourcesReceivingRawEmail(): Source[] {
  return SOURCES.filter((source) => source.sendsRawEmail);
}
