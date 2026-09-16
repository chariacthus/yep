import { assessConfidence } from '../../confidence/score';
import type { Finding } from '../../normalize/finding';
import type { SignalId } from '../../confidence/signals';
import { closeAccountAction, legalErasureAction } from '../../normalize/removal';
import type { Emit, Handle, ScanContext, Source, SourceOutcome } from '../types';
import { hasDedicatedSource } from '../registry';
import { probeAll } from './prober';
import { prepareSites, type PreparedSite } from './wmn';

/**
 * The username sweep, in two phases.
 *
 * We search for several handles: the one they typed, one or two taken from
 * their email address, and a few built from their name. Most of those are
 * guesses, and sweeping seven hundred sites with a guess is both slow and
 * noisy — `jsmith` belongs to thousands of people, and to nobody in particular.
 *
 * So handles qualify before they get the full sweep:
 *
 *   1. Every handle is checked against ~39 mainstream sites. Cheap, and a real
 *      handle almost always turns up on at least one of them.
 *   2. Only handles that actually exist somewhere — plus the one they typed,
 *      which needs no proof — go on to the remaining ~670 sites.
 *
 * A handle that exists nowhere popular is almost certainly not a person's
 * handle, and dropping it saves 670 requests to other people's servers while
 * removing the results most likely to be somebody else entirely.
 */

const DEFAULT_CONCURRENCY = 48;
const PROBE_TIMEOUT_MS = 4000;

function concurrency(): number {
  const configured = Number(process.env.SCAN_USERNAME_CONCURRENCY);
  if (!Number.isFinite(configured) || configured < 1) return DEFAULT_CONCURRENCY;
  return Math.min(96, Math.floor(configured));
}

interface Hit {
  site: PreparedSite;
  handle: Handle;
  profileUrl?: string;
}

/**
 * Which handles have earned the long tail.
 *
 * A handle the person typed is theirs by assertion and always qualifies. A
 * handle we guessed has to show up somewhere mainstream first — otherwise it is
 * a string we invented, and any match on site 600 says more about how common
 * the string is than about the person.
 */
export function qualifyHandles(
  handles: readonly Handle[],
  handlesWithHits: ReadonlySet<string>,
): Handle[] {
  return handles.filter((handle) => !handle.derived || handlesWithHits.has(handle.value));
}

function buildFinding(hit: Hit, context: ScanContext): Finding {
  const { site, handle } = hit;

  // A match on a site the person has provably linked elsewhere is not a
  // coincidence.
  const corroborated = context.corroboration.confirmedHosts.has(site.host.replace(/^www\./, ''));

  const signals: SignalId[] = ['username_exact'];
  if (corroborated) signals.push('linked_account_verified');
  if (site.unreliable) signals.push('low_reliability_source');

  const origin = handle.source === 'name' ? 'your name' : 'your email address';

  return {
    id: `wmn:${site.name}:${handle.value}`,
    section: 'usernames',
    title: handle.derived ? `${site.name} — ${handle.value}` : `${site.name} account`,
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
      derivedHandle: handle.derived,
      handleSource: handle.source,
    }),
    evidence: hit.profileUrl
      ? { url: hit.profileUrl, label: `Open the ${site.name} profile` }
      : undefined,
    whyItMatters: handle.derived
      ? `We built "${handle.value}" from ${origin} and found an account here. Open it to see whether it is yours.`
      : corroborated
        ? 'You have publicly linked this site to your address elsewhere, so this is almost certainly yours.'
        : 'Usernames are not unique, so this may be someone else.',
    actions: [
      {
        type: 'review_account',
        label: 'Open the profile and check',
        detail: 'Confirm it is yours before acting — handles are not unique.',
        url: hit.profileUrl,
      },
      {
        type: 'review_privacy_settings',
        label: 'Make it private, or strip it back',
        detail: 'Most sites let you hide the profile and turn off search indexing.',
        url: hit.profileUrl,
      },
      closeAccountAction(site.name, site.host),
      legalErasureAction(site.name, hit.profileUrl),
    ],
    educationKey: 'username_reuse',
    flags: { sensitive: site.sensitive, lowReliability: site.unreliable },
  };
}

