import type { BreachCatalog, BreachRecord } from '../breach-catalog';
import { squash } from '../breach-catalog';
import { assessConfidence } from '../confidence/score';
import { mapDataClasses } from './dataclasses';
import type { Action, DataType, Finding } from './finding';
import { closeAccountAction, legalErasureAction, REGULATOR_ACTION } from './removal';

/**
 * Builds one breach finding, from whichever provider saw it.
 *
 * Every keyless breach source funnels through here, which does two jobs at
 * once. It makes a bare breach name from one provider as informative as a full
 * record from another, by enriching it from the public HIBP catalogue. And it
 * gives the same real-world breach the same finding id whoever reported it,
 * which is what lets the orchestrator merge duplicates instead of listing the
 * Adobe breach three times because three providers know about it.
 */

export interface RawBreach {
  /** Whatever the provider called it. */
  name: string;
  /** Provider-supplied extras, used only when the catalogue has nothing. */
  fallback?: {
    title?: string;
    domain?: string;
    year?: number;
    date?: string;
    description?: string;
    dataClasses?: string[];
    /**
     * How well the credentials were protected, where a provider says. This is a
     * property of the breach, not a credential — no value is involved — and it
     * changes how urgent the response is, so it is worth carrying.
     */
    credentialStorage?: string;
  };
}

function formatCount(count: number): string {
  if (count >= 1_000_000) return `${Math.round(count / 1_000_000)} million`;
  if (count >= 1_000) return `${Math.round(count / 1_000)},000`;
  return String(count);
}

/**
 * What somebody should actually do, which depends on what was taken.
 * Every breach gets at least one route to reducing the damage.
 */
function buildActions(
  record: BreachRecord | undefined,
  dataTypes: DataType[],
  siteName: string,
  domain: string | undefined,
): Action[] {
  const actions: Action[] = [];
  const hasCredentials = dataTypes.includes('password_credential');

  if (hasCredentials) {
    actions.push({
      type: 'change_password',
      label: 'Change this password everywhere you reused it',
      detail: 'Attackers replay stolen credentials against other sites automatically.',
      url: domain ? `https://${domain}` : undefined,
    });
    actions.push({
      type: 'enable_2fa',
      label: 'Turn on two-factor authentication',
      detail: 'Start with your email — it can reset everything else.',
    });
  }

  if (dataTypes.includes('financial')) {
    actions.push({
      type: 'review_account',
      label: 'Check your statements',
      detail: 'Card details were taken. Ask your bank for a new number if this was recent.',
    });
  }

  if (dataTypes.includes('government_id')) {
    actions.push({
      type: 'review_account',
      label: 'Consider a credit freeze',
      detail: 'ID numbers cannot be changed like a password.',
    });
  }

  if (dataTypes.includes('physical_address') || dataTypes.includes('phone')) {
    actions.push({
      type: 'review_account',
      label: 'Expect convincing phishing',
      detail: 'Knowing your address makes a scam call believable. Treat that as a warning sign.',
    });
  }

  actions.push(closeAccountAction(siteName, domain));
  actions.push(legalErasureAction(siteName, domain ? `https://${domain}` : undefined));
  actions.push(REGULATOR_ACTION);

  if (record?.isRetired) {
    actions.push({
      type: 'review_account',
      label: 'Low priority — this breach was withdrawn',
      detail: 'HIBP retired it, usually because the data turned out to be fake or recycled.',
    });
  }

  return actions;
}

/** Turns a provider's storage code into something a person can act on. */
function credentialStorageNote(risk: string | undefined): string | null {
  switch (risk?.toLowerCase()) {
    case 'plaintext':
      return 'Passwords were stored unprotected — treat yours as fully known.';
    case 'easytocrack':
      return 'Passwords were weakly protected and have likely been cracked.';
    case 'hardtocrack':
      return 'Passwords were strongly protected, which buys time but is not safety.';
    default:
      return null;
  }
}

function buildWhyItMatters(
  record: BreachRecord | undefined,
  fallbackDescription: string | undefined,
  dataTypes: DataType[],
  credentialStorage?: string,
): string {
  const parts: string[] = [];

  if (record) {
    if (record.pwnCount) parts.push(`${formatCount(record.pwnCount)} accounts exposed.`);
    if (record.description) parts.push(record.description.slice(0, 340));
    if (!record.isVerified) parts.push('Unconfirmed — the data circulates but was never verified.');
  } else if (fallbackDescription) {
    parts.push(fallbackDescription.slice(0, 340));
  }

  if (parts.length === 0) {
    parts.push('Your address appears in data taken from this service.');
  }

  if (dataTypes.includes('password_credential')) {
    const storage = credentialStorageNote(credentialStorage);
    if (storage) parts.push(storage);
  }

  return parts.join(' ');
}

export function buildBreachFinding(
  raw: RawBreach,
  catalog: BreachCatalog,
  provider: { id: string; label: string; url?: string },
): Finding | null {
  const providerName = raw.name?.trim();
  if (!providerName) return null;

  const record = catalog.lookup(providerName);

  const title = record?.title ?? raw.fallback?.title ?? providerName;
  const domain = record?.domain ?? raw.fallback?.domain;

  const classes = record?.dataClasses?.length
    ? record.dataClasses
    : (raw.fallback?.dataClasses ?? []);
  const dataTypes = mapDataClasses(classes);
  if (!dataTypes.includes('email')) dataTypes.unshift('email');

  const date = record?.breachDate ?? raw.fallback?.date;
  const year = date ? Number(date.slice(0, 4)) : raw.fallback?.year;

  const includesCredentials = dataTypes.includes('password_credential');

  return {
    // Keyed on the canonical breach, not the provider, so the same breach seen
    // by three providers collapses into one finding.
    id: `breach:${squash(record?.name ?? providerName)}`,
    section: record?.isMalware ? 'stealer' : 'breaches',
    title: `Your email address was in the ${title} breach`,
    provider,
    origin: { name: title, domain },
    occurredAt: date
      ? { date, year: Number.isFinite(year) ? year : undefined, precision: 'day' }
      : Number.isFinite(year)
        ? { year, precision: 'year' }
        : undefined,
    discoveredAt: record?.addedDate,
    dataTypes,
    confidence: assessConfidence({ signals: ['email_exact'], nameOnly: false }),
    evidence: record
      ? { url: record.url, label: 'Read what happened' }
      : { url: 'https://haveibeenpwned.com/PwnedWebsites', label: 'Browse known breaches' },
    whyItMatters: buildWhyItMatters(
      record,
      raw.fallback?.description,
      dataTypes,
      raw.fallback?.credentialStorage,
    ),
    actions: buildActions(record, dataTypes, title, domain),
    educationKey: includesCredentials ? 'password_in_breach' : 'breach',
    flags: {
      sensitive: record?.isSensitive,
      unverifiedBreach: record ? !record.isVerified : undefined,
      spamList: record?.isSpamList,
      malware: record?.isMalware,
    },
  };
}
