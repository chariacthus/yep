'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { CoverageEntry } from '@/lib/orchestrator';
import type { SourceStatus } from '@/lib/sources/types';
import { Counter } from './Counter';

/**
 * What was checked, and what was not.
 *
 * This panel is the honesty of the product made visible. A scan that could not
 * reach four of its sources has not "found nothing" — it has not looked — and
 * saying so plainly matters more than a clean-looking report.
 */

const STATUS_LABELS: Record<SourceStatus, string> = {
  pending: 'Queued',
  running: 'Checking',
  ok: 'Checked',
  partial: 'Partial',
  failed: 'Unreachable',
  not_configured: 'Not set up',
  rate_limited: 'Rate-limited',
  skipped: 'Not checked',
};

const STATUS_TONE: Record<SourceStatus, string> = {
  pending: 'bg-glass/[0.06] text-faint',
  running: 'bg-accent/18 text-accent-soft',
  ok: 'bg-good/15 text-good',
  partial: 'bg-warn/15 text-warn',
  failed: 'bg-alarm/15 text-alarm',
  not_configured: 'bg-glass/[0.06] text-faint',
  rate_limited: 'bg-warn/15 text-warn',
  skipped: 'bg-glass/[0.06] text-faint',
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

  const expanded = open;
  const incomplete = coverage.filter((entry) => INCOMPLETE.includes(entry.status));
  const checked = coverage.filter((entry) => entry.status === 'ok').length;
  const running = coverage.filter((entry) => entry.status === 'running').length;
  // "Done" during a scan means settled either way, not succeeded — a source that
  // failed has finished, and pretending otherwise stalls the counter.
  const settled = coverage.filter(
    (entry) => entry.status !== 'pending' && entry.status !== 'running',
  ).length;

  return (
    <section className="glass overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-4 p-4 text-left sm:p-5"
      >
        <span className="min-w-0">
          <span className="block text-[1.0625rem] font-medium text-ink">
            {scanning ? `Checking ${running} source${running === 1 ? '' : 's'}` : 'Coverage'}
          </span>
          <span className="mt-1 block text-[0.8125rem] text-faint">
            <Counter value={scanning ? settled : checked} /> of {coverage.length} sources{' '}
            {scanning ? 'done' : 'checked'}
            {!scanning && incomplete.length > 0 ? ` · ${incomplete.length} not checked` : ''}
          </span>
        </span>

        <motion.span
          aria-hidden
          animate={{ rotate: expanded ? 45 : 0 }}
          transition={{ type: 'spring', stiffness: 420, damping: 28 }}
          className="shrink-0 text-lg leading-none text-faint"
        >
          +
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {expanded ? (
          <motion.div
            key="list"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <ul className="divide-hair border-t border-glass/[0.07]">
              {coverage.map((entry) => {
                const live = progress[entry.id];
                const isRunning = entry.status === 'running';

                return (
                  <motion.li
                    key={entry.id}
                    layout={reduced ? false : 'position'}
                    className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5"
                  >
                    <div className="min-w-0">
                      <p className="text-[0.9375rem] text-ink">{entry.label}</p>
                      <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-faint">
                        {entry.detail ?? entry.description}
                      </p>
                      {entry.status === 'partial' && entry.checked !== undefined && entry.total ? (
                        <p className="mt-1 text-[0.8125rem] text-warn">
                          reached {entry.checked} of {entry.total} — the rest are unknown, not clear
                        </p>
                      ) : null}
                      {entry.withheld ? (
                        <p className="mt-1 text-[0.8125rem] text-warn">
                          {entry.withheld} result{entry.withheld === 1 ? '' : 's'} withheld from a
                          sensitive category
                        </p>
                      ) : null}
                    </div>

                    <div className="shrink-0 text-right">
                      {live && isRunning ? (
                        <>
                          <span className="mono-xs text-accent-soft">
                            <Counter value={live.done} /> / {live.total}
                          </span>
                          <span
                            aria-hidden
                            className="mt-1.5 block h-1 w-24 overflow-hidden rounded-full bg-glass/10"
                          >
                            <motion.span
                              className="block h-full rounded-full bg-accent"
                              initial={false}
                              animate={{
                                width: `${Math.round((live.done / Math.max(1, live.total)) * 100)}%`,
                              }}
                              transition={{ duration: 0.45, ease: 'easeOut' }}
                            />
                          </span>
                        </>
                      ) : (
                        <span className={`pill ${STATUS_TONE[entry.status]}`}>
                          {isRunning ? (
                            <span
                              aria-hidden
                              className="h-1.5 w-1.5 animate-pulse rounded-full bg-current"
                            />
                          ) : null}
                          {STATUS_LABELS[entry.status]}
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
