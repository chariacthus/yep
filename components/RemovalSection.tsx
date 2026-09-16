'use client';

import { useState } from 'react';
import type { RemovalOpportunity } from '@/lib/normalize/finding';
import { Explainer } from './Explainer';

const INITIAL_VISIBLE = 8;

/**
 * Removal opportunities — explicitly not detections.
 *
 * We cannot confirm somebody is listed on a people-search site without scraping
 * it, so this section never claims they are. The banner says so in as many
 * words, because a list of brokers under a heading like "your data was found
 * here" would be a lie the layout told even if the text did not.
 */
export function RemovalSection({ opportunities }: { opportunities: RemovalOpportunity[] }) {
  const [expanded, setExpanded] = useState(false);
  if (opportunities.length === 0) return null;

  const visible = expanded ? opportunities : opportunities.slice(0, INITIAL_VISIBLE);

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold tracking-tight">Removal opportunities</h2>
        <p className="mt-1 text-sm text-muted">
          {opportunities.length} data brokers with an opt-out process.
        </p>
      </div>

      <div className="rounded-lg border border-line bg-raised px-4 py-3">
        <p className="text-sm font-medium text-ink">This is not a detection.</p>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          We have not checked whether you are listed on these sites, and we will not — confirming a
          listing means searching a people-search site for a named person, which is exactly the
          thing this tool exists to help you undo. These are brokers known to compile records of the
          kind your scan surfaced, with a working way to opt out of each.
        </p>
      </div>

      <div className="card space-y-3 p-4">
        <p className="text-sm font-medium text-ink">Start here if you live in California</p>
        <p className="text-sm leading-relaxed text-muted">
          California&apos;s DROP platform lets you submit one verified request that legally requires
          every data broker registered in the state to delete what they hold about you, and to keep
          doing so. It replaces hundreds of individual opt-out forms with a single request.
        </p>
        <a
          href="https://cppa.ca.gov/data_brokers/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-accent hover:underline"
        >
          Open the official DROP platform →
        </a>
        <p className="text-xs text-faint">
          We link to it rather than submitting on your behalf: there is no third-party API for DROP,
          and acting as your agent would mean holding your identity documents.
        </p>
        <Explainer educationKey="drop" />
      </div>

      <ul className="space-y-2">
        {visible.map((opportunity) => (
          <li key={opportunity.id} className="card flex items-start justify-between gap-4 p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{opportunity.brokerName}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{opportunity.relevance}</p>
              {opportunity.collects.length > 0 ? (
                <p className="mt-1 text-xs text-faint">
                  Registered as collecting: {opportunity.collects.join(', ')}
                </p>
              ) : null}
            </div>
            {opportunity.optOutUrl ? (
              <a
                href={opportunity.optOutUrl}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="btn-quiet shrink-0"
              >
                Request removal →
              </a>
            ) : (
              <span className="shrink-0 text-xs text-faint">No direct link known</span>
            )}
          </li>
        ))}
      </ul>

      {opportunities.length > INITIAL_VISIBLE ? (
        <button type="button" onClick={() => setExpanded((value) => !value)} className="btn-quiet">
          {expanded ? 'Show fewer' : `Show all ${opportunities.length} brokers`}
        </button>
      ) : null}

      <Explainer educationKey="data_broker" />
    </section>
  );
}
