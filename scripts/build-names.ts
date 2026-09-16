/**
 * Builds data/common-names.json, the frequency table behind the common-name
 * penalty in lib/confidence/names.ts.
 *
 * Sources:
 *   - Surnames: US Census Bureau "Frequently Occurring Surnames" (public
 *     domain), mirrored by FiveThirtyEight.
 *   - Given names: FiveThirtyEight's most-common-name dataset, derived from
 *     Social Security Administration figures (CC BY 4.0 — attributed in
 *     docs/legal.md and on /about/sources).
 *
 * Only common names are kept. A name absent from the table is treated as rare
 * and attracts no penalty, so truncating the tail is safe.
 *
 * Usage: npx tsx scripts/build-names.ts
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SURNAMES_URL =
  'https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/surnames.csv';
const FIRST_NAMES_URL =
  'https://raw.githubusercontent.com/fivethirtyeight/data/master/most-common-name/new-top-firstNames.csv';

const SURNAME_LIMIT = 5000;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`${url} responded ${response.status}`);
  return response.text();
}

function parseSurnames(csv: string): Record<string, number> {
  const out: Record<string, number> = {};
  const lines = csv.split('\n').slice(1);

  for (const line of lines.slice(0, SURNAME_LIMIT)) {
    const cells = line.split(',');
    const name = cells[0]?.trim().toLowerCase();
    const per100k = Number(cells[3]);
    if (!name || name === 'all other names' || !Number.isFinite(per100k)) continue;
    out[name] = Math.round(per100k * 100) / 100;
  }
  return out;
}

function parseGivenNames(csv: string): Record<string, number> {
  const out: Record<string, number> = {};

  for (const line of csv.split('\n').slice(1)) {
    // Format: "rank","Name",proportion
    const match = line.match(/^"[^"]*","([^"]+)",([0-9.eE-]+)/);
    if (!match) continue;
    const name = match[1]?.trim().toLowerCase();
    const proportion = Number(match[2]);
    if (!name || !Number.isFinite(proportion)) continue;
    // Convert proportion of population to a per-100k rate, matching surnames.
    out[name] = Math.round(proportion * 100_000 * 100) / 100;
  }
  return out;
}

async function main(): Promise<void> {
  const [surnameCsv, givenCsv] = await Promise.all([
    fetchText(SURNAMES_URL),
    fetchText(FIRST_NAMES_URL),
  ]);

  const surnames = parseSurnames(surnameCsv);
  const givenNames = parseGivenNames(givenCsv);

  const surnameMax = Math.max(...Object.values(surnames));
  const givenNameMax = Math.max(...Object.values(givenNames));

  const payload = {
    _source: {
      surnames: 'US Census Bureau, Frequently Occurring Surnames (public domain)',
      givenNames: 'FiveThirtyEight most-common-name dataset, from SSA data (CC BY 4.0)',
      generatedBy: 'scripts/build-names.ts',
    },
    surnameMax,
    givenNameMax,
    surnames,
    givenNames,
  };

  const target = join(process.cwd(), 'data', 'common-names.json');
  writeFileSync(target, `${JSON.stringify(payload)}\n`);
  process.stdout.write(
    `Wrote ${Object.keys(surnames).length} surnames and ${Object.keys(givenNames).length} given names\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
