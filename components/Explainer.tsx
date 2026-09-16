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
    <div className="border-l border-rule pl-4">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group flex w-full items-baseline gap-2.5 py-1 text-left"
      >
        <span aria-hidden className="tag-accent">
          {open ? '−' : '+'}
        </span>
        <span className="text-sm text-muted group-hover:text-ink">{explainer.question}</span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="body"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="max-w-readable space-y-3 pb-2 pt-2">
              {explainer.answer.map((paragraph) => (
                <p key={paragraph.slice(0, 32)} className="text-sm leading-relaxed text-muted">
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
