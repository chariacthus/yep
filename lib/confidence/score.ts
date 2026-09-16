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

export const THRESHOLD_CONFIRMED = 60;
export const THRESHOLD_LIKELY = 30;

export interface ScoreInput {
  signals: SignalId[];
  /** The name searched for, when the finding rests on a name at all. */
  nameSearched?: string;
  /** True when the ONLY identifier linking this finding to the person is a name. */
  nameOnly: boolean;
  /** True when the only identifier is a username. */
  usernameOnly?: boolean;
  /**
   * The handle was worked out by us rather than given. That makes it a lead
   * worth showing, never a claim about the person.
   */
  derivedHandle?: boolean;
  /** What the handle was worked out from, for the explanation. */
  handleSource?: 'given' | 'email' | 'name';
  /** Set by the person's own answer to "Is this you?". */
  userVerdict?: 'confirmed' | 'rejected';
}

function levelFromScore(score: number): ConfidenceLevel {
  if (score >= THRESHOLD_CONFIRMED) return 'confirmed';
  if (score >= THRESHOLD_LIKELY) return 'likely';
  return 'possible';
}

const CORROBORATING: ReadonlySet<SignalId> = new Set([
  'profile_corroborates_name',
  'profile_corroborates_email',
  'linked_account_verified',
  'email_exact',
  'email_hash_exact',
]);

export function assessConfidence(input: ScoreInput): ConfidenceAssessment {
  const signals: Signal[] = input.signals.map((id) => signal(id));

  if (input.derivedHandle) {
    // "Matched the username you entered" is simply untrue when we guessed the
    // handle, so the explanation is corrected rather than contradicted by the
    // line that follows it.
    const from = input.handleSource === 'name' ? 'your name' : 'your email address';
    for (const item of signals) {
      if (item.id === 'username_exact') {
        item.explanation = `Matched a handle we built from ${from}`;
      }
    }
    signals.push(signal('derived_handle'));
  }

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
    } else if (level === 'confirmed') {
      level = 'likely';
      cappedBy = 'Usernames are not unique, so this cannot be confirmed automatically.';
    }
  }

  // A handle we guessed can never rise above "possible", whatever else lines
  // up. Nobody told us it was theirs.
  if (input.derivedHandle) {
    level = 'possible';
    cappedBy =
      input.handleSource === 'name'
        ? 'We built this handle from your name — nobody confirmed it is yours.'
        : 'We took this handle from your email address — nobody confirmed it is yours.';
  }

  // Cap 3: only an exact match on an identifier that was actually entered can be
  // "confirmed". Weak signals must not accumulate their way to certainty.
  const hasExactIdentifier =
    input.signals.includes('email_exact') || input.signals.includes('email_hash_exact');
  if (level === 'confirmed' && !hasExactIdentifier) {
    level = 'likely';
    cappedBy = 'Nothing here matched one of your identifiers exactly.';
  }

  // --- The person's own answer wins over everything. ---
  if (input.userVerdict === 'confirmed') {
    return {
      level: 'confirmed',
      score: Math.max(score, THRESHOLD_CONFIRMED),
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
