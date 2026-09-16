import { AsyncQueue } from './async-queue';
import { randomId } from './crypto';
import { logger } from './logger';
import type { Identity } from './identity';
import type { Finding, RemovalOpportunity } from './normalize/finding';
import { PRIMING_SOURCE_IDS, SOURCES } from './sources/registry';
import {
  hasRequiredInput,
  isConfigured,
  missingEnv,
  type Corroboration,
  type ScanContext,
  type Source,
  type SourceOutcome,
  type SourceStatus,
} from './sources/types';

/**
 * Runs a scan and streams what it finds.
 *
 * The orchestrator's job is honesty as much as concurrency. Every source
 * produces a coverage entry whatever happens to it — configured or not, run or
 * declined, succeeded, timed out, rate-limited or failed — and the report is
 * marked partial unless every applicable source completed. A quiet result from
 * a source that was never actually reached would be worse than no result at
 * all, because it reads as reassurance.
 */

export interface CoverageEntry {
  id: string;
  label: string;
  description: string;
  homepage?: string;
  status: SourceStatus;
  /** Plain-language reason, shown verbatim in "What we couldn't check". */
  detail?: string;
  /**
   * Why a skipped source was skipped. Declining a source reduces coverage;
   * a source that had no applicable input never could have run. Only the
   * first makes a scan partial.
   */
  because?: 'declined' | 'no_input';
  checked?: number;
  total?: number;
  /**
   * Results this source found but did not return, because they come from a
   * category where being listed is itself revealing and ownership of the
   * address was never proved. Counted so the report can say that results were
   * withheld, rather than quietly omitting them.
   */
  withheld?: number;
}

export type ScanEvent =
  | { type: 'scan_started'; scanId: string; sources: CoverageEntry[] }
  | { type: 'source_status'; id: string; status: SourceStatus; detail?: string }
  | { type: 'progress'; id: string; done: number; total: number }
  | { type: 'finding'; finding: Finding }
  | { type: 'removal_opportunity'; opportunity: RemovalOpportunity }
  | {
      type: 'scan_complete';
      coverage: CoverageEntry[];
      partial: boolean;
      /** True when identifiers were asserted rather than proved. */
      ownershipAsserted: boolean;
      counts: { findings: number; removalOpportunities: number; withheld: number };
    };

export interface ScanOptions {
  identity: Identity;
  emailVerified: boolean;
  declinedSources: ReadonlySet<string>;
  budgetMs: number;
}

const DEFAULT_BUDGET_MS = 240_000;

export function scanBudgetMs(): number {
  const configured = Number(process.env.SCAN_BUDGET_MS);
  if (!Number.isFinite(configured) || configured < 5000) return DEFAULT_BUDGET_MS;
  return configured;
}

function describeOutcome(outcome: SourceOutcome): {
  status: SourceStatus;
  detail?: string;
  because?: 'declined' | 'no_input';
} {
  switch (outcome.status) {
    case 'ok':
      return { status: 'ok' };
    case 'partial':
      return { status: 'partial', detail: outcome.reason };
    case 'failed':
      return { status: 'failed', detail: outcome.reason };
    case 'not_configured':
      return {
        status: 'not_configured',
        detail: `Not set up on this deployment (missing ${outcome.missing.join(', ')})`,
      };
    case 'rate_limited':
      return {
        status: 'rate_limited',
        detail: 'The provider is rate-limiting us, so this was not checked',
      };
    case 'skipped':
      return { status: 'skipped', detail: outcome.reason, because: outcome.because };
  }
}

/**
 * Decides, before running anything, why a source will not run. Returning this
 * up front means the UI can show the full source list with accurate statuses
 * from the first frame rather than filling in as it goes.
 */
function precheck(source: Source, options: ScanOptions): SourceOutcome | null {
  if (options.declinedSources.has(source.id)) {
    return {
      status: 'skipped',
      reason: 'You chose not to share your details with this source',
      because: 'declined',
    };
  }
  if (!isConfigured(source)) {
    return { status: 'not_configured', missing: missingEnv(source) };
  }
  if (!hasRequiredInput(source, options.identity)) {
    const needed = source.requires.join(' and ');
    return {
      status: 'skipped',
      reason: `Needs a ${needed}, which was not provided`,
      because: 'no_input',
    };
  }
  return null;
}

function toCoverage(
  source: Source,
  status: SourceStatus,
  detail?: string,
  because?: CoverageEntry['because'],
): CoverageEntry {
  return {
    id: source.id,
    label: source.label,
    description: source.description,
    homepage: source.homepage,
    status,
    detail,
    because,
  };
}

