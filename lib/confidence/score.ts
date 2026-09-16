import {
  type ConfidenceAssessment,
  type ConfidenceLevel,
  type Signal,
  type SignalId,
  signal,
} from './signals';
import { commonNamePenalty } from './names';

/**
 * Turns a set of signals into a confidence level.
 *
 * The score is advisory. The caps below are the real guarantees, and they
 * override the score unconditionally. They exist because the failure this tool
 * must never commit is telling somebody "this is you" when it is not.
 */

export const THRESHOLD_VERIFIED = 60;
export const THRESHOLD_LIKELY = 30;

export interface ScoreInput {
  signals: SignalId[];
  /** The name searched for, when the finding rests on a name at all. */
  nameSearched?: string;
  /** True when the ONLY identifier linking this finding to the person is a name. */
  nameOnly: boolean;
  /** True when the only identifier is a username. */
  usernameOnly?: boolean;
  /** Set by the person's own answer to "Is this you?". */
  userVerdict?: 'confirmed' | 'rejected';
}

function levelFromScore(score: number): ConfidenceLevel {
  if (score >= THRESHOLD_VERIFIED) return 'verified';
  if (score >= THRESHOLD_LIKELY) return 'likely';
  return 'possible';
}

const CORROBORATING: ReadonlySet<SignalId> = new Set([
  'profile_corroborates_name',
  'profile_corroborates_email',
  'gravatar_linked_account',
  'email_exact',
  'email_hash_exact',
  'verified_email_exact',
]);

export function assessConfidence(input: ScoreInput): ConfidenceAssessment {
  const signals: Signal[] = input.signals.map((id) => signal(id));

  // The common-name penalty is computed from real frequency data rather than
  // being a fixed constant, so rare names are not punished.
  if (input.nameSearched && input.signals.some((id) => id === 'name_exact' || id === 'name_plus_locality')) {
    const penalty = commonNamePenalty(input.nameSearched);
    if (penalty < 0) signals.push(signal('common_name_penalty', penalty));
  }

  const score = signals.reduce((total, item) => total + item.weight, 0);
  let level = levelFromScore(score);
  let cappedBy: string | undefined;

  // --- Caps. These override the score. ---
  //
  // The explanation is attached whenever the cap's condition holds, not only
  // when it actively lowers the level. A person looking at a "Possible match"
  // deserves to know it is capped because the evidence is a name, rather than
  // being left to guess why a result with several signals scored low.

  // Cap 1: a finding whose only link to the person is their name can never rise
  // above "possible", however many other weak signals pile up.
  if (input.nameOnly) {
    level = 'possible';
    cappedBy = 'This matched on your name alone, which is never enough to confirm a person.';
  }

  // Cap 2: a username-only hit stays at possible and can only reach likely with
  // independent corroboration. Usernames are not unique.
  if (input.usernameOnly) {
    const corroborated = input.signals.some((id) => CORROBORATING.has(id));
    if (!corroborated) {
      level = 'possible';
      cappedBy = 'Nothing beyond the username itself links this account to you.';
    } else if (level === 'verified') {
      level = 'likely';
      cappedBy = 'Usernames are not unique, so this cannot be confirmed automatically.';
    }
  }

  // Cap 3: "verified" is reserved for an exact match on the address the person
  // proved they own, or their own explicit confirmation. Nothing else earns it.
  const hasVerifiedIdentifier = input.signals.includes('verified_email_exact');
  if (level === 'verified' && !hasVerifiedIdentifier) {
    level = 'likely';
    cappedBy = 'Only a match on your confirmed email address counts as verified.';
  }

  // --- The person's own answer wins over everything. ---
  if (input.userVerdict === 'confirmed') {
    return {
      level: 'verified',
      score: Math.max(score, THRESHOLD_VERIFIED),
      signals: [...signals, signal('user_confirmed')],
      cappedBy: undefined,
    };
  }
  if (input.userVerdict === 'rejected') {
    return {
      level: 'possible',
      score: 0,
      signals: [...signals, signal('user_rejected')],
      cappedBy: 'You told us this is not you.',
    };
  }

  return { level, score, signals, cappedBy };
}
