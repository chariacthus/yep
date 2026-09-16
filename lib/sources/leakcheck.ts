import { getBreachCatalog } from '../breach-catalog';
import { reveal } from '../identity';
import { buildBreachFinding } from '../normalize/breach-finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * LeakCheck's public API.
 *
 * Keyless, and deliberately limited in a way that suits this project exactly:
 * it returns the names of the breaches an address appears in and the categories
 * of data involved, and never the data itself. There is no endpoint here that
 * could hand back a credential even if we asked.
 *
 * Their terms allow commercial use of the public API in exchange for
 * attribution, which appears on /about/sources.
 *
 * Coverage overlaps with XposedOrNot, and that is the point: between them the
 * app finds considerably more than either alone, and the shared finding id in
 * breach-finding.ts collapses anything both of them report into one entry.
 */

function apiBase(): string {
  return process.env.LEAKCHECK_API_BASE ?? 'https://leakcheck.io/api/public';
}

interface LeakCheckSource {
  name?: string;
  date?: string;
}

interface LeakCheckResponse {
  success?: boolean;
  found?: number;
  /** Category names, e.g. ["password", "username"]. Never values. */
  fields?: string[];
  /** Newer responses use objects; older ones used plain strings. */
  sources?: Array<LeakCheckSource | string>;
  error?: string;
}

function normaliseSource(entry: LeakCheckSource | string): { name: string; date?: string } | null {
  if (typeof entry === 'string') {
    const name = entry.trim();
    return name ? { name } : null;
  }
  const name = entry?.name?.trim();
  if (!name) return null;
  return { name, date: entry.date };
}

export const leakCheckSource: Source = {
  id: 'leakcheck',
  label: 'LeakCheck',
  kind: 'breach',
  description:
    'A second free breach index, covering breaches other indexes miss. Returns breach names and data categories only — never the data. Receives your address in full.',
  homepage: 'https://leakcheck.io',
  requires: ['email'],
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);
    const provider = { id: 'leakcheck', label: 'LeakCheck', url: 'https://leakcheck.io' };

    try {
      const [catalog, data] = await Promise.all([
        getBreachCatalog(context.signal),
        requestJson<LeakCheckResponse>(`${apiBase()}?check=${encodeURIComponent(email)}`, {
          signal: context.signal,
          timeoutMs: 12_000,
        }),
      ]);

      // `success: false` with "Not found" is how a clean address is reported.
      if (!data || data.success === false || !Array.isArray(data.sources)) {
        return { status: 'ok', checked: 0 };
      }

      // Categories are reported for the result as a whole rather than per
      // breach, so they seed each finding and the catalogue refines it.
      const categories = Array.isArray(data.fields) ? data.fields : [];

      let emitted = 0;
      for (const entry of data.sources) {
        const normalised = normaliseSource(entry);
        if (!normalised) continue;

        const finding = buildBreachFinding(
          {
            name: normalised.name,
            fallback: {
              domain: normalised.name.includes('.') ? normalised.name : undefined,
              date: normalised.date?.length === 7 ? `${normalised.date}-01` : normalised.date,
              year: Number(normalised.date?.slice(0, 4)) || undefined,
              dataClasses: categories,
            },
          },
          catalog,
          provider,
        );
        if (!finding) continue;
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
