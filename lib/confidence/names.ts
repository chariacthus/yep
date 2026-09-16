import namesData from '../../data/common-names.json';

/**
 * How much to discount a name-only match.
 *
 * "John Smith" matching a random web page tells you almost nothing; a rare name
 * matching tells you rather more. The penalty scales with how common the given
 * name and surname actually are, using published frequency data rather than a
 * hand-waved guess.
 *
 * Source: US Census Bureau frequently occurring surnames and given names.
 * Public domain. See scripts/build-names.ts.
 */

interface NamesData {
  surnames: Record<string, number>;
  givenNames: Record<string, number>;
  /** Frequency per million for the most common entry, used to normalise. */
  surnameMax: number;
  givenNameMax: number;
}

const data = namesData as NamesData;

export const MAX_COMMON_NAME_PENALTY = 20;

/**
 * Returns a penalty in [-MAX_COMMON_NAME_PENALTY, 0].
 *
 * A name absent from the frequency lists is treated as rare and incurs no
 * penalty -- the lists only cover common names, so absence is meaningful.
 */
export function commonNamePenalty(fullName: string): number {
  const parts = fullName
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((part) => part.length > 1);

  if (parts.length === 0) return 0;

  const given = parts[0] ?? '';
  const surname = parts[parts.length - 1] ?? '';

  const givenFrequency = data.givenNames[given] ?? 0;
  const surnameFrequency = data.surnames[surname] ?? 0;

  if (givenFrequency === 0 && surnameFrequency === 0) return 0;

  // Both halves must be common for the full name to be genuinely ambiguous.
  // "John Xiangqian" is not ambiguous even though "John" is everywhere.
  const givenShare = data.givenNameMax > 0 ? givenFrequency / data.givenNameMax : 0;
  const surnameShare = data.surnameMax > 0 ? surnameFrequency / data.surnameMax : 0;

  const combined = Math.sqrt(Math.min(1, givenShare) * Math.min(1, surnameShare));
  const penalty = Math.round(combined * MAX_COMMON_NAME_PENALTY);
  // `-0` is not a useful value to hand to a caller comparing against 0.
  return penalty === 0 ? 0 : -penalty;
}

export function isCommonName(fullName: string): boolean {
  return commonNamePenalty(fullName) <= -8;
}
