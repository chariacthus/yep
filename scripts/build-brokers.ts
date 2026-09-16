/**
 * Builds data/brokers.json — the removal-opportunity directory.
 *
 * Two sources are merged:
 *
 *   1. The California Privacy Protection Agency's data broker registry. This is
 *      an official public record of every broker legally required to register
 *      in California (~600 as of September 2026). It is authoritative about who
 *      the brokers *are*.
 *   2. brianreumere/data-brokers (BSD-2-Clause), a community-maintained set of
 *      YAML files describing how each broker's opt-out process actually works.
 *      The registry does not carry opt-out URLs, so this supplies them.
 *
 * If the CPPA registry cannot be fetched, the build still succeeds using the
 * community data alone, and records that fact in the output so the UI can say
 * so rather than implying full coverage.
 *
 * Usage: npx tsx scripts/build-brokers.ts
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';

const CPPA_CSV = 'https://cppa.ca.gov/data_broker_registry/registry.csv';
const COMMUNITY_REPO = 'https://github.com/brianreumere/data-brokers.git';

interface CommunityBroker {
  names?: string[];
  url?: string;
  removalUrl?: string;
  process?: string;
  helpLinks?: Array<{ site?: string; url?: string }>;
  status?: { working?: boolean; asOf?: string; workaround?: string };
  notes?: Array<{ note?: string; date?: string }>;
}

export interface BrokerEntry {
  id: string;
  name: string;
  aliases: string[];
  website?: string;
  optOutUrl?: string;
  /** How the opt-out works, in plain language. */
  process?: string;
  helpUrl?: string;
  /** False when the community data records the opt-out as currently broken. */
  optOutWorking?: boolean;
  workaround?: string;
  /** True when the broker appears in California's official registry. */
  registeredInCalifornia: boolean;
  collects: string[];
}

/** Maps the community repo's process codes to something a person can read. */
const PROCESS_LABELS: Record<string, string> = {
  'search-first': 'Search for your own listing, then request its removal.',
  'opt-out-search': 'Use their dedicated opt-out search page.',
  control: 'Submit a request through their privacy control page.',
  email: 'Email them a removal request.',
  form: 'Fill in their removal form.',
  'search-for-removal': 'Search for your listing; a remove option appears on the result.',
};

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|co|company|holdings|group)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function loadCommunityBrokers(): Map<string, CommunityBroker> {
  const checkout = mkdtempSync(join(tmpdir(), 'brokers-'));
  const out = new Map<string, CommunityBroker>();

  try {
    execFileSync('git', ['clone', '--depth', '1', '--quiet', COMMUNITY_REPO, checkout], {
      stdio: 'ignore',
      timeout: 120_000,
    });

    const dataDir = join(checkout, 'data');
    if (!existsSync(dataDir)) return out;

    for (const file of readdirSync(dataDir)) {
      if (!file.endsWith('.yaml') && !file.endsWith('.yml')) continue;
      const parsed = parse(readFileSync(join(dataDir, file), 'utf8')) as Record<string, CommunityBroker>;
      for (const [key, value] of Object.entries(parsed ?? {})) out.set(key, value);
    }
  } catch {
    process.stderr.write('Could not clone the community broker repo; continuing without it.\n');
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }

  return out;
}

/** Minimal CSV reader that handles quoted fields containing commas. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      cell = '';
    } else cell += char;
  }

  if (cell || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

async function loadCaliforniaRegistry(): Promise<Array<{ name: string; website?: string; collects: string[] }>> {
  const response = await fetch(CPPA_CSV, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`CPPA registry responded ${response.status}`);

  const rows = parseCsv(await response.text());
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase()) ?? [];

  const nameIndex = header.findIndex((cell) => cell.includes('name'));
  const siteIndex = header.findIndex((cell) => cell.includes('website') || cell.includes('url'));
  if (nameIndex < 0) throw new Error('Could not find a name column in the CPPA registry');

  // Columns whose header describes a data category the broker collects.
  const categoryColumns = header
    .map((cell, index) => ({ cell, index }))
    .filter(({ cell }) => /minors|precise geolocation|reproductive|biometric/.test(cell));

  return rows
    .slice(1)
    .filter((row) => row[nameIndex]?.trim())
    .map((row) => ({
      name: row[nameIndex]!.trim(),
      website: siteIndex >= 0 ? row[siteIndex]?.trim() || undefined : undefined,
      collects: categoryColumns
        .filter(({ index }) => /^(yes|true|y)$/i.test(row[index]?.trim() ?? ''))
        .map(({ cell }) => cell),
    }));
}

async function main(): Promise<void> {
  const community = loadCommunityBrokers();

  let registry: Array<{ name: string; website?: string; collects: string[] }> = [];
  let registryAvailable = true;
  try {
    registry = await loadCaliforniaRegistry();
  } catch (error) {
    registryAvailable = false;
    process.stderr.write(
      `California registry unavailable (${String(error)}). Building from community data only.\n`,
    );
  }

  const byNormalisedName = new Map<string, BrokerEntry>();

  const upsert = (entry: BrokerEntry): void => {
    for (const alias of [entry.name, ...entry.aliases]) {
      const key = normaliseName(alias);
      const existing = byNormalisedName.get(key);
      if (existing) {
        // Merge: registry confirms registration, community supplies opt-out data.
        existing.registeredInCalifornia ||= entry.registeredInCalifornia;
        existing.optOutUrl ??= entry.optOutUrl;
        existing.website ??= entry.website;
        existing.process ??= entry.process;
        existing.helpUrl ??= entry.helpUrl;
        existing.workaround ??= entry.workaround;
        if (entry.optOutWorking !== undefined) existing.optOutWorking ??= entry.optOutWorking;
        for (const item of entry.collects) {
          if (!existing.collects.includes(item)) existing.collects.push(item);
        }
        return;
      }
    }
    byNormalisedName.set(normaliseName(entry.name), entry);
  };

  for (const [key, broker] of community) {
    const names = broker.names ?? [key];
    const primary = names[0] ?? key;
    upsert({
      id: slug(key),
      name: primary,
      aliases: names.slice(1),
      website: broker.url,
      optOutUrl: broker.removalUrl,
      process: broker.process ? (PROCESS_LABELS[broker.process] ?? broker.process) : undefined,
      helpUrl: broker.helpLinks?.[0]?.url,
      optOutWorking: broker.status?.working,
      workaround: broker.status?.workaround?.trim(),
      registeredInCalifornia: false,
      collects: [],
    });
  }

  for (const entry of registry) {
    upsert({
      id: slug(entry.name),
      name: entry.name,
      aliases: [],
      website: entry.website,
      registeredInCalifornia: true,
      collects: entry.collects,
    });
  }

  const brokers = [...byNormalisedName.values()].sort((a, b) => a.name.localeCompare(b.name));

  const payload = {
    _source: {
      registry: registryAvailable
        ? 'California Privacy Protection Agency data broker registry (public record)'
        : 'UNAVAILABLE at build time — community data only',
      community: 'github.com/brianreumere/data-brokers (BSD-2-Clause)',
      generatedBy: 'scripts/build-brokers.ts',
    },
    generatedAt: new Date().toISOString(),
    californiaRegistryIncluded: registryAvailable,
    californiaRegisteredCount: brokers.filter((broker) => broker.registeredInCalifornia).length,
    brokers,
  };

  writeFileSync(join(process.cwd(), 'data', 'brokers.json'), `${JSON.stringify(payload, null, 1)}\n`);
  process.stdout.write(
    `Wrote ${brokers.length} brokers (California registry ${registryAvailable ? 'included' : 'UNAVAILABLE'})\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
