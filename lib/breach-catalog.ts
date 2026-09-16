import vendored from '../data/breaches.json';
import { logger } from './logger';

/**
 * The Have I Been Pwned breach catalogue.
 *
 * This is the single most valuable free thing in the whole app, and it is easy
 * to miss: HIBP requires a paid key to ask *whether an address is in a breach*,
 * but the catalogue describing *what every breach was* is public and keyless.
 *
 * So the keyless breach sources (XposedOrNot, LeakCheck) tell us which breaches
 * an address appears in — a bare name, often little more — and this turns each
 * one into a real record: what the company was, when it happened, how many
 * accounts, exactly which categories of data were taken, whether the breach was
 * ever confirmed, and a link to the write-up.
 *
 * Fetched once per process and cached. If it cannot be reached the vendored
 * copy is used, and if that is empty the findings simply stay sparse — they
 * never become wrong.
 */

export interface BreachRecord {
  /** HIBP's stable identifier, e.g. "Adobe". */
  name: string;
  title: string;
  domain?: string;
  breachDate?: string;
  addedDate?: string;
  pwnCount?: number;
  description: string;
  dataClasses: string[];
  isVerified: boolean;
  isSensitive: boolean;
  isMalware: boolean;
  isSpamList: boolean;
  isRetired: boolean;
  logoPath?: string;
  /** The HIBP page describing this breach. */
  url: string;
}

interface HibpBreachJson {
  Name?: string;
  Title?: string;
  Domain?: string;
  BreachDate?: string;
  AddedDate?: string;
  PwnCount?: number;
  Description?: string;
  DataClasses?: string[];
  IsVerified?: boolean;
  IsSensitive?: boolean;
  IsMalware?: boolean;
  IsSpamList?: boolean;
  IsRetired?: boolean;
  LogoPath?: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * The keyless catalogue endpoint. Read at call time and overridable, so tests
 * can supply a fixture instead of reaching the network.
 */
function catalogUrl(): string {
  const base = process.env.HIBP_API_BASE ?? 'https://haveibeenpwned.com/api/v3';
  return `${base}/breaches`;
}

/** Strips HIBP's HTML description to plain text for safe rendering. */
function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toRecord(raw: HibpBreachJson): BreachRecord | null {
  const name = raw.Name?.trim();
  if (!name) return null;

  return {
    name,
    title: raw.Title?.trim() || name,
    domain: raw.Domain?.trim() || undefined,
    breachDate: raw.BreachDate,
    addedDate: raw.AddedDate,
    pwnCount: typeof raw.PwnCount === 'number' ? raw.PwnCount : undefined,
    description: plainText(raw.Description ?? ''),
    dataClasses: Array.isArray(raw.DataClasses) ? raw.DataClasses : [],
    isVerified: raw.IsVerified !== false,
    isSensitive: raw.IsSensitive === true,
    isMalware: raw.IsMalware === true,
    isSpamList: raw.IsSpamList === true,
    isRetired: raw.IsRetired === true,
    logoPath: raw.LogoPath,
    url: `https://haveibeenpwned.com/PwnedWebsites#${encodeURIComponent(name)}`,
  };
}

/**
 * Providers name the same breach differently — "Adobe", "adobe.com",
 * "Adobe Systems". Indexing on a squashed key and on the bare domain lets all
 * of them resolve to one record, which is also what makes de-duplication across
 * providers possible.
 */
function keysFor(record: BreachRecord): string[] {
  const keys = [squash(record.name), squash(record.title)];
  if (record.domain) {
    keys.push(squash(record.domain));
    const root = record.domain.split('.')[0];
    if (root && root.length > 2) keys.push(squash(root));
  }
  return [...new Set(keys)].filter(Boolean);
}

export function squash(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export interface BreachCatalog {
  /** Resolves a provider's breach name to a full record, when we know it. */
  lookup(name: string): BreachRecord | undefined;
  size: number;
  /** False when the live catalogue could not be reached. */
  live: boolean;
}

function build(records: BreachRecord[], live: boolean): BreachCatalog {
  const index = new Map<string, BreachRecord>();
  for (const record of records) {
    for (const key of keysFor(record)) {
      // First writer wins, so a precise name is not displaced by a loose alias.
      if (!index.has(key)) index.set(key, record);
    }
  }

  return {
    size: records.length,
    live,
    lookup(name: string) {
      const squashed = squash(name);
      if (!squashed) return undefined;
      return index.get(squashed);
    },
  };
}

const vendoredRecords = (vendored as { breaches?: HibpBreachJson[] }).breaches ?? [];

let cached: { catalog: BreachCatalog; at: number } | null = null;
let inFlight: Promise<BreachCatalog> | null = null;

async function fetchCatalog(signal?: AbortSignal): Promise<BreachCatalog> {
  try {
    const response = await fetch(catalogUrl(), {
      headers: {
        accept: 'application/json',
        'user-agent': 'ExposureScanner/0.1 (+https://github.com/chariacthus/yep)',
      },
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`catalogue responded ${response.status}`);

    const raw = (await response.json()) as HibpBreachJson[];
    const records = raw.map(toRecord).filter((item): item is BreachRecord => item !== null);
    if (records.length === 0) throw new Error('catalogue was empty');

    logger.debug('Breach catalogue loaded', { breaches: records.length });
    return build(records, true);
  } catch (error) {
    // Falling back is fine: findings stay sparse rather than becoming wrong.
    logger.warn('Breach catalogue unavailable, using vendored copy', {
      vendored: vendoredRecords.length,
      error,
    });
    const records = vendoredRecords
      .map(toRecord)
      .filter((item): item is BreachRecord => item !== null);
    return build(records, false);
  }
}

/** Cached across a process; concurrent callers share one fetch. */
export async function getBreachCatalog(signal?: AbortSignal): Promise<BreachCatalog> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.catalog;
  if (inFlight) return inFlight;

  inFlight = fetchCatalog(signal)
    .then((catalog) => {
      // Only cache a live catalogue, so a transient outage does not pin the
      // sparse fallback in place for twelve hours.
      if (catalog.live) cached = { catalog, at: Date.now() };
      return catalog;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Test seam: drops the cache so a test can control what the catalogue holds. */
export function resetBreachCatalogCache(): void {
  cached = null;
  inFlight = null;
}
