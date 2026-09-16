import type { DataType } from './finding';

/**
 * The single chokepoint that maps provider vocabularies onto our DataType enum.
 *
 * This is the structural guarantee behind "no credentials, ever". Providers
 * describe credential exposure with strings like "Passwords", "Password hints",
 * "Security questions and answers". Every one of them collapses to the single
 * boolean fact `password_credential`. There is no branch anywhere in this file
 * that can carry a credential value forward, because the output type has no
 * field to put one in.
 */

const EXACT: Record<string, DataType> = {
  'email addresses': 'email',
  'email messages': 'email',
  usernames: 'username',
  'user website urls': 'social_profile',
  names: 'name',
  'name': 'name',
  'first names': 'name',
  'last names': 'name',
  'phone numbers': 'phone',
  'physical addresses': 'physical_address',
  'dates of birth': 'dob',
  'ip addresses': 'ip_address',
  'geographic locations': 'geolocation',
  'employers': 'employer',
  'job titles': 'employer',
  'family members names': 'relatives',
  'family structure': 'relatives',
  'marital statuses': 'relatives',
  'credit cards': 'financial',
  'partial credit card data': 'financial',
  'bank account numbers': 'financial',
  'financial transactions': 'financial',
  'salaries': 'financial',
  'government issued ids': 'government_id',
  'social security numbers': 'government_id',
  'passport numbers': 'government_id',
  'drivers licenses': 'government_id',
  'health insurance information': 'health',
  'medical conditions': 'health',
  'social media profiles': 'social_profile',
  'avatars': 'social_profile',
  'profile photos': 'social_profile',
  'bios': 'social_profile',
  'device information': 'device_info',
  'device usage tracking data': 'device_info',
  'browser user agent details': 'device_info',
  'imei numbers': 'device_info',
  'mac addresses': 'device_info',
};

/**
 * Anything matching one of these becomes `password_credential` and nothing
 * else. Deliberately broad: a new provider string we have not seen should fail
 * towards "this was credential data" rather than leak through as free text.
 */
const CREDENTIAL_PATTERNS = [
  /password/i,
  /passphrase/i,
  /\bpins?\b/i,
  /security question/i,
  /security answer/i,
  /auth.?token/i,
  /session.?token/i,
  /api.?key/i,
  /private.?key/i,
  /credential/i,
  /password hint/i,
  /historical password/i,
  /encrypted password/i,
  /partial.*password/i,
];

export function isCredentialClass(raw: string): boolean {
  return CREDENTIAL_PATTERNS.some((pattern) => pattern.test(raw));
}

/**
 * Maps one provider data-class string onto a DataType, or null when we have no
 * confident mapping. Unmapped classes are dropped rather than guessed at -- an
 * honest gap beats an invented category.
 */
export function mapDataClass(raw: string): DataType | null {
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return null;

  // Credentials are checked first so nothing can route around them.
  if (isCredentialClass(normalized)) return 'password_credential';

  const exact = EXACT[normalized];
  if (exact) return exact;

  if (normalized.includes('email')) return 'email';
  if (normalized.includes('username') || normalized.includes('screen name')) return 'username';
  if (normalized.includes('phone') || normalized.includes('mobile')) return 'phone';
  if (normalized.includes('address') && !normalized.includes('email')) return 'physical_address';
  if (normalized.includes('birth')) return 'dob';
  if (normalized.includes('ip ')) return 'ip_address';
  if (normalized.includes('location') || normalized.includes('geo')) return 'geolocation';
  if (normalized.includes('employ') || normalized.includes('occupation')) return 'employer';
  if (normalized.includes('health') || normalized.includes('medical')) return 'health';
  if (normalized.includes('name')) return 'name';

  return null;
}

export function mapDataClasses(raw: readonly string[]): DataType[] {
  const mapped = new Set<DataType>();
  for (const item of raw) {
    const type = mapDataClass(item);
    if (type) mapped.add(type);
  }
  return [...mapped];
}
