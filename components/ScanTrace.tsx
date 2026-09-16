'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useRef } from 'react';

/**
 * The live investigation feed.
 *
 * A 709-site sweep takes tens of seconds, and a progress bar alone reads as a
 * stall. This shows the work actually happening: each source and each batch of
 * probes appears as a line the moment it lands. It is also honest — the lines
 * are real events from the stream, not a decorative fake terminal.
 *
 * The list is capped and the oldest lines fall off the top, so a long sweep
 * cannot grow the DOM without bound.
 */

export interface TraceLine {
  id: string;
  label: string;
  detail?: string;
  tone: 'run' | 'hit' | 'miss' | 'warn';
}

const TONE: Record<TraceLine['tone'], string> = {
  run: 'text-faint',
  hit: 'text-accent',
  miss: 'text-muted',
  warn: 'text-alarm',
};

const MARK: Record<TraceLine['tone'], string> = {
  run: '·',
  hit: '+',
  miss: '—',
  warn: '!',
};

export function ScanTrace({ lines }: { lines: TraceLine[] }) {
  const reduced = useReducedMotion();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: reduced ? 'auto' : 'smooth' });
  }, [lines, reduced]);

  return (
    <div className="rule pt-4">
      <p className="tag mb-3">Trace</p>
      {/*
        The feed scrolls under a fade rather than cutting a line in half, so a
        partially visible row reads as history scrolling away rather than as a
        clipping bug.
      */}
      <div
        className="max-h-56 overflow-hidden"
        style={{
          maskImage: 'linear-gradient(to bottom, transparent, #000 2.5rem)',
          WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 2.5rem)',
        }}
      >
        <ul className="space-y-1 font-mono text-xs">
          <AnimatePresence initial={false}>
            {lines.map((line) => (
              <motion.li
                key={line.id}
                layout={reduced ? false : 'position'}
                initial={reduced ? false : { opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
                className="flex items-baseline gap-2.5"
              >
                <span aria-hidden className={`w-2 shrink-0 ${TONE[line.tone]}`}>
                  {MARK[line.tone]}
                </span>
                <span className="truncate text-muted">{line.label}</span>
                {line.detail ? (
                  <span className={`ml-auto shrink-0 tabular ${TONE[line.tone]}`}>
                    {line.detail}
                  </span>
                ) : null}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
        <div ref={endRef} />
      </div>
      <p className="cursor mt-2 font-mono text-xs text-faint" aria-hidden />
    </div>
  );
}
