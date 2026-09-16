import { hibpSource } from './hibp';
import { xposedOrNotSource } from './xposedornot';
import { hudsonRockSource } from './hudsonrock';
import { gravatarSource } from './gravatar';
import { openPgpSource } from './openpgp';
import { githubSource } from './github';
import { waybackSource } from './wayback';
import { usernameSource } from './usernames';
import { brokerSource } from './brokers';
import { braveSearchSource } from './search/brave';
import type { Source } from './types';

/**
 * Every source the scanner knows about.
 *
 * Order matters in one respect: Gravatar runs early because the accounts it
 * verifies are used to corroborate later username matches.
 */
export const SOURCES: readonly Source[] = [
  gravatarSource,
  hibpSource,
  xposedOrNotSource,
  hudsonRockSource,
  openPgpSource,
  githubSource,
  waybackSource,
  braveSearchSource,
  usernameSource,
  brokerSource,
];

/** Sources that run before the rest, because others depend on what they learn. */
export const PRIMING_SOURCE_IDS: readonly string[] = ['gravatar'];

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
