/**
 * Regenerates data/wmn-health.json.
 *
 * This is the single largest false-positive control in the username sweep.
 *
 * Every entry in the WhatsMyName dataset ships with `known` usernames that are
 * supposed to exist on that site. Sites redesign constantly, and when they do,
 * the string a rule matches on can start appearing on pages for accounts that
 * do not exist -- at which point the sweep reports a confident hit for every
 * username anyone searches. This script re-tests each site against its own
 * known-good usernames and records which ones can still be trusted:
 *
 *   - unhealthy: the known username was NOT detected. Detection is broken, so
 *     the site is excluded from scans entirely.
 *   - unreliable: detection worked, but a username that should not exist was
 *     also reported as present. Probed, but flagged and capped at "possible".
 *
 * This needs real outbound network access and takes a few minutes. Run it on a
 * schedule, not in a request.
 *
 * Usage: npm run data:wmn:validate
 */
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

interface WmnSite {
  name: string;
  uri_check: string;
  e_code: number;
  e_string: string;
  m_code: number;
  m_string: string;
  known?: string[];
  headers?: Record<string, string>;
  post_body?: string;
  strip_bad_char?: string;
}

const CONCURRENCY = 16;
const TIMEOUT_MS = 12_000;
const MAX_BODY = 512 * 1024;

const USER_AGENT =
  'ExposureScanner/0.1 (dataset validation; +https://github.com/chariacthus/yep)';

function strip(handle: string, site: WmnSite): string {
  if (!site.strip_bad_char) return handle;
  let out = handle;
  for (const char of site.strip_bad_char) out = out.split(char).join('');
  return out;
}

type Verdict = 'found' | 'absent' | 'indeterminate';

function evaluate(site: WmnSite, status: number, body: string): Verdict {
  if (status === site.e_code && (!site.e_string || body.includes(site.e_string))) return 'found';
  if (status === site.m_code && (!site.m_string || body.includes(site.m_string))) return 'absent';
  return 'indeterminate';
}

async function probe(site: WmnSite, handle: string): Promise<Verdict> {
  const account = strip(handle, site);
  const url = site.uri_check.replace('{account}', encodeURIComponent(account));

  try {
    const response = await fetch(url, {
      method: site.post_body ? 'POST' : 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...(site.headers ?? {}),
      },
      body: site.post_body ? site.post_body.replace('{account}', account) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    const needsBody = Boolean(site.e_string) || Boolean(site.m_string);
    const body = needsBody ? (await response.text()).slice(0, MAX_BODY) : '';
    return evaluate(site, response.status, body);
  } catch {
    return 'indeterminate';
  }
}

async function validate(site: WmnSite): Promise<'healthy' | 'unhealthy' | 'unreliable'> {
  const known = site.known?.[0];
  if (!known) return 'unhealthy'; // Nothing to validate against; do not trust it.

  const positive = await probe(site, known);
  if (positive !== 'found') return 'unhealthy';

  // A username nobody could plausibly hold. If the site claims it exists, the
  // rule matches something that is always present, and every hit is a false one.
  const impossible = `zz${randomBytes(8).toString('hex')}zz`;
  const negative = await probe(site, impossible);

  return negative === 'found' ? 'unreliable' : 'healthy';
}

async function main(): Promise<void> {
  const dataPath = join(process.cwd(), 'data', 'wmn-data.json');
  const data = JSON.parse(readFileSync(dataPath, 'utf8')) as { sites: WmnSite[] };

  const unhealthy: string[] = [];
  const unreliable: string[] = [];
  let done = 0;

  const queue = [...data.sites];
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    for (;;) {
      const site = queue.shift();
      if (!site) return;

      const verdict = await validate(site);
      if (verdict === 'unhealthy') unhealthy.push(site.name);
      if (verdict === 'unreliable') unreliable.push(site.name);

      done += 1;
      if (done % 25 === 0) {
        process.stdout.write(`  ${done}/${data.sites.length} validated\n`);
      }
    }
  });

  await Promise.all(workers);

  const payload = {
    generatedAt: new Date().toISOString(),
    totalSites: data.sites.length,
    unhealthy: unhealthy.sort(),
    unreliable: unreliable.sort(),
  };

  writeFileSync(join(process.cwd(), 'data', 'wmn-health.json'), `${JSON.stringify(payload, null, 1)}\n`);
  process.stdout.write(
    `Validated ${data.sites.length} sites: ${unhealthy.length} unhealthy (excluded), ` +
      `${unreliable.length} unreliable (flagged)\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
});
