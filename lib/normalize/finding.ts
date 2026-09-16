/**
 * The canonical shape every source is normalised into.
 *
 * Sources return wildly different payloads -- a breach record, an HTTP status
 * code from a profile probe, a search result, an archived snapshot. This type
 * is what lets the report render them as one coherent investigation rather than
 * seven different tables.
 */

import type { ConfidenceAssessment } from '../confidence/signals';

/**
 * Categories of information that can be exposed.
 *
 * `password_credential` is a boolean fact and nothing more. It records that a
 * breach included credentials. No value, hash, hint, or fragment of a
 * credential is ever carried anywhere in this system.
 */
export type DataType =
  | 'email'
  | 'username'
  | 'name'
  | 'phone'
  | 'physical_address'
  | 'dob'
  | 'ip_address'
  | 'geolocation'
  | 'employer'
  | 'relatives'
  | 'financial'
  | 'government_id'
  | 'health'
  | 'social_profile'
  | 'device_info'
  | 'password_credential';

export const DATA_TYPE_LABELS: Record<DataType, string> = {
  email: 'Email address',
  username: 'Username',
  name: 'Name',
  phone: 'Phone number',
  physical_address: 'Physical address',
  dob: 'Date of birth',
  ip_address: 'IP address',
  geolocation: 'Location',
  employer: 'Employer',
  relatives: 'Family members',
  financial: 'Financial information',
  government_id: 'Government ID',
  health: 'Health information',
  social_profile: 'Social profile',
  device_info: 'Device information',
  password_credential: 'Password credentials',
};

export type Section =
  | 'breaches'
  | 'stealer'
  | 'profiles'
  | 'search'
  | 'usernames'
  | 'archive'
  | 'other';

export const SECTION_LABELS: Record<Section, string> = {
  breaches: 'Breaches',
  stealer: 'Malware-stolen data',
  profiles: 'Public profiles',
  search: 'Search results',
  usernames: 'Usernames',
  archive: 'Archived pages',
  other: 'Other public information',
};

export type ActionType =
  | 'change_password'
  | 'enable_2fa'
  | 'review_account'
  | 'close_account'
  | 'opt_out'
  | 'scan_device'
  | 'review_privacy_settings';

export interface Action {
  type: ActionType;
  label: string;
  detail: string;
  /** A real removal or settings URL. Only ever set when one genuinely exists. */
  url?: string;
}

export interface Occurrence {
  date?: string;
  year?: number;
  precision: 'day' | 'month' | 'year' | 'unknown';
}

export interface Finding {
  id: string;
  section: Section;
  title: string;
  /** Which integration produced this, so the report can attribute it. */
  provider: { id: string; label: string; url?: string };
  /** Where the exposure actually lives, e.g. the breached service. */
  origin: { name: string; domain?: string };
  /** When the exposure happened, when that is known. */
  occurredAt?: Occurrence;
  /** When it became publicly known or was indexed. */
  discoveredAt?: string;
  dataTypes: DataType[];
  confidence: ConfidenceAssessment;
  evidence?: { url?: string; label?: string };
  whyItMatters: string;
  actions: Action[];
  /** Key into lib/education/content.ts for the inline explainer. */
  educationKey: string;
  flags?: {
    /** HIBP's IsSensitive. Shown only after verification, behind a reveal. */
    sensitive?: boolean;
    /** HIBP's IsVerified is false: the breach is alleged, not confirmed. */
    unverifiedBreach?: boolean;
    spamList?: boolean;
    malware?: boolean;
    /** The site's detection logic is known to be unreliable. */
    lowReliability?: boolean;
  };
}

/**
 * Data-broker entries are deliberately NOT findings.
 *
 * We cannot confirm that somebody is listed on a people-search site without
 * scraping it, which would break those sites' terms and is exactly the
 * look-up-strangers behaviour this tool exists to oppose. Presenting an
 * unverified listing as a detection would be fabrication, so brokers render as
 * removal opportunities with no confidence level attached.
 */
export interface RemovalOpportunity {
  id: string;
  brokerName: string;
  website?: string;
  optOutUrl?: string;
  /** Categories the broker itself registered as collecting. */
  collects: string[];
  /** Why this broker is being surfaced for this particular person. */
  relevance: string;
  jurisdiction: 'california' | 'us' | 'eu' | 'global';
  difficulty?: 'easy' | 'moderate' | 'hard';
}

export function passwordCredentialsIncluded(finding: Finding): boolean {
  return finding.dataTypes.includes('password_credential');
}