export async function* runScan(options: ScanOptions): AsyncGenerator<ScanEvent> {
  const scanId = randomId(8);
  const started = Date.now();
  const deadline = started + options.budgetMs;
  const controller = new AbortController();

  const corroboration: Corroboration = { confirmedHosts: new Set() };
  const coverage = new Map<string, CoverageEntry>();
  const prechecked = new Map<string, SourceOutcome>();

  for (const source of SOURCES) {
    const skip = precheck(source, options);
    if (skip) {
      const described = describeOutcome(skip);
      coverage.set(
        source.id,
        toCoverage(source, described.status, described.detail, described.because),
      );
      prechecked.set(source.id, skip);
    } else {
      coverage.set(source.id, toCoverage(source, 'pending'));
    }
  }

  yield { type: 'scan_started', scanId, sources: [...coverage.values()] };

  const runnable = SOURCES.filter((source) => !prechecked.has(source.id));

  // Events are pushed onto a queue and drained as they arrive, so a long sweep
  // streams its results and its progress counter live instead of appearing all
  // at once when it finishes.
  const queue = new AsyncQueue<ScanEvent>();

  let findingCount = 0;
  let opportunityCount = 0;
  let withheldCount = 0;

  const runSource = async (source: Source): Promise<void> => {
    const context: ScanContext = {
      identity: options.identity,
      emailVerified: options.emailVerified,
      declinedSources: options.declinedSources,
      corroboration,
      deadline,
      signal: controller.signal,
    };

    const emit = {
      finding: (finding: Finding) => {
        findingCount += 1;
        queue.push({ type: 'finding', finding });
      },
      removalOpportunity: (opportunity: RemovalOpportunity) => {
        opportunityCount += 1;
        queue.push({ type: 'removal_opportunity', opportunity });
      },
      progress: (done: number, total: number) =>
        queue.push({ type: 'progress', id: source.id, done, total }),
    };

    queue.push({ type: 'source_status', id: source.id, status: 'running' });

    const startedAt = Date.now();
    let outcome: SourceOutcome;
    try {
      outcome = await source.run(context, emit);
      logger.debug('Source finished', {
        scanId,
        sourceId: source.id,
        status: outcome.status,
        durationMs: Date.now() - startedAt,
      });
    } catch (error) {
      // A source is contractually not supposed to throw. If one does, it
      // degrades the report rather than ending the scan.
      logger.error('Source threw instead of returning an outcome', {
        scanId,
        sourceId: source.id,
        error,
      });
      outcome = { status: 'failed', reason: 'The source failed unexpectedly' };
    }

    const described = describeOutcome(outcome);
    const entry = toCoverage(source, described.status, described.detail, described.because);
    if (outcome.status === 'partial') {
      entry.checked = outcome.checked;
      entry.total = outcome.total;
      entry.withheld = outcome.withheld;
    } else if (outcome.status === 'ok') {
      entry.checked = outcome.checked;
      entry.withheld = outcome.withheld;
    }
    if (entry.withheld) withheldCount += entry.withheld;
    coverage.set(source.id, entry);

    queue.push({
      type: 'source_status',
      id: source.id,
      status: described.status,
      detail: described.detail,
    });
  };

  // Priming sources run to completion first: what they confirm is used to score
  // results from everything that follows.
  const priming = runnable.filter((source) => PRIMING_SOURCE_IDS.includes(source.id));
  const rest = runnable.filter((source) => !PRIMING_SOURCE_IDS.includes(source.id));

  // A hard stop, so a source that ignores the deadline cannot hang the request.
  const budgetTimer = setTimeout(() => controller.abort(), options.budgetMs);

  const work = (async () => {
    try {
      await Promise.allSettled(priming.map(runSource));
      await Promise.allSettled(rest.map(runSource));
    } finally {
      clearTimeout(budgetTimer);
      queue.close();
    }
  })();

  for await (const event of queue.drain()) {
    yield event;
  }
  await work;

  controller.abort();

  const entries = [...coverage.values()];

  // "Partial" means something that could have been checked was not. A source
  // with no applicable input — no username given, say — could never have run,
  // so it does not count. An unconfigured, failed, rate-limited or declined one
  // does: in every one of those cases there is a gap the person should know
  // about before reading the report as an all-clear.
  const partial = entries.some((entry) => {
    if (entry.status === 'skipped') return entry.because === 'declined';
    return (['partial', 'failed', 'rate_limited', 'not_configured'] as SourceStatus[]).includes(
      entry.status,
    );
  });

  logger.info('Scan complete', {
    scanId,
    durationMs: Date.now() - started,
    findings: findingCount,
    withheld: withheldCount,
    partial,
  });

  yield {
    type: 'scan_complete',
    coverage: entries,
    partial,
    ownershipAsserted: !options.emailVerified,
    counts: {
      findings: findingCount,
      removalOpportunities: opportunityCount,
      withheld: withheldCount,
    },
  };
}
