import { getBreachCatalog } from '../breach-catalog';
import { reveal } from '../identity';
import { buildBreachFinding } from '../normalize/breach-finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * XposedOrNot — a keyless breach index.
 *
 * Valuable because it needs no subscription, so the tool is genuinely useful to
 * somebody who has configured nothing. The trade-off is that its API takes the
 * address in the clear, which is why it is declared `sendsRawEmail` and can be
 * declined in the consent step.
 *
 * It returns fairly thin records — often little more than a breach name — so
 * everything it finds is enriched from the public HIBP catalogue before it
 * becomes a finding. See lib/normalize/breach-finding.ts.
 *
 * The response is parsed defensively: a keyless public API can change without
 * notice, and a shape change must degrade to "no findings" rather than to a
 * crash or, worse, a wrong finding.
 */

function apiBase(): string {
  return process.env.XPOSEDORNOT_API_BASE ?? 'https://api.xposedornot.com/v1';
}

interface BreachDetail {
  breach?: string;
  details?: string;
  domain?: string;
  xposed_data?: string;
  xposed_date?: string;
  password_risk?: string;
}

interface AnalyticsResponse {
  ExposedBreaches?: { breaches_details?: BreachDetail[] };
  Error?: string;
}

/** The simpler endpoint, used when the analytics one gives nothing. */
interface CheckResponse {
  breaches?: string[][];
  Error?: string;
}

export const xposedOrNotSource: Source = {
  id: 'xposedornot',
  label: 'XposedOrNot',
  kind: 'breach',
  description:
    'A free, open breach index. Needs no API key, so it works out of the box — but it receives your address in full.',
  homepage: 'https://xposedornot.com',
  requires: ['email'],
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);
    const provider = {
      id: 'xposedornot',
      label: 'XposedOrNot',
      url: 'https://xposedornot.com',
    };

    try {
      const [catalog, analytics] = await Promise.all([
        getBreachCatalog(context.signal),
        requestJson<AnalyticsResponse>(
          `${apiBase()}/breach-analytics?email=${encodeURIComponent(email)}`,
          { signal: context.signal, timeoutMs: 12_000 },
        ).catch(() => null),
      ]);

      const details = analytics?.ExposedBreaches?.breaches_details;
      let names: RawEntry[] = [];

      if (Array.isArray(details) && details.length > 0) {
        names = details.map((detail) => ({
          name: detail.breach ?? '',
          fallback: {
            domain: detail.domain || undefined,
            year: Number(detail.xposed_date?.slice(0, 4)) || undefined,
            description: detail.details?.trim(),
            credentialStorage: detail.password_risk,
            dataClasses: (detail.xposed_data ?? '')
              .split(';')
              .map((item) => item.trim())
              .filter(Boolean),
          },
        }));
      } else {
        // Fall back to the plain check endpoint, which returns bare names.
        const check = await requestJson<CheckResponse>(
          `${apiBase()}/check-email/${encodeURIComponent(email)}`,
          { signal: context.signal, timeoutMs: 10_000 },
        ).catch(() => null);

        const flat = check?.breaches?.flat?.() ?? [];
        names = flat.filter(Boolean).map((name) => ({ name }));
      }

      let emitted = 0;
      for (const entry of names) {
        if (!entry.name) continue;
        const finding = buildBreachFinding(entry, catalog, provider);
        if (!finding) continue;

        // Sensitive breaches can out somebody, and ownership is only proved
        // when verification is switched on.
        if (finding.flags?.sensitive && !context.emailVerified && !context.includeSensitive)
          continue;

        emit.finding(finding);
        emitted += 1;
      }

      return { status: 'ok', checked: emitted };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};

interface RawEntry {
  name: string;
  fallback?: {
    domain?: string;
    year?: number;
    description?: string;
    credentialStorage?: string;
    dataClasses?: string[];
  };
}
