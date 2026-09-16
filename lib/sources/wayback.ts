import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { describeError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * The Internet Archive's CDX index.
 *
 * This is how the report answers "old accounts and profiles". A profile deleted
 * in 2014 is frequently still readable in an archive, exactly as it was, and
 * people are rarely aware of it. The CDX API also gives first and last capture
 * timestamps, which is often the only way to say *when* something was public.
 *
 * Queried per username against a small set of well-known profile URL patterns.
 * We do not query by name: archive URLs do not contain names, so it would
 * return nothing useful.
 */

const CDX = 'https://web.archive.org/cdx/search/cdx';

/** Profile URL shapes worth checking for archived copies. */
const PROFILE_PATTERNS: Array<{ site: string; url: (handle: string) => string }> = [
  { site: 'Twitter/X', url: (h) => `twitter.com/${h}` },
  { site: 'Myspace', url: (h) => `myspace.com/${h}` },
  { site: 'Tumblr', url: (h) => `${h}.tumblr.com` },
  { site: 'Flickr', url: (h) => `flickr.com/photos/${h}` },
  { site: 'LiveJournal', url: (h) => `${h}.livejournal.com` },
  { site: 'Blogspot', url: (h) => `${h}.blogspot.com` },
  { site: 'WordPress.com', url: (h) => `${h}.wordpress.com` },
  { site: 'About.me', url: (h) => `about.me/${h}` },
  { site: 'Last.fm', url: (h) => `last.fm/user/${h}` },
  { site: 'DeviantArt', url: (h) => `${h}.deviantart.com` },
];

type CdxRow = [string, string, string];

export const waybackSource: Source = {
  id: 'wayback',
  label: 'Internet Archive',
  kind: 'archive',
  description:
    'Looks for archived copies of old profile pages under your username — including ones that have since been deleted.',
  homepage: 'https://web.archive.org',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (!context.identity.username) {
      return { status: 'skipped', reason: 'No username was provided' };
    }

    const handle = reveal(context.identity.username);
    let checked = 0;
    let failures = 0;

    for (const pattern of PROFILE_PATTERNS) {
      if (Date.now() > context.deadline) {
        return {
          status: 'partial',
          checked,
          total: PROFILE_PATTERNS.length,
          reason: 'The scan ran out of time before every archive pattern was checked',
        };
      }

      const target = pattern.url(handle);
      const query =
        `${CDX}?url=${encodeURIComponent(target)}` +
        '&output=json&fl=timestamp,original,statuscode&collapse=timestamp:4&limit=200';

      try {
        const rows = await requestJson<CdxRow[]>(query, {
          signal: context.signal,
          timeoutMs: 10_000,
        });
        checked += 1;

        // Row 0 is the header. No data rows means nothing was ever archived.
        if (!Array.isArray(rows) || rows.length < 2) continue;

        const captures = rows.slice(1).filter((row) => Array.isArray(row) && row[0]);
        if (captures.length === 0) continue;

        const timestamps = captures.map((row) => row[0]).sort();
        const first = timestamps[0]!;
        const last = timestamps[timestamps.length - 1]!;
        const firstYear = Number(first.slice(0, 4));
        const lastYear = Number(last.slice(0, 4));

        emit.finding({
          id: `wayback:${pattern.site}`,
          section: 'archive',
          title: `An archived ${pattern.site} page exists under your username`,
          provider: {
            id: 'wayback',
            label: 'Internet Archive',
            url: 'https://web.archive.org',
          },
          origin: { name: pattern.site, domain: target.split('/')[0] },
          occurredAt: { year: firstYear, precision: 'year' },
          discoveredAt: `${lastYear}`,
          dataTypes: ['username', 'social_profile'],
          confidence: assessConfidence({
            signals: ['username_exact'],
            nameOnly: false,
            usernameOnly: !context.corroboration.confirmedHosts.has(
              target.split('/')[0]?.replace(/^www\./, '') ?? '',
            ),
          }),
          evidence: {
            url: `https://web.archive.org/web/${last}/${target}`,
            label: 'View the archived page',
          },
          whyItMatters:
            `This page was captured ${captures.length} time${captures.length === 1 ? '' : 's'} between ${firstYear} and ${lastYear}. ` +
            'Archived copies survive after the original is deleted, so an account you closed years ago may still be readable — often containing information you would not publish today.',
          actions: [
            {
              type: 'review_account',
              label: 'Check what the archived page shows',
              detail:
                'Open the snapshot and see what is actually visible before deciding whether it needs action.',
              url: `https://web.archive.org/web/${last}/${target}`,
            },
            {
              type: 'opt_out',
              label: 'Request removal from the archive',
              detail:
                'The Internet Archive will consider exclusion requests for pages about you. Email info@archive.org with the URLs and your reason.',
              url: 'https://help.archive.org/help/how-do-i-request-to-remove-something-from-archive-org/',
            },
          ],
          educationKey: 'archived_page',
        });
      } catch {
        failures += 1;
      }
    }

    if (failures === PROFILE_PATTERNS.length) {
      return { status: 'failed', reason: 'The Internet Archive did not respond' };
    }
    if (failures > 0) {
      return {
        status: 'partial',
        checked,
        total: PROFILE_PATTERNS.length,
        reason: 'Some archive queries failed',
      };
    }
    return { status: 'ok', checked };
  },
};
