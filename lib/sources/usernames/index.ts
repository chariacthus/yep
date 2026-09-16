import { reveal } from '../../identity';
import { assessConfidence } from '../../confidence/score';
import type { Finding } from '../../normalize/finding';
import type { SignalId } from '../../confidence/signals';
import type { Emit, ScanContext, Source, SourceOutcome } from '../types';
import { HOSTS_WITH_DEDICATED_SOURCES } from '../registry';
import { probeAll } from './prober';
import { prepareSites } from './wmn';

/**
 * The username sweep.
 *
 * Checks the full WhatsMyName dataset — around 700 sites. Four things keep that
 * from being slow, noisy and rude:
 *
 *   - Unhealthy sites are excluded at build time by scripts/validate-wmn.ts,
 *     which re-tests each site's detection logic against the known-good
 *     usernames the dataset ships. Stale detection logic is the single largest
 *     source of false positives here.
 *   - Mainstream sites are probed first, so recognisable results appear within
 *     seconds while the long tail continues behind them.
 *   - One request in flight per host, with a host abandoned after it refuses us
 *     twice.
 *   - A wall-clock deadline. When it expires the sweep reports how many sites it
 *     actually reached rather than quietly stopping.
 *
 * Confidence is deliberately conservative: a username is not an identifier, so
 * a bare match is "possible" and only rises when something independent — a
 * Gravatar-verified link to the same host, say — corroborates it.
 */

const DEFAULT_CONCURRENCY = 32;
// Sites that have not answered in four seconds are almost always blocking us
// rather than being slow; waiting longer just spends the budget.
const PROBE_TIMEOUT_MS = 4000;

function concurrency(): number {
  const configured = Number(process.env.SCAN_USERNAME_CONCURRENCY);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_CONCURRENCY;
  return Math.min(64, Math.floor(configured));
}

export const usernameSource: Source = {
  id: 'usernames',
  label: 'Public sites (username sweep)',
  kind: 'username',
  description:
    'Checks around 700 public websites for an account using your username, using the community-maintained WhatsMyName dataset.',
  homepage: 'https://github.com/WebBreacher/WhatsMyName',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (!context.identity.username) {
      return { status: 'skipped', reason: 'No username was provided' };
    }

    const handle = reveal(context.identity.username);

    // A dedicated adapter reports these hosts in far more detail, so letting the
    // sweep report them as well would duplicate every one of them with a worse
    // version of the same finding.
    const sites = prepareSites().filter(
      (site) => !HOSTS_WITH_DEDICATED_SOURCES.has(site.host.replace(/^www\./, '')),
    );
    const total = sites.length;

    let completed = 0;
    let found = 0;
    // A probe that returned neither the dataset's "exists" nor its "missing"
    // signature tells us nothing. Counting these separately is what stops the
    // sweep reporting a clean result when it was in fact blocked everywhere.
    let indeterminate = 0;
    // Matches found but not returned because the category is revealing and
    // ownership was never proved. Counted so the report can say so.
    let withheld = 0;

    const results = probeAll(sites, handle, {
      concurrency: concurrency(),
      timeoutMs: PROBE_TIMEOUT_MS,
      deadline: context.deadline,
      signal: context.signal,
    });

    for await (const result of results) {
      completed += 1;
      if (completed % 10 === 0 || completed === total) emit.progress(completed, total);

      if (result.verdict === 'indeterminate') indeterminate += 1;
      if (result.verdict !== 'found') continue;

      const { site } = result;

      // A match on a site the person has provably linked elsewhere is no longer
      // a coincidence.
      const corroborated = context.corroboration.confirmedHosts.has(
        site.host.replace(/^www\./, ''),
      );

      // Sensitive categories can out somebody. Nobody should be able to type a
      // stranger's username and learn which dating or adult sites they use, so
      // these are withheld entirely unless ownership has actually been proved.
      if (site.sensitive && !context.emailVerified) {
        withheld += 1;
        continue;
      }

      const signals: SignalId[] = ['username_exact'];
      if (corroborated) signals.push('linked_account_verified');
      if (site.unreliable) signals.push('low_reliability_source');

      emit.finding({
        id: `wmn:${site.name}`,
        section: 'usernames',
        title: `An account exists on ${site.name} with your username`,
        provider: {
          id: 'usernames',
          label: 'WhatsMyName',
          url: 'https://github.com/WebBreacher/WhatsMyName',
        },
        origin: { name: site.name, domain: site.host },
        dataTypes: ['username', 'social_profile'],
        confidence: assessConfidence({
          signals,
          nameOnly: false,
          usernameOnly: !corroborated,
        }),
        evidence: result.profileUrl ? { url: result.profileUrl, label: 'Open the profile' } : undefined,
        whyItMatters:
          'Someone is using this username here. Reusing one username across services lets anyone link those accounts together in seconds, including accounts you may think of as separate from your real identity. ' +
          (corroborated
            ? 'You have publicly linked this site to your email address elsewhere, so this one is almost certainly yours.'
            : 'Usernames are not unique, so this may belong to somebody else — check before acting on it.'),
        actions: [
          {
            type: 'review_account',
            label: 'Check whether this account is yours',
            detail: result.profileUrl
              ? 'Open the profile and confirm. If it is yours and you no longer use it, closing it removes whatever it still shows.'
              : 'If this account is yours and you no longer use it, closing it removes whatever it still shows.',
            url: result.profileUrl,
          },
        ],
        educationKey: 'username_reuse',
        flags: {
          sensitive: site.sensitive,
          lowReliability: site.unreliable,
        },
      });
      found += 1;
    }

    emit.progress(completed, total);

    const conclusive = completed - indeterminate;

    if (completed < total) {
      return {
        status: 'partial',
        checked: conclusive,
        total,
        withheld,
        reason:
          'The scan reached its time limit before every site could be checked. The sites not reached are unknown, not clear.',
      };
    }

    // Sites that did not answer conclusively are unknown, not clear. Reporting
    // a clean sweep when most probes were blocked or timed out would be a false
    // all-clear, which is the one thing this report must never give.
    if (indeterminate > total * 0.2) {
      return {
        status: 'partial',
        checked: conclusive,
        total,
        withheld,
        reason:
          `${indeterminate} of ${total} sites did not give a usable answer — they blocked us, timed out, or changed their pages. Those sites are unknown, not clear.`,
      };
    }

    return { status: 'ok', checked: conclusive, withheld };
  },
};
