/**
 * Confidence is computed from named signals, never from a hunch.
 *
 * Every finding carries the list of signals that produced its level, and the
 * report renders them verbatim. If the system says "Likely match", the person
 * can see exactly why, and can disagree.
 *
 * ---
 *
 * Confidence answers ONE question: does this finding correspond to the
 * identifiers that were entered?
 *
 * It deliberately does NOT answer "does this person own those identifiers".
 * Those are separate questions and conflating them produces nonsense in both
 * directions. If somebody types an address that really does appear in a breach,
 * the match is certain — what is unproven is that the address is theirs. That
 * caveat belongs once at the top of the report, not smeared across every
 * finding as a downgraded confidence level.
 *
 * Where email verification is enabled, ownership is proved and the caveat
 * disappears. The confidence levels are unaffected either way.
 */

export type ConfidenceLevel = 'confirmed' | 'likely' | 'possible';

export type SignalId =
  | 'email_exact'
  | 'email_hash_exact'
  | 'username_exact'
  | 'profile_corroborates_name'
  | 'profile_corroborates_email'
  | 'linked_account_verified'
  | 'name_exact'
  | 'name_plus_locality'
  | 'common_name_penalty'
  | 'low_reliability_source'
  | 'user_confirmed'
  | 'user_rejected';

export interface Signal {
  id: SignalId;
  /** Plain-language sentence shown to the person. No jargon. */
  explanation: string;
  weight: number;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  score: number;
  signals: Signal[];
  /** Set when a cap decided the level, so the UI can explain why. */
  cappedBy?: string;
}

export const SIGNAL_WEIGHTS: Record<SignalId, number> = {
  email_exact: 60,
  email_hash_exact: 60,
  username_exact: 20,
  profile_corroborates_name: 15,
  profile_corroborates_email: 25,
  linked_account_verified: 30,
  name_exact: 8,
  name_plus_locality: 12,
  common_name_penalty: 0, // computed per-name from frequency data, always ≤ 0
  low_reliability_source: -10,
  user_confirmed: 0, // handled by an override, not the score
  user_rejected: 0,
};

const EXPLANATIONS: Record<SignalId, string> = {
  email_exact: 'Matched the exact email address you entered',
  email_hash_exact: 'Matched a cryptographic hash of the email address you entered',
  username_exact: 'Matched the username you entered — usernames are not unique',
  profile_corroborates_name: 'That page also shows your name',
  profile_corroborates_email: 'That page is linked to your email address',
  linked_account_verified: 'Another profile of yours publicly links to this account',
  name_exact: 'Matched your name only',
  name_plus_locality: 'Matched your name together with your location',
  common_name_penalty: 'This is a common name, so this may well be someone else',
  low_reliability_source: 'This site’s detection is unreliable, so the result may be wrong',
  user_confirmed: 'You confirmed this is you',
  user_rejected: 'You said this is not you',
};

export function signal(id: SignalId, weightOverride?: number): Signal {
  return {
    id,
    explanation: EXPLANATIONS[id],
    weight: weightOverride ?? SIGNAL_WEIGHTS[id],
  };
}

export const CONFIDENCE_LABELS: Record<ConfidenceLevel, string> = {
  confirmed: 'Confirmed match',
  likely: 'Likely match',
  possible: 'Possible match',
};

export const CONFIDENCE_DESCRIPTIONS: Record<ConfidenceLevel, string> = {
  confirmed:
    'This matched an identifier you entered exactly. The match itself is not in doubt.',
  likely:
    'Several independent things line up, but nothing matched exactly. Worth checking before acting.',
  possible:
    'This matched loosely — often on a name alone. It may well be a different person with similar details.',
};

/**
 * The standing caveat shown once at the top of a report when the identifiers
 * were asserted rather than proved. This is the honest home for the uncertainty
 * that used to be (wrongly) folded into every finding's confidence level.
 */
export const OWNERSHIP_CAVEAT =
  'You told us these details are yours, and we have taken your word for it. ' +
  'Read this as a report about the email address and username you entered, rather than proof about you.';
