/**
 * Refreshes data/wmn-data.json from the WhatsMyName project.
 *
 * The dataset is vendored rather than fetched at runtime so that a scan cannot
 * be affected by an upstream change mid-request, and so the health data stays
 * in sync with the site list it describes.
 *
 * WhatsMyName is CC BY-SA 4.0 (Micah Hoffman and contributors). Attribution
 * appears on /about/sources; keep it there.
 *
 * Usage: npm run data:wmn
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SOURCE = 'https://raw.githubusercontent.com/WebBreacher/WhatsMyName/main/wmn-data.json';

interface WmnData {
  license: string[];
  authors: string[];
  categories: string[];
  sites: Array<{ name: string; uri_check: string }>;
}

async function main(): Promise<void> {
  const response = await fetch(SOURCE, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Upstream responded ${response.status}`);

  const data = (await response.json()) as WmnData;

  if (!Array.isArray(data.sites) || data.sites.length < 100) {
    throw new Error(`Refusing to write a dataset with only ${data.sites?.length ?? 0} sites`);
  }

  writeFileSync(join(process.cwd(), 'data', 'wmn-data.json'), `${JSON.stringify(data)}\n`);
  process.stdout.write(
    `Wrote ${data.sites.length} sites. Now run: npm run data:wmn:validate\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
