'use client';

import { useState } from 'react';
import { DATA_TYPE_LABELS, type Finding } from '@/lib/normalize/finding';
import { ConfidenceBadge, ConfidenceReasons } from './ConfidenceBadge';
import { Explainer } from './Explainer';

export type Verdict = 'confirmed' | 'rejected' | undefined;

function formatWhen(finding: Finding): string | null {
  const when = finding.occurredAt;
  if (!when) return null;
  if (when.precision === 'day' && when.date) {
    return new Date(when.date).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  }
  if (when.year) return String(when.year);
  return null;
}

export function FindingCard({
  finding,
  verdict,
  onVerdict,
}: {
  finding: Finding;
  verdict: Verdict;
  onVerdict: (verdict: Verdict) => void;
}) {
  const [open, setOpen] = useState(false);
  // Sensitive findings stay covered until the person chooses to look. Somebody
  // may be reading this on a train.
  const [revealed, setRevealed] = useState(!finding.flags?.sensitive);

  const when = formatWhen(finding);
  const includesCredentials = finding.dataTypes.includes('password_credential');

  if (!revealed) {
    return (
      <li className="card p-4">
        <p className="text-sm font-medium text-ink">A result from a sensitive category</p>
        <p className="mt-1 text-sm text-muted">
          This finding is from a category — such as adult, dating, political or health — where
          simply being listed can be revealing. It stays hidden until you ask for it.
        </p>
        <button type="button" onClick={() => setRevealed(true)} className="btn-quiet mt-3">
          Show this result
        </button>
      </li>
    );
  }

  return (
    <li className={`card overflow-hidden ${verdict === 'rejected' ? 'opacity-55' : ''}`}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{finding.title}</span>
          <span className="mt-1 block text-sm text-muted">
            {finding.origin.name}
            {when ? ` · ${when}` : ''}
            {finding.flags?.unverifiedBreach ? ' · unconfirmed breach' : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <ConfidenceBadge confidence={finding.confidence} />
          <span aria-hidden className="text-faint">
            {open ? '−' : '+'}
          </span>
        </span>
      </button>

      {open ? (
        <div className="space-y-5 border-t border-line p-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-faint">Where</dt>
              <dd className="mt-1 text-sm text-ink">
                {finding.origin.name}
                {finding.origin.domain ? (
                  <span className="text-muted"> ({finding.origin.domain})</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-faint">When</dt>
              <dd className="mt-1 text-sm text-ink">{when ?? 'Not known'}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-faint">
                What was exposed
              </dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {finding.dataTypes.map((type) => (
                  <span
                    key={type}
                    className="rounded-md border border-line px-2 py-0.5 text-xs text-muted"
                  >
                    {DATA_TYPE_LABELS[type]}
                  </span>
                ))}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-faint">Found by</dt>
              <dd className="mt-1 text-sm text-muted">{finding.provider.label}</dd>
            </div>
          </dl>

          {includesCredentials ? (
            <p className="rounded-lg border border-line bg-raised px-3 py-2.5 text-sm text-muted">
              Password credentials were included in this breach. This tool never retrieves or shows
              the credential itself — only the fact that it was part of the data.
            </p>
          ) : null}

          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-faint">
              Why this matters
            </p>
            <p className="mt-1.5 text-sm leading-relaxed text-muted">{finding.whyItMatters}</p>
          </div>

          <ConfidenceReasons confidence={finding.confidence} />

          {finding.actions.length > 0 ? (
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-faint">What to do</p>
              <ul className="mt-2 space-y-3">
                {finding.actions.map((action) => (
                  <li key={action.label}>
                    <p className="text-sm font-medium text-ink">{action.label}</p>
                    <p className="mt-0.5 text-sm text-muted">{action.detail}</p>
                    {action.url ? (
                      <a
                        href={action.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="mt-1 inline-block text-sm font-medium text-accent hover:underline"
                      >
                        {action.type === 'opt_out' ? 'Request removal →' : 'Open →'}
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {finding.evidence?.url ? (
            <a
              href={finding.evidence.url}
              target="_blank"
              rel="noopener noreferrer nofollow"
              className="inline-block text-sm font-medium text-accent hover:underline"
            >
              {finding.evidence.label ?? 'View the source'} →
            </a>
          ) : null}

          <Explainer educationKey={finding.educationKey} />

          {finding.confidence.level !== 'verified' || verdict ? (
            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
              <span className="text-sm text-muted">Is this you?</span>
              <button
                type="button"
                onClick={() => onVerdict(verdict === 'confirmed' ? undefined : 'confirmed')}
                aria-pressed={verdict === 'confirmed'}
                className={`btn-quiet ${verdict === 'confirmed' ? 'border-accent text-accent' : ''}`}
              >
                Yes
              </button>
              <button
                type="button"
                onClick={() => onVerdict(verdict === 'rejected' ? undefined : 'rejected')}
                aria-pressed={verdict === 'rejected'}
                className={`btn-quiet ${verdict === 'rejected' ? 'border-accent text-accent' : ''}`}
              >
                No
              </button>
              <span className="text-xs text-faint">
                Your answer stays in this browser and is not sent anywhere.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
