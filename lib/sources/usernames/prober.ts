import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { MAX_BODY_BYTES, readBodyCapped, USER_AGENT } from '../http';
import { allowedHosts, applyStripBadChars, evaluate, type PreparedSite, type ProbeVerdict } from './wmn';

/**
 * Probes a single site for the existence of a username.
 *
 * The URLs come from a vendored dataset rather than user input, but the guard
 * below is applied anyway. A dataset is a supply chain: one merged pull request
 * upstream could otherwise turn this server into an SSRF proxy against the
 * internal network it runs in.
 */

export interface ProbeResult {
  site: PreparedSite;
  verdict: ProbeVerdict;
  /** The profile URL to show the person, when one exists. */
  profileUrl?: string;
  status?: number;
  blocked?: boolean;
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
];

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:')
    );
  }
  return PRIVATE_V4.some((pattern) => pattern.test(address));
}

const hostAllowlist = allowedHosts();
const resolutionCache = new Map<string, boolean>();

/** True when the host is in the dataset and does not resolve to a private address. */
async function hostIsSafe(host: string): Promise<boolean> {
  if (!hostAllowlist.has(host)) return false;

  const cached = resolutionCache.get(host);
  if (cached !== undefined) return cached;

  try {
    const addresses = await lookup(host, { all: true });
    const safe = addresses.length > 0 && !addresses.some((entry) => isPrivateAddress(entry.address));
    resolutionCache.set(host, safe);
    return safe;
  } catch {
    resolutionCache.set(host, false);
    return false;
  }
}

export interface ProbeOptions {
  timeoutMs: number;
  signal: AbortSignal;
}

export async function probeSite(
  site: PreparedSite,
  rawHandle: string,
  options: ProbeOptions,
): Promise<ProbeResult> {
  const handle = applyStripBadChars(rawHandle, site);
  const url = site.uri_check.replace('{account}', encodeURIComponent(handle));

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { site, verdict: 'indeterminate' };
  }

  if (parsed.protocol !== 'https:' || !(await hostIsSafe(parsed.hostname.toLowerCase()))) {
    return { site, verdict: 'indeterminate', blocked: true };
  }

  const timeout = AbortSignal.timeout(options.timeoutMs);
  const signal = AbortSignal.any([options.signal, timeout]);

  try {
    const response = await fetch(url, {
      method: site.post_body ? 'POST' : 'GET',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        ...(site.headers ?? {}),
      },
      body: site.post_body ? site.post_body.replace('{account}', handle) : undefined,
      // Never followed: the dataset's negative case is frequently a redirect,
      // and following one would also reopen the SSRF path the guard closes.
      redirect: 'manual',
      signal,
    });

    // The body is only read when a string match is actually needed, and never
    // beyond the cap. Nothing fetched here is stored or rendered.
    const needsBody = Boolean(site.e_string) || Boolean(site.m_string);
    const body = needsBody ? await readBodyCapped(response, MAX_BODY_BYTES) : '';

    const verdict = evaluate(site, response.status, body);
    const profileUrl = site.uri_pretty
      ? site.uri_pretty.replace('{account}', encodeURIComponent(handle))
      : url;

    return {
      site,
      verdict,
      status: response.status,
      profileUrl: verdict === 'found' ? profileUrl : undefined,
    };
  } catch {
    return { site, verdict: 'indeterminate' };
  }
}

/**
 * Runs probes with a global concurrency cap and at most one request in flight
 * per host, so a site with several entries in the dataset is never hit in
 * parallel.
 *
 * Results are yielded as they complete so the report can stream, and the sweep
 * stops cleanly at the deadline rather than being killed mid-request.
 */
export async function* probeAll(
  sites: PreparedSite[],
  handle: string,
  options: { concurrency: number; timeoutMs: number; deadline: number; signal: AbortSignal },
): AsyncGenerator<ProbeResult> {
  const queue = [...sites];
  const busyHosts = new Set<string>();
  /** Hosts that rate-limited or refused us; skipped for the rest of the sweep. */
  const abandonedHosts = new Set<string>();
  const hostFailures = new Map<string, number>();

  // Each in-flight probe resolves to its own slot id, so the completed one can
  // be removed without having to compare result objects.
  const inFlight = new Map<number, Promise<{ slot: number; result: ProbeResult }>>();
  let nextSlot = 0;

  const settle = (result: ProbeResult): { slot: number; result: ProbeResult } => {
    const slot = nextSlot;
    nextSlot += 1;
    return { slot, result };
  };

  const startNext = (): boolean => {
    for (let index = 0; index < queue.length; index += 1) {
      const site = queue[index]!;
      if (busyHosts.has(site.host)) continue;

      queue.splice(index, 1);
      const slot = nextSlot;
      nextSlot += 1;

      if (abandonedHosts.has(site.host)) {
        // Reported as indeterminate rather than silently dropped, so the
        // coverage count stays honest.
        inFlight.set(
          slot,
          Promise.resolve({ slot, result: { site, verdict: 'indeterminate', blocked: true } }),
        );
        return true;
      }

      busyHosts.add(site.host);
      inFlight.set(
        slot,
        probeSite(site, handle, { timeoutMs: options.timeoutMs, signal: options.signal })
          .then((result) => {
            busyHosts.delete(site.host);
            if (result.status === 429 || result.status === 403) {
              const failures = (hostFailures.get(site.host) ?? 0) + 1;
              hostFailures.set(site.host, failures);
              if (failures >= 2) abandonedHosts.add(site.host);
            }
            return { slot, result };
          })
          .catch(() => {
            busyHosts.delete(site.host);
            return { slot, result: { site, verdict: 'indeterminate' as ProbeVerdict } };
          }),
      );
      return true;
    }
    return false;
  };

  while (queue.length > 0 || inFlight.size > 0) {
    if (Date.now() > options.deadline || options.signal.aborted) break;

    while (inFlight.size < options.concurrency && startNext()) {
      // Filling the concurrency window.
    }
    if (inFlight.size === 0) break;

    const { slot, result } = await Promise.race(inFlight.values());
    inFlight.delete(slot);
    yield result;
  }
}