export const usernameSource: Source = {
  id: 'usernames',
  label: 'Public sites (username sweep)',
  kind: 'username',
  description:
    'Checks around 700 public sites — social, gaming, forums, shopping — for accounts using your handles.',
  homepage: 'https://github.com/WebBreacher/WhatsMyName',
  requires: ['username'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (context.handles.length === 0) {
      return { status: 'skipped', reason: 'No username to search for' };
    }

    // Hosts a dedicated adapter already covers in far more detail.
    const sites = prepareSites().filter((site) => !hasDedicatedSource(site.host));
    const qualifying = sites.filter((site) => site.tier === 1);
    const remaining = sites.filter((site) => site.tier !== 1);

    let completed = 0;
    let indeterminate = 0;
    let withheld = 0;
    let found = 0;
    /** Checks retired by dropping a handle, rather than by making the request. */
    let skipped = 0;

    // Fixed for the whole run, so the number on screen never moves backwards.
    // Work removed by dropping a handle counts towards it as `skipped`.
    const total = sites.length * context.handles.length;

    const options = {
      concurrency: concurrency(),
      timeoutMs: PROBE_TIMEOUT_MS,
      deadline: context.deadline,
      signal: context.signal,
    };

    const report = (hit: Hit): void => {
      // Sensitive categories can out somebody, so they are withheld unless the
      // person proved the address is theirs or explicitly asked for them.
      if (hit.site.sensitive && !context.emailVerified && !context.includeSensitive) {
        withheld += 1;
        return;
      }
      emit.finding(buildFinding(hit, context));
      found += 1;
    };

    const sweep = async (handles: readonly Handle[], list: PreparedSite[]): Promise<Hit[]> => {
      const hits: Hit[] = [];
      for (const handle of handles) {
        for await (const result of probeAll(list, handle.value, options)) {
          completed += 1;
          if (completed % 25 === 0) emit.progress(completed + skipped, total);
          if (result.verdict === 'indeterminate') indeterminate += 1;
          if (result.verdict !== 'found') continue;

          const hit: Hit = { site: result.site, handle, profileUrl: result.profileUrl };
          hits.push(hit);
          report(hit);
        }
      }
      return hits;
    };

    // --- Phase 1: does this handle exist anywhere mainstream? ---
    const qualifyingHits = await sweep(context.handles, qualifying);

    const handlesWithHits = new Set(qualifyingHits.map((hit) => hit.handle.value));
    const qualified = qualifyHandles(context.handles, handlesWithHits);
    const dropped = context.handles.length - qualified.length;

    skipped = remaining.length * dropped;
    emit.progress(completed + skipped, total);

    // --- Phase 2: the long tail, for handles worth it ---
    if (qualified.length > 0) await sweep(qualified, remaining);

    emit.progress(completed + skipped, total);

    const conclusive = completed - indeterminate;
    const droppedNote =
      dropped > 0
        ? ` ${dropped} guessed handle${dropped === 1 ? '' : 's'} existed nowhere mainstream and ${dropped === 1 ? 'was' : 'were'} dropped.`
        : '';

    if (completed + skipped < total) {
      return {
        status: 'partial',
        checked: conclusive,
        total,
        withheld,
        reason: `The scan ran out of time before every site was checked.${droppedNote}`,
      };
    }

    if (indeterminate > completed * 0.2) {
      return {
        status: 'partial',
        checked: conclusive,
        total,
        withheld,
        reason:
          `${indeterminate} of ${completed} checks got no usable answer — blocked, timed out, or the page changed.${droppedNote}`,
      };
    }

    return { status: 'ok', checked: found, withheld };
  },
};
