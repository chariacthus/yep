import { getBreachCatalog } from '../breach-catalog';
import { hibpRangePrefix } from '../crypto';
import { reveal } from '../identity';
import { buildBreachFinding } from '../normalize/breach-finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * Have I Been Pwned account lookup.
 *
 * This is the only paid integration in the app, and it is entirely optional:
 * without a key the keyless indexes still run, and HIBP's *catalogue* — the
 * descriptions, dates and data classes behind every breach — is public and used
 * regardless (see lib/breach-catalog.ts). The key buys the account lookup only.
 *
 * Two things shape the implementation:
 *
 *   1. k-anonymity is used whenever the subscription allows it. We send the
 *      first six characters of the SHA-1 of the address and match the suffix
 *      locally, so the full address never leaves this server.
 *   2. Nothing is cached per-address. HIBP's terms prohibit building a
 *      substantially similar breach database, and a cache keyed by address
 *      would be exactly that.
 */

function apiBase(): string {
  return process.env.HIBP_API_BASE ?? 'https://haveibeenpwned.com/api/v3';
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

/**
 * Tries the k-anonymity range endpoint first. Returns null when the endpoint is
 * not available on this subscription tier, so the caller can fall back.
 */
async function fetchViaRange(
  normalizedEmail: string,
  signal: AbortSignal,
): Promise<string[] | null> {
  const { prefix, suffix } = hibpRangePrefix(normalizedEmail);

  try {
    const entries = await requestJson<RangeEntry[]>(
      `${apiBase()}/breachedaccount/range/${prefix}`,
      { headers: headers(), signal, timeoutMs: 10_000 },
    );
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
  label: 'Have I Been Pwned (account lookup)',
  kind: 'breach',
  description:
    'The best-known breach index. The account lookup needs a paid key; its public breach catalogue is used either way to describe every breach we find.',
  homepage: 'https://haveibeenpwned.com',
  requires: ['email'],
  // The range endpoint sends only a hash prefix. The fallback does send the
  // address, so this is declared true and the consent UI explains both paths.
  sendsRawEmail: true,
  requiredEnv: ['HIBP_API_KEY'],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);
    const provider = {
      id: 'hibp',
      label: 'Have I Been Pwned',
      url: 'https://haveibeenpwned.com',
    };

    try {
      let names = await fetchViaRange(email, context.signal);
      if (names === null) names = await fetchDirect(email, context.signal);
      if (names.length === 0) return { status: 'ok', checked: 0 };

      const catalog = await getBreachCatalog(context.signal);

      let emitted = 0;
      let withheld = 0;

      for (const name of names) {
        const finding = buildBreachFinding({ name }, catalog, provider);
        if (!finding) continue;

        // Sensitive breaches can out somebody — a leak from an affair site or a
        // political forum is revealing merely by association. They are surfaced
        // only to a person who has proved they own the address.
        if (finding.flags?.sensitive && !context.emailVerified) {
          withheld += 1;
          continue;
        }

        emit.finding(finding);
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
