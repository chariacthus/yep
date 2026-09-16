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
    <section className="space-y-6 pt-10">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="display text-2xl">Removal opportunities</h2>
        <span className="tag">{opportunities.length} brokers</span>
      </header>

      <p className="max-w-readable border-l-2 border-accent pl-4 text-sm leading-relaxed text-muted">
        <span className="text-ink">This is not a detection.</span> We have not checked whether you
        are listed on these sites, and we will not — confirming a listing means searching a
        people-search site for a named person, which is exactly the thing this tool exists to help
        you undo. These are brokers known to compile records of the kind your scan surfaced, with a
        working way to opt out of each.
      </p>

      <div className="rule max-w-readable space-y-3 py-6">
        <p className="tag-accent">Start here if you live in California</p>
        <p className="text-sm leading-relaxed text-muted">
          California&apos;s DROP platform lets you submit one verified request that legally requires
          every data broker registered in the state to delete what they hold about you, and to keep
          doing so. It replaces hundreds of individual opt-out forms with a single request.
        </p>
        <a
          href="https://cppa.ca.gov/data_brokers/"
          target="_blank"
          rel="noopener noreferrer"
          className="tag-accent inline-block hover:underline"
        >
          Open the official DROP platform →
        </a>
        <p className="font-mono text-[0.6875rem] leading-relaxed text-faint">
          We link rather than submitting for you: there is no third-party API for DROP, and acting
          as your agent would mean holding your identity documents.
        </p>
        <Explainer educationKey="drop" />
      </div>

      <ul>
        {visible.map((opportunity, index) => (
          <motion.li
            key={opportunity.id}
            layout={reduced ? false : 'position'}
            initial={reduced ? false : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.015 }}
            className="rule grid grid-cols-[2.5rem_1fr_auto] items-start gap-3 py-4 sm:gap-5"
          >
            <span className="index pt-1">{String(index + 1).padStart(3, '0')}</span>
            <div className="min-w-0">
              <p className="text-[0.9375rem] text-ink">{opportunity.brokerName}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{opportunity.relevance}</p>
              {opportunity.collects.length > 0 ? (
                <p className="mt-1 font-mono text-[0.6875rem] text-faint">
                  registered as collecting: {opportunity.collects.join(', ')}
                </p>
              ) : null}
            </div>
            {opportunity.optOutUrl ? (
              <a
                href={opportunity.optOutUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="tag-accent shrink-0 pt-1 hover:underline"
              >
                Request removal →
              </a>
            ) : (
              <span className="tag shrink-0 pt-1">no direct link</span>
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
