'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import type { RemovalOpportunity } from '@/lib/normalize/finding';
import { Explainer } from './Explainer';

const INITIAL_VISIBLE = 8;

/**
 * Removal opportunities — explicitly not detections.
 *
 * We cannot confirm somebody is listed on a people-search site without scraping
 * it, so this section never claims they are. The note says so in as many words,
 * because a list of broker names under a heading like "your data was found here"
 * would be a lie the layout told even if the prose did not.
 */
export function RemovalSection({ opportunities }: { opportunities: RemovalOpportunity[] }) {
  const [expanded, setExpanded] = useState(false);
  const reduced = useReducedMotion();
  if (opportunities.length === 0) return null;

  const visible = expanded ? opportunities : opportunities.slice(0, INITIAL_VISIBLE);

  return (
    <section className="space-y-3 pt-8">
      <header className="mb-3 flex items-center gap-2.5 px-1">
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Removal opportunities</h2>
        <span className="pill text-faint">{opportunities.length}</span>
      </header>

      <p className="glass p-4 text-[0.9375rem] leading-relaxed text-muted sm:p-5">
        <span className="font-medium text-ink">Not a detection.</span> Confirming a listing means
        searching a people-search site for a named person — the thing this tool exists to undo. These
        are brokers who hold data like yours, each with a working opt-out.
      </p>

      <div className="glass-strong space-y-3 p-5 sm:p-6">
        <p className="text-[1.0625rem] font-semibold text-ink">
          Start here if you live in California
        </p>
        <p className="text-[0.9375rem] leading-relaxed text-muted">
          One verified request legally forces every broker registered in California to delete what
          they hold — replacing hundreds of opt-out forms.
        </p>
        <a
          href="https://cppa.ca.gov/data_brokers/"
          target="_blank"
          rel="noopener noreferrer"
          className="btn-primary !px-5 !py-2.5 !text-[0.875rem]"
        >
          Open the official DROP platform →
        </a>
        <p className="text-[0.75rem] leading-relaxed text-faint">
          We link rather than submit — acting as your agent would mean holding your ID.
        </p>
        <Explainer educationKey="drop" />
      </div>

      <ul className="space-y-2">
        {visible.map((opportunity, index) => (
          <motion.li
            key={opportunity.id}
            layout={reduced ? false : 'position'}
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(index, 8) * 0.02 }}
            className="glass flex items-start justify-between gap-4 p-4 sm:p-5"
          >
            <div className="min-w-0">
              <p className="text-[1.0625rem] font-medium text-ink">{opportunity.brokerName}</p>
              <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">
                {opportunity.relevance}
              </p>
              {opportunity.collects.length > 0 ? (
                <p className="mt-1.5 text-[0.75rem] text-faint">
                  Registered as collecting: {opportunity.collects.join(', ')}
                </p>
              ) : null}
            </div>
            {opportunity.optOutUrl ? (
              <a
                href={opportunity.optOutUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-quiet shrink-0 whitespace-nowrap"
              >
                Remove →
              </a>
            ) : (
              <span className="pill shrink-0 text-faint">no link</span>
            )}
          </motion.li>
        ))}
      </ul>

      {opportunities.length > INITIAL_VISIBLE ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="btn-quiet">
          {expanded ? 'Show fewer' : `Show all ${opportunities.length}`}
        </button>
      ) : null}

      <Explainer educationKey="data_broker" />
    </section>
  );
}
