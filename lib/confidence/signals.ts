/**
 * Confidence is computed from named signals, never from a hunch.
 *
 * Every finding carries the list of signals that produced its level, and the
 * report renders them verbatim. If the system says "Likely match", the person
 * can see exactly why, and can disagree.
 */

export type ConfidenceLevel = 'verified' | 'likely' | 'possible';

export type SignalId =
  | 'verified_email_exact'
  | 'email_exact'
  | 'email_hash_exact'
  | 'username_exact'
  | 'profile_corroborates_name'
  | 'profile_corroborates_email'
  | 'gravatar_linked_account'
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
  /** Set when a cap overrode the raw score, so the UI can explain why. */
  cappedBy?: string;
}

export const SIGNAL_WEIGHTS: Record<SignalId, number> = {
  verified_email_exact: 60,
  email_exact: 40,
  email_hash_exact: 40,
  username_exact: 20,
  profile_corroborates_name: 15,
  profile_corroborates_email: 25,
  gravatar_linked_account: 30,
  name_exact: 8,
  name_plus_locality: 12,
  common_name_penalty: 0, // computed per-name, always negative
  low_reliability_source: -10,
  user_confirmed: 0, // handled by an override, not the score
  user_rejected: 0,
};

const EXPLANATIONS: Record<SignalId, string> = {
  verified_email_exact: 'Matched the email address you confirmed you own',
  email_exact: 'Matched your exact email address',
  email_hash_exact: 'Matched a cryptographic hash of your email address',
  username_exact: 'Matched the username you entered — usernames are not unique',
  profile_corroborates_name: 'That page also shows your name',
  profile_corroborates_email: 'That page is linked to your email address',
  gravatar_linked_account: 'Your Gravatar profile links to this account',
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
  verified: 'Verified match',
  likely: 'Likely match',
  possible: 'Possible match',
};

export const CONFIDENCE_DESCRIPTIONS: Record<ConfidenceLevel, string> = {
  verified:
    'This is tied to an identifier you proved you own, or you confirmed it yourself. Treat it as real.',
  likely:
    'Several independent things line up, but nothing proves it is you. Worth checking before acting.',
  possible:
    'This matched loosely — often on a name alone. It may well be a different person with similar details.',
};
