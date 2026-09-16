import type { SignalId } from '../confidence/signals';
import { reveal } from '../identity';
import type { ScanContext } from './types';

/**
 * Does this public profile belong to the person who ran the scan?
 *
 * A username match on its own says very little — handles are not unique, and a
 * handle we guessed from an email address says less still. What settles it is
 * the rest of the profile: the name printed on it, the town in the location
 * field, the address published in the contact field.
 *
 * Every profile adapter asks the same question, so it is answered in one place.
 * Matching is deliberately conservative: a false corroboration promotes somebody
 * else's account to "Confirmed", which is the worst failure this tool has.
 */

export interface ProfileAttributes {
  /** The display or full name shown on the profile. */
  name?: string;
  /** The free-text location field, e.g. "Bristol, UK". */
  location?: string;
  /** An email address published on the profile. */
  email?: string;
}

export interface Corroboration {
  signals: SignalId[];
  nameMatches: boolean;
  localityMatches: boolean;
  emailMatches: boolean;
  /** True when nothing beyond the handle itself lines up. */
  usernameOnly: boolean;
  /** A sentence for `whyItMatters`, naming whatever lined up. */
  note?: string;
}

/** Lowercase, unaccent, and reduce punctuation to single spaces. */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: string): string[] {
  return normalize(value).split(' ').filter(Boolean);
}

/**
 * "John Smith" matches "John Smith" and "John A. Smith", but not "Johnny
 * Smithers" — every word of the entered name has to appear as a whole word.
 */
function namesAgree(profileName: string, entered: string): boolean {
  const wanted = tokens(entered);
  if (wanted.length === 0) return false;
  const present = new Set(tokens(profileName));
  return wanted.every((word) => present.has(word));
}

/**
 * Location fields are free text — "Bristol", "Bristol, UK", "Bristol / London".
 * A whole-word appearance of the town is the most that can be claimed, and very
 * short towns are skipped because they collide with everything.
 */
function localitiesAgree(profileLocation: string, entered: string): boolean {
  const wanted = normalize(entered);
  if (wanted.length < 3) return false;
  const present = tokens(profileLocation);
  const wantedWords = wanted.split(' ');
  return wantedWords.every((word) => present.includes(word));
}

export function corroborate(
  context: ScanContext,
  profile: ProfileAttributes,
): Corroboration {
  const enteredEmail = reveal(context.identity.emailNormalized);
  const enteredName = context.identity.name ? reveal(context.identity.name) : undefined;
  const enteredLocality = context.identity.locality
    ? reveal(context.identity.locality)
    : undefined;

  const emailMatches = Boolean(
    profile.email && profile.email.trim().toLowerCase() === enteredEmail,
  );
  const nameMatches = Boolean(
    enteredName && profile.name && namesAgree(profile.name, enteredName),
  );
  // A town on its own is not corroboration — plenty of strangers live there.
  // It only counts once the name has already lined up.
  const localityMatches =
    nameMatches &&
    Boolean(enteredLocality && profile.location && localitiesAgree(profile.location, enteredLocality));

  const signals: SignalId[] = [];
  if (emailMatches) signals.push('profile_corroborates_email');
  if (nameMatches) signals.push('profile_corroborates_name');
  if (localityMatches) signals.push('profile_corroborates_locality');

  const shown = [
    emailMatches ? 'email address' : null,
    nameMatches ? 'name' : null,
    localityMatches ? 'town' : null,
  ].filter((item): item is string => Boolean(item));

  const note =
    shown.length === 0
      ? undefined
      : shown.length === 1
        ? `The ${shown[0]} on it is the one you entered.`
        : `The ${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]} on it are the ones you entered.`;

  return {
    signals,
    nameMatches,
    localityMatches,
    emailMatches,
    usernameOnly: signals.length === 0,
    note,
  };
}
