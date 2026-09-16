'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CoverageEntry } from '@/lib/orchestrator';
import type { SourceStatus } from '@/lib/sources/types';
import { Counter } from './Counter';

/**
 * The scanning state, as its own screen rather than a spinner over the report.
 *
 * A scan reaches seven hundred sites and a dozen services, and the honest thing
 * to show while that happens is the work itself: which check is running, which
 * have answered, and how far through the sweep is. A bare progress bar hides all
 * of that and reads as a stall the moment it pauses.
 *
 * Findings still stream in underneath, so nothing here delays reading them.
 */

const DONE: SourceStatus[] = ['ok', 'partial', 'failed', 'not_configured', 'rate_limited', 'skipped'];

const tileIn = {
  hidden: { opacity: 0, y: 10, scale: 0.96 },
  shown: { opacity: 1, y: 0, scale: 1, transition: { type: 'spring' as const, stiffness: 420, damping: 30 } },
};

/**
 * The progress ring.
 *
 * Two arcs, not one: a solid arc for real progress, and a faint one that keeps
 * sweeping regardless. The sweeping arc is what stops a stalled percentage —
 * which happens whenever a slow site is holding the batch up — from reading as
 * a frozen page.
 */
function Ring({ progress }: { progress: number }) {
  const reduced = useReducedMotion();
  const radius = 54;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg viewBox="0 0 128 128" className="h-32 w-32 -rotate-90" aria-hidden>
      <defs>
        <linearGradient id="ring-arc" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="rgb(var(--accent-soft))" />
          <stop offset="100%" stopColor="rgb(var(--accent))" />
        </linearGradient>
      </defs>

      <circle cx="64" cy="64" r={radius} fill="none" strokeWidth="6" className="stroke-glass/10" />

      {!reduced ? (
        <motion.circle
          cx="64"
          cy="64"
          r={radius}
          fill="none"
          strokeWidth="6"
          strokeLinecap="round"
          className="stroke-accent/25"
          style={{
            strokeDasharray: `${circumference * 0.14} ${circumference}`,
            transformOrigin: '64px 64px',
          }}
          animate={{ rotate: 360 }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'linear' }}
        />
      ) : null}

      <motion.circle
        cx="64"
        cy="64"
        r={radius}
        fill="none"
        strokeWidth="6"
        strokeLinecap="round"
        stroke="url(#ring-arc)"
        style={{ strokeDasharray: circumference }}
        initial={false}
        animate={{ strokeDashoffset: circumference * (1 - progress) }}
        transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 120, damping: 26 }}
      />
    </svg>
  );
}

export function ScanningScreen({
  coverage,
  progress,
  findingCount,
}: {
  coverage: CoverageEntry[];
  progress: Record<string, { done: number; total: number }>;
  findingCount: number;
}) {
  const reduced = useReducedMotion();

  const settled = coverage.filter((entry) => DONE.includes(entry.status)).length;
  const running = coverage.filter((entry) => entry.status === 'running');
  const sweep = progress.usernames;

  // Sources and the site sweep are weighted together, so the ring does not sit
  // at 90% for a minute while the sweep grinds through the long tail.
  const sourceShare = coverage.length > 0 ? settled / coverage.length : 0;
  const sweepShare = sweep && sweep.total > 0 ? sweep.done / sweep.total : null;
  const overall = sweepShare === null ? sourceShare : sourceShare * 0.4 + sweepShare * 0.6;

  const active = running[0];

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center py-12 text-center">
      <div className="relative">
        <Ring progress={Math.min(1, Math.max(0, overall))} />
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-[1.75rem] font-semibold leading-none tracking-tight">
            <Counter value={Math.round(overall * 100)} />
            <span className="text-muted">%</span>
          </span>
        </div>
        {!reduced ? (
          <motion.div
            aria-hidden
            className="absolute inset-0 rounded-full"
            style={{ boxShadow: '0 0 60px 0 rgb(var(--accent) / 0.35)' }}
            animate={{ opacity: [0.35, 0.7, 0.35] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          />
        ) : null}
      </div>

      <h1 className="mt-7 text-[1.75rem] font-semibold tracking-[-0.03em]">Scanning</h1>

      <div className="mt-2 h-6">
        <AnimatePresence mode="wait">
          <motion.p
            key={active?.id ?? 'idle'}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? undefined : { opacity: 0, y: -6 }}
            transition={{ duration: 0.22 }}
            className="text-[0.9375rem] text-muted"
          >
            {/* The heading already says what is happening, so the label stands
                on its own — "Checking Public sites (username sweep)…" reads
                badly once a source name is capitalised. */}
            {active ? `${active.label}…` : 'Bringing the results together…'}
          </motion.p>
        </AnimatePresence>
      </div>

      <motion.dl
        className="mt-8 flex flex-wrap items-stretch justify-center gap-2"
        initial={reduced ? false : 'hidden'}
        animate="shown"
        variants={{ shown: { transition: { staggerChildren: 0.07 } } }}
      >
        <motion.div variants={tileIn} className="glass min-w-[7rem] px-4 py-3">
          <dd className="text-[1.5rem] font-semibold leading-none">
            <Counter value={settled} />
            <span className="text-faint">/{coverage.length}</span>
          </dd>
          <dt className="mt-1.5 text-[0.75rem] text-faint">Services</dt>
        </motion.div>

        {sweep ? (
          <motion.div variants={tileIn} className="glass min-w-[7rem] px-4 py-3">
            <dd className="text-[1.5rem] font-semibold leading-none">
              <Counter value={sweep.done} />
              <span className="text-faint">/{sweep.total}</span>
            </dd>
            <dt className="mt-1.5 text-[0.75rem] text-faint">Sites</dt>
          </motion.div>
        ) : null}

        <motion.div variants={tileIn} className="glass min-w-[7rem] px-4 py-3">
          <dd
            className={`text-[1.5rem] font-semibold leading-none ${
              findingCount > 0 ? 'text-accent-soft' : ''
            }`}
          >
            <Counter value={findingCount} />
          </dd>
          <dt className="mt-1.5 text-[0.75rem] text-faint">Found</dt>
        </motion.div>
      </motion.dl>

      <p className="mt-8 max-w-xs text-[0.8125rem] leading-relaxed text-faint">
        Results appear as they arrive.
      </p>
    </div>
  );
}
