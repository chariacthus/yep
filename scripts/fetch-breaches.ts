/**
 * Vendors the Have I Been Pwned breach catalogue into data/breaches.json.
 *
 * The catalogue is public and needs no API key — only the per-address lookup
 * does. The app fetches it at runtime and caches it, so this script is optional:
 * it bakes a copy into the build so the very first scan on a cold start is fast,
 * and so the app still describes breaches properly if HIBP is unreachable.
 *
 * Usage: npm run data:breaches
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'https://haveibeenpwned.com/api/v3/breaches';

async function main(): Promise<void> {
  const response = await fetch(URL, {
    headers: {
      accept: 'application/json',
      'user-agent': 'ExposureScanner/0.1 (+https://github.com/chariacthus/yep)',
    },
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw new Error(`Catalogue responded ${response.status}`);

  const breaches = (await response.json()) as unknown[];
  if (!Array.isArray(breaches) || breaches.length < 100) {
    throw new Error(`Refusing to write a catalogue of only ${breaches?.length ?? 0} breaches`);
  }

  const payload = {
    _note:
      'Fallback copy of the Have I Been Pwned breach catalogue (CC BY). Used when the live keyless endpoint cannot be reached. Regenerate with: npm run data:breaches',
    generatedAt: new Date().toISOString(),
    breaches,
  };

  writeFileSync(join(process.cwd(), 'data', 'breaches.json'), `${JSON.stringify(payload)}\n`);
  process.stdout.write(`Wrote ${breaches.length} breaches\n`);
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
