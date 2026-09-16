'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { explainerFor } from '@/lib/education/content';

/**
 * A collapsed explanation, shown only where the scan made it relevant.
 *
 * This is the whole educational model: somebody who has never heard the phrase
 * "data breach" can find out at the moment it matters to them, and somebody who
 * already knows never has to look at it.
 */
export function Explainer({ educationKey }: { educationKey: string }) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();
  const explainer = explainerFor(educationKey);
  if (!explainer) return null;

  return (
    <div className="well overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="text-[0.9375rem] text-ink">{explainer.question}</span>
        <motion.svg
          aria-hidden
          viewBox="0 0 7 12"
          fill="none"
          className="chevron text-accent-soft"
          animate={{ rotate: open ? 90 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 30 }}
        >
          <path
            d="M1 1l5 5-5 5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-3 px-4 pb-4">
              {explainer.answer.map((paragraph) => (
                <p
                  key={paragraph.slice(0, 32)}
                  className="text-[0.9375rem] leading-relaxed text-muted"
                >
                  {paragraph}
                </p>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
