'use client';

import { useState } from 'react';
import { explainerFor } from '@/lib/education/content';

/**
 * A collapsed explanation, shown only where the scan made it relevant.
 *
 * This is the whole educational model: somebody who does not know what a data
 * breach is can find out at the moment it matters to them, and somebody who
 * does never has to look at it.
 */
export function Explainer({ educationKey }: { educationKey: string }) {
  const [open, setOpen] = useState(false);
  const explainer = explainerFor(educationKey);
  if (!explainer) return null;

  return (
    <div className="rounded-lg border border-line bg-raised/60">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm font-medium text-ink"
      >
        <span>{explainer.question}</span>
        <span aria-hidden className="text-faint">
          {open ? '−' : '+'}
        </span>
      </button>
      {open ? (
        <div className="space-y-2.5 border-t border-line px-3 py-3">
          {explainer.answer.map((paragraph) => (
            <p key={paragraph.slice(0, 32)} className="text-sm leading-relaxed text-muted">
              {paragraph}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
