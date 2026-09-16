'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { CoverageEntry } from '@/lib/orchestrator';
import type { SourceStatus } from '@/lib/sources/types';
import { Counter } from './Counter';

/**
 * What was checked, and what was not.
 *
 * This is the honesty of the product made visible. A scan that could not reach
 * four of its sources has not "found nothing" — it has not looked — and saying
 * so plainly matters more than a clean-looking report.
 */

const STATUS_LABELS: Record<SourceStatus, string> = {
  pending: 'queued',
  running: 'running',
  ok: 'checked',
  partial: 'partial',
  failed: 'unreachable',
  not_configured: 'not set up',
  rate_limited: 'rate-limited',
  skipped: 'not checked',
};

const STATUS_TONE: Record<SourceStatus, string> = {
  pending: 'text-faint/60',
  running: 'text-accent',
  ok: 'text-muted',
  partial: 'text-alarm',
  failed: 'text-alarm',
  not_configured: 'text-faint',
  rate_limited: 'text-alarm',
  skipped: 'text-faint',
};

const INCOMPLETE: SourceStatus[] = ['partial', 'failed', 'rate_limited', 'not_configured'];

export function CoveragePanel({
  coverage,
  progress,
  scanning = false,
}: {
  coverage: CoverageEntry[];
  progress: Record<string, { done: number; total: number }>;
  /** While scanning, the list stays open: watching the work is the point. */
  scanning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  const expanded = open || scanning;
  const incomplete = coverage.filter((entry) => INCOMPLETE.includes(entry.status));
  const checked = coverage.filter((entry) => entry.status === 'ok').length;
  const running = coverage.filter((entry) => entry.status === 'running').length;
  // "Done" during a scan means settled either way, not succeeded — a source that
  // failed has finished, and pretending otherwise stalls the counter.
  const settled = coverage.filter(
    (entry) => entry.status !== 'pending' && entry.status !== 'running',
  ).length;

  return (
    <section className="rule">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        disabled={scanning}
        className="flex w-full items-baseline justify-between gap-4 py-4 text-left disabled:cursor-default"
      >
        <span className="tag">
          {scanning ? (
            <>
              Checking {running} source{running === 1 ? '' : 's'}
            </>
          ) : (
            'Coverage'
          )}
        </span>
        <span className="flex items-baseline gap-3">
          <span className="font-mono text-xs text-muted">
            <Counter value={scanning ? settled : checked} className="text-ink" /> / {coverage.length}
            {scanning ? ' done' : ' checked'}
          </span>
          {!scanning && incomplete.length > 0 ? (
            <span className="font-mono text-xs text-alarm">{incomplete.length} not checked</span>
          ) : null}
          {!scanning ? (
            <span aria-hidden className="tag">
              {expanded ? '−' : '+'}
            </span>
          ) : null}
        </span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="list"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ul className="border-t border-rule/60 pb-4">
              {coverage.map((entry) => {
                const live = progress[entry.id];
                const isRunning = entry.status === 'running';

                return (
                  <motion.li
                    key={entry.id}
                    layout={reduced ? false : 'position'}
                    className="grid grid-cols-[1fr_auto] items-baseline gap-4 border-b border-rule/40 py-2.5 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{entry.label}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-faint">
                        {entry.detail ?? entry.description}
                      </p>
                      {entry.status === 'partial' && entry.checked !== undefined && entry.total ? (
                        <p className="mt-0.5 font-mono text-xs text-alarm">
                          reached {entry.checked} of {entry.total} — the rest are unknown, not clear
                        </p>
                      ) : null}
                      {entry.withheld ? (
                        <p className="mt-0.5 font-mono text-xs text-alarm">
                          {entry.withheld} result{entry.withheld === 1 ? '' : 's'} withheld from a
                          sensitive category
                        </p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-right">
                      {live && isRunning ? (
                        <>
                          <span className="font-mono text-xs text-accent">
                            <Counter value={live.done} /> / {live.total}
                          </span>
                          <span
                            aria-hidden
                            className="mt-1 block h-px w-24 overflow-hidden bg-rule"
                          >
                            <motion.span
                              className="block h-full bg-accent"
                              initial={false}
                              animate={{
                                width: `${Math.round((live.done / Math.max(1, live.total)) * 100)}%`,
                              }}
                              transition={{ duration: 0.4, ease: 'easeOut' }}
                            />
                          </span>
                        </>
                      ) : (
                        <span className={`tag ${STATUS_TONE[entry.status]}`}>
                          {STATUS_LABELS[entry.status]}
                          {isRunning ? <span className="ml-1 animate-pulse">●</span> : null}
                        </span>
                      )}
                    </div>
                  </motion.li>
                );
              })}
            </ul>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
