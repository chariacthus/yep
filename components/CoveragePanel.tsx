'use client';

import { useState } from 'react';
import type { CoverageEntry } from '@/lib/orchestrator';
import type { SourceStatus } from '@/lib/sources/types';

/**
 * What was checked, and what was not.
 *
 * This panel is the honesty of the product made visible. A scan that could not
 * reach four of its sources has not "found nothing" — it has not looked — and
 * saying so plainly matters more than a clean-looking report.
 */

const STATUS_LABELS: Record<SourceStatus, string> = {
  pending: 'Waiting',
  running: 'Checking…',
  ok: 'Checked',
  partial: 'Partly checked',
  failed: 'Could not check',
  not_configured: 'Not set up',
  rate_limited: 'Rate-limited',
  skipped: 'Not checked',
};

const STATUS_TONE: Record<SourceStatus, string> = {
  pending: 'text-faint',
  running: 'text-accent',
  ok: 'text-muted',
  partial: 'text-likely',
  failed: 'text-verified',
  not_configured: 'text-faint',
  rate_limited: 'text-likely',
  skipped: 'text-faint',
};

const INCOMPLETE: SourceStatus[] = ['partial', 'failed', 'not_configured', 'rate_limited', 'skipped'];

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
  const expanded = open || scanning;
  const incomplete = coverage.filter((entry) => INCOMPLETE.includes(entry.status));
  const checked = coverage.filter((entry) => entry.status === 'ok').length;
  const running = coverage.filter((entry) => entry.status === 'running').length;
  // "Done" during a scan means settled either way, not succeeded — a source
  // that failed has finished, and pretending otherwise stalls the counter.
  const settled = coverage.filter(
    (entry) => entry.status !== 'pending' && entry.status !== 'running',
  ).length;

  return (
    <section className="card">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={expanded}
        disabled={scanning}
        className="flex w-full items-center justify-between gap-3 p-4 text-left disabled:cursor-default"
      >
        <span>
          <span className="block text-sm font-medium text-ink">
            {scanning
              ? `Checking ${running} source${running === 1 ? '' : 's'}…`
              : `Checked ${checked} of ${coverage.length} sources`}
          </span>
          {scanning ? (
            <span className="mt-0.5 block text-sm text-muted">
              {settled} of {coverage.length} done
            </span>
          ) : incomplete.length > 0 ? (
            <span className="mt-0.5 block text-sm text-muted">
              {incomplete.length} could not be checked — see what that means
            </span>
          ) : (
            <span className="mt-0.5 block text-sm text-muted">Every source responded</span>
          )}
        </span>
        {!scanning ? (
          <span aria-hidden className="text-faint">
            {expanded ? '−' : '+'}
          </span>
        ) : null}
      </button>

      {expanded ? (
        <ul className="divide-y divide-line border-t border-line">
          {coverage.map((entry) => {
            const live = progress[entry.id];
            return (
              <li key={entry.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm text-ink">{entry.label}</p>
                  <p className="mt-0.5 text-sm text-muted">{entry.detail ?? entry.description}</p>
                  {entry.status === 'partial' && entry.checked !== undefined && entry.total ? (
                    <p className="mt-0.5 text-sm text-likely">
                      Reached {entry.checked} of {entry.total}. The rest are unknown, not clear.
                    </p>
                  ) : null}
                </div>
                <span className={`shrink-0 text-right text-xs ${STATUS_TONE[entry.status]}`}>
                  {live && entry.status === 'running' ? (
                    <>
                      <span className="tabular-nums">
                        {live.done} / {live.total}
                      </span>
                      <span
                        aria-hidden
                        className="mt-1 block h-1 w-24 overflow-hidden rounded-full bg-raised"
                      >
                        <span
                          className="block h-full bg-accent transition-[width] duration-300"
                          style={{ width: `${Math.round((live.done / Math.max(1, live.total)) * 100)}%` }}
                        />
                      </span>
                    </>
                  ) : (
                    STATUS_LABELS[entry.status]
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
