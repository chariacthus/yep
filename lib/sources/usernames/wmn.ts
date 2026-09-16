import wmnData from '../../../data/wmn-data.json';
import health from '../../../data/wmn-health.json';

/**
 * The WhatsMyName dataset.
 *
 * Community-maintained, 700+ sites, CC BY-SA 4.0 (Micah Hoffman and
 * contributors). Vendored rather than fetched at runtime so a scan cannot be
 * affected by an upstream change mid-request, and so the health data below
 * stays in sync with the site list it describes.
 *
 * Attribution is required by the licence and appears on /about/sources.
 */

export interface WmnSite {
  name: string;
  uri_check: string;
  uri_pretty?: string;
  e_code: number;
  e_string: string;
  m_code: number;
  m_string: string;
  known?: string[];
  cat: string;
  protection?: string[];
  headers?: Record<string, string>;
  post_body?: string;
  strip_bad_char?: string;
}

interface WmnData {
  license: string[];
  authors: string[];
  categories: string[];
  sites: WmnSite[];
}

interface HealthData {
  generatedAt: string;
  /** Site names whose detection logic failed validation and are not probed. */
  unhealthy: string[];
  /** Site names that produced inconsistent results; probed but flagged. */
  unreliable: string[];
}

const data = wmnData as WmnData;
const healthData = health as HealthData;

export const WMN_LICENSE = data.license.join(' ');
export const WMN_AUTHORS = data.authors;

/**
 * Categories where a match could out somebody. Treated exactly like HIBP's
 * sensitive breach flag: only surfaced to a person who has proved they own the
 * address, and kept collapsed behind an explicit reveal in the UI.
 */
const SENSITIVE_CATEGORIES = new Set(['xx NSFW xx', 'dating', 'political', 'health']);

/**
 * Sites probed first, so the report is useful within seconds rather than after
 * the full sweep. Chosen for being mainstream and high-signal — a match here
 * tells the person something they will recognise.
 */
const TIER_ONE_NAMES = new Set([
  'GitHub',
  'GitLab',
  'Reddit',
  'Instagram',
  'X',
  'Twitter',
  'Facebook',
  'TikTok',
  'YouTube',
  'LinkedIn',
  'Pinterest',
  'Twitch',
  'Steam',
  'Spotify',
  'SoundCloud',
  'Medium',
  'Tumblr',
  'Flickr',
  'Vimeo',
  'Dribbble',
  'Behance',
  'Patreon',
  'Etsy',
  'eBay',
  'PayPal',
  'Venmo',
  'Cash App',
  'Telegram',
  'Discord',
  'Snapchat',
  'Mastodon',
  'Bluesky',
  'Stack Overflow',
  'HackerNews',
  'Hacker News',
  'Docker Hub',
  'npm',
  'PyPI',
  'Keybase',
  'About.me',
  'Gravatar',
  'Last.fm',
  'Goodreads',
  'Duolingo',
  'Strava',
  'Chess.com',
  'Lichess',
  'Roblox',
  'Xbox Gamertag',
  'Wikipedia',
  'WordPress',
  'Blogger',
  'DeviantArt',
  'Imgur',
  'Quora',
  'Slideshare',
  'Trello',
  'Replit',
  'CodePen',
]);

export interface PreparedSite extends WmnSite {
  tier: 1 | 2;
  sensitive: boolean;
  unreliable: boolean;
  host: string;
}

function hostOf(uri: string): string | null {
  try {
    // The template placeholder is not a valid URL character in every position,
    // so substitute something benign before parsing.
    return new URL(uri.replace('{account}', 'x')).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Site list for a scan: unhealthy entries removed, everything else annotated
 * with the tier, sensitivity and reliability the prober needs.
 */
export function prepareSites(): PreparedSite[] {
  const unhealthy = new Set(healthData.unhealthy);
  const unreliable = new Set(healthData.unreliable);
  const prepared: PreparedSite[] = [];

  for (const site of data.sites) {
    if (unhealthy.has(site.name)) continue;
    if (!site.uri_check.startsWith('https://')) continue;

    const host = hostOf(site.uri_check);
    if (!host) continue;

    prepared.push({
      ...site,
      host,
      tier: TIER_ONE_NAMES.has(site.name) ? 1 : 2,
      sensitive: SENSITIVE_CATEGORIES.has(site.cat),
      unreliable: unreliable.has(site.name),
    });
  }

  // Tier 1 first so the live counter produces recognisable hits immediately.
  return prepared.sort((a, b) => a.tier - b.tier);
}

/** Every host in the dataset. Used as the prober's allowlist. */
export function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const site of data.sites) {
    const host = hostOf(site.uri_check);
    if (host) hosts.add(host);
  }
  return hosts;
}

export function applyStripBadChars(handle: string, site: WmnSite): string {
  if (!site.strip_bad_char) return handle;
  let out = handle;
  for (const char of site.strip_bad_char) out = out.split(char).join('');
  return out;
}

/**
 * The dataset's match rule. A positive needs the expected status code and, when
 * one is specified, the expected body fragment. Anything that satisfies neither
 * the positive nor the negative rule is indeterminate and reported as nothing
 * at all — guessing would manufacture false positives.
 */
export type ProbeVerdict = 'found' | 'absent' | 'indeterminate';

export function evaluate(site: WmnSite, status: number, body: string): ProbeVerdict {
  const positiveCode = status === site.e_code;
  const positiveString = !site.e_string || body.includes(site.e_string);
  if (positiveCode && positiveString) return 'found';

  const negativeCode = status === site.m_code;
  const negativeString = !site.m_string || body.includes(site.m_string);
  if (negativeCode && negativeString) return 'absent';

  return 'indeterminate';
}
