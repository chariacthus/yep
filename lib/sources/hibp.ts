import { hibpRangePrefix } from '../crypto';
import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { mapDataClasses } from '../normalize/dataclasses';
import type { Finding } from '../normalize/finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * Have I Been Pwned.
 *
 * Two things shape this adapter:
 *
 *   1. k-anonymity is used whenever it is available. We send the first six
 *      characters of the SHA-1 of the address and match the suffix locally, so
 *      the full address never leaves this server. Thousands of addresses share
 *      any given prefix. This requires a Pro subscription; if the range
 *      endpoint is unavailable we fall back to the direct endpoint, which does
 *      transmit the address, and the consent UI says so.
 *
 *   2. Nothing is cached. HIBP's terms prohibit building a substantially
 *      similar breach database, and a cache keyed by address would be exactly
 *      that. Results live for the duration of one request.
 *
 * Breach data is CC BY licensed and attributed on /about/sources.
 */

/**
 * Read at call time rather than module load, so contract tests can point the
 * adapter at a local fixture server.
 */
function apiBase(): string {
  return process.env.HIBP_API_BASE ?? 'https://haveibeenpwned.com/api/v3';
}

interface HibpBreach {
  Name: string;
  Title: string;
  Domain: string;
  BreachDate: string;
  AddedDate: string;
  Description: string;
  DataClasses: string[];
  IsVerified: boolean;
  IsSensitive: boolean;
  IsSpamList: boolean;
  IsMalware: boolean;
}

interface RangeEntry {
  hashSuffix: string;
  websites: string[];
}

function headers(): Record<string, string> {
  return {
    'hibp-api-key': process.env.HIBP_API_KEY ?? '',
    accept: 'application/json',
  };
}

/** Strips HIBP's HTML description down to plain text for safe rendering. */
function plainText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function toFinding(breach: HibpBreach, emailVerified: boolean): Finding {
  const dataTypes = mapDataClasses(breach.DataClasses);
  const includesCredentials = dataTypes.includes('password_credential');

  const confidence = assessConfidence({
    signals: ['email_exact'],
    nameOnly: false,
  });

  const breachYear = Number(breach.BreachDate?.slice(0, 4));

  return {
    id: `hibp:${breach.Name}`,
    section: breach.IsMalware ? 'stealer' : 'breaches',
    title: `Your email address was in the ${breach.Title} breach`,
    provider: { id: 'hibp', label: 'Have I Been Pwned', url: 'https://haveibeenpwned.com' },
    origin: { name: breach.Title, domain: breach.Domain || undefined },
    occurredAt: breach.BreachDate
      ? { date: breach.BreachDate, year: breachYear, precision: 'day' }
      : undefined,
    discoveredAt: breach.AddedDate,
    dataTypes,
    confidence,
    evidence: {
      url: `https://haveibeenpwned.com/PwnedWebsites#${breach.Name}`,
      label: 'Read the breach description',
    },
    whyItMatters: plainText(breach.Description).slice(0, 600),
    actions: buildActions(breach, includesCredentials),
    educationKey: includesCredentials ? 'password_in_breach' : 'breach',
    flags: {
      sensitive: breach.IsSensitive,
      unverifiedBreach: !breach.IsVerified,
      spamList: breach.IsSpamList,
      malware: breach.IsMalware,
    },
  };
}

function buildActions(breach: HibpBreach, includesCredentials: boolean): Finding['actions'] {
  const actions: Finding['actions'] = [];

  if (includesCredentials) {
    actions.push({
      type: 'change_password',
      label: 'Change this password everywhere you used it',
      detail:
        `Change the password on ${breach.Title}, then change it on every other account where you used the same password or a close variant. ` +
        'Attackers try stolen credentials automatically against other services.',
    });
    actions.push({
      type: 'enable_2fa',
      label: 'Turn on two-factor authentication',
      detail:
        'Two-factor authentication means a stolen password on its own is not enough to get into your account. Prioritise your email account — it can reset everything else.',
    });
  }

  actions.push({
    type: 'review_account',
    label: 'Check whether you still use this account',
    detail: breach.Domain
      ? `If you no longer use ${breach.Domain}, closing the account removes the data they still hold about you.`
      : 'If you no longer use this service, closing the account removes the data they still hold about you.',
    url: breach.Domain ? `https://${breach.Domain}` : undefined,
  });

  return actions;
}

/**
 * Tries the k-anonymity range endpoint first. Returns null when the endpoint is
 * not available on this subscription tier, so the caller can fall back.
 */
async function fetchViaRange(normalizedEmail: string, signal: AbortSignal): Promise<string[] | null> {
  const { prefix, suffix } = hibpRangePrefix(normalizedEmail);

  try {
    const entries = await requestJson<RangeEntry[]>(`${apiBase()}/breachedaccount/range/${prefix}`, {
      headers: headers(),
      signal,
      timeoutMs: 10_000,
    });
    if (!entries) return [];

    const match = entries.find(
      (entry) => entry.hashSuffix?.toUpperCase() === suffix.toUpperCase(),
    );
    return match?.websites ?? [];
  } catch (error) {
    // 403/404 on the range endpoint means the tier does not include it.
    if (error instanceof HttpError && (error.status === 403 || error.status === 404)) return null;
    throw error;
  }
}

async function fetchDirect(normalizedEmail: string, signal: AbortSignal): Promise<string[]> {
  const breaches = await requestJson<Array<{ Name: string }>>(
    `${apiBase()}/breachedaccount/${encodeURIComponent(normalizedEmail)}?truncateResponse=true`,
    { headers: headers(), signal, timeoutMs: 10_000 },
  );
  return (breaches ?? []).map((breach) => breach.Name);
}

export const hibpSource: Source = {
  id: 'hibp',
  label: 'Have I Been Pwned',
  kind: 'breach',
  description:
    'The best-known index of publicly disclosed data breaches. Where the subscription allows it, we search using a partial hash so your address is never sent.',
  homepage: 'https://haveibeenpwned.com',
  requires: ['email'],
  // The range endpoint sends only a hash prefix. The fallback does send the
  // address, so this is declared true and the consent UI explains both paths.
  sendsRawEmail: true,
  requiredEnv: ['HIBP_API_KEY'],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);

    try {
      let names = await fetchViaRange(email, context.signal);
      if (names === null) {
        names = await fetchDirect(email, context.signal);
      }
      if (names.length === 0) return { status: 'ok', checked: 0 };

      // One catalogue call describes every breach; no per-breach round trips.
      const catalogue =
        (await requestJson<HibpBreach[]>(`${apiBase()}/breaches`, {
          headers: headers(),
          signal: context.signal,
          timeoutMs: 15_000,
        })) ?? [];

      const byName = new Map(catalogue.map((breach) => [breach.Name.toLowerCase(), breach]));
      let emitted = 0;
      let withheld = 0;

      for (const name of names) {
        const breach = byName.get(name.toLowerCase());
        if (!breach) continue;

        // Sensitive breaches can out somebody — a leak from an affair site or a
        // political forum is revealing merely by association. They are surfaced
        // only to a person who has proved they own the address, and even then
        // the UI keeps them behind an explicit reveal.
        if (breach.IsSensitive && !context.emailVerified) {
          withheld += 1;
          continue;
        }

        emit.finding(toFinding(breach, context.emailVerified));
        emitted += 1;
      }

      return { status: 'ok', checked: emitted, withheld };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
