'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { DATA_TYPE_LABELS, type Finding } from '@/lib/normalize/finding';
import { ConfidenceBadge, ConfidenceReasons } from './ConfidenceBadge';
import { Explainer } from './Explainer';

export type Verdict = 'confirmed' | 'rejected' | undefined;

/**
 * One numbered entry in the dossier.
 *
 * Not a card: an indexed record separated from its neighbours by a hairline,
 * with its metadata set in monospace so the eye reads it as data. The left
 * gutter carries the index and the section tag, which is what makes a long
 * report scannable without any decoration at all.
 */
function formatWhen(finding: Finding): string | null {
  const when = finding.occurredAt;
  if (!when) return null;
  if (when.precision === 'day' && when.date) {
    return new Date(when.date).toLocaleDateString('en-GB', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
  if (when.year) return String(when.year);
  return null;
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 py-1.5">
      <dt className="tag w-28 shrink-0 pt-px">{label}</dt>
      <dd className="min-w-0 text-sm text-ink">{children}</dd>
    </div>
  );
}

export function FindingEntry({
  finding,
  index,
  verdict,
  onVerdict,
}: {
  finding: Finding;
  index: number;
  verdict: Verdict;
  onVerdict: (verdict: Verdict) => void;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  const when = formatWhen(finding);
  const includesCredentials = finding.dataTypes.includes('password_credential');
  const rejected = verdict === 'rejected';

  return (
    <motion.li
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: rejected ? 0.45 : 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 380, damping: 34, mass: 0.7 }}
      className="rule"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="group grid w-full grid-cols-[2.5rem_1fr_auto] items-start gap-3 py-5 text-left sm:gap-5"
      >
        <span className="index pt-1">{String(index).padStart(3, '0')}</span>

        <span className="min-w-0">
          <span className="block text-[0.9375rem] leading-snug text-ink group-hover:text-accent">
            {finding.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[0.6875rem] text-faint">
            <span>{finding.origin.name}</span>
            {when ? (
              <>
                <span aria-hidden>·</span>
                <span className="tabular">{when}</span>
              </>
            ) : null}
            {finding.flags?.unverifiedBreach ? (
              <>
                <span aria-hidden>·</span>
                <span>unconfirmed breach</span>
              </>
            ) : null}
          </span>
        </span>

        <span className="flex items-center gap-3 pt-1">
          <ConfidenceBadge confidence={finding.confidence} />
          <span aria-hidden className="tag text-faint">
            {open ? '−' : '+'}
          </span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="detail"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-[2.5rem_1fr] gap-3 pb-8 sm:gap-5">
              <div aria-hidden />
              <div className="max-w-readable space-y-7">
                <dl className="divide-y divide-rule/60 border-y border-rule/60">
                  <MetaRow label="Where">
                    {finding.origin.name}
                    {finding.origin.domain ? (
                      <span className="ml-2 font-mono text-xs text-faint">
                        {finding.origin.domain}
                      </span>
                    ) : null}
                  </MetaRow>
                  <MetaRow label="When">
                    <span className="tabular">{when ?? 'Not known'}</span>
                  </MetaRow>
                  <MetaRow label="Exposed">
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {finding.dataTypes.map((type) => (
                        <span key={type} className="font-mono text-xs text-muted">
                          {DATA_TYPE_LABELS[type]}
                        </span>
                      ))}
                    </span>
                  </MetaRow>
                  <MetaRow label="Found by">
                    <span className="font-mono text-xs text-muted">{finding.provider.label}</span>
                  </MetaRow>
                </dl>

                {includesCredentials ? (
                  <p className="border-l-2 border-accent pl-4 text-sm leading-relaxed text-muted">
                    Password credentials were included in this breach. This tool never retrieves or
                    shows the credential itself — only the fact that it was part of the data.
                  </p>
                ) : null}

                <div>
                  <p className="tag mb-2">Why this matters</p>
                  <p className="text-sm leading-relaxed text-muted">{finding.whyItMatters}</p>
                </div>

                <ConfidenceReasons confidence={finding.confidence} />

                {finding.actions.length > 0 ? (
                  <div>
                    <p className="tag mb-3">What to do</p>
                    <ol className="space-y-4">
                      {finding.actions.map((action, actionIndex) => (
                        <li key={action.label} className="flex gap-3">
                          <span className="index pt-1">{actionIndex + 1}</span>
                          <span>
                            <span className="block text-sm text-ink">{action.label}</span>
                            <span className="mt-1 block text-sm leading-relaxed text-muted">
                              {action.detail}
                            </span>
                            {action.url ? (
                              <a
                                href={action.url}
                                target="_blank"
                                rel="noopener noreferrer nofollow"
                                className="tag-accent mt-2 inline-block hover:underline"
                              >
                                {action.type === 'opt_out' ? 'Request removal →' : 'Open →'}
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}

                {finding.evidence?.url ? (
                  <a
                    href={finding.evidence.url}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="tag-accent inline-block hover:underline"
                  >
                    {finding.evidence.label ?? 'View the source'} →
                  </a>
                ) : null}

                <Explainer educationKey={finding.educationKey} />

                <div className="rule flex flex-wrap items-center gap-3 pt-5">
                  <span className="tag">Is this you?</span>
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
                    aria-pressed={rejected}
                    className={`btn-quiet ${rejected ? 'border-accent text-accent' : ''}`}
                  >
                    No
                  </button>
                  <span className="font-mono text-[0.6875rem] text-faint">
                    Stays in this browser
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </motion.li>
  );
}

/**
 * A finding from a sensitive category, kept covered until asked for.
 *
 * Somebody may be reading this on a train. Being listed on an adult, dating,
 * political or health site is revealing merely by association, so the fact that
 * something was found is shown while the detail stays behind a deliberate click.
 */
export function SensitiveEntry({ index, onReveal }: { index: number; onReveal: () => void }) {
  return (
    <li className="rule grid grid-cols-[2.5rem_1fr] gap-3 py-5 sm:gap-5">
      <span className="index pt-1">{String(index).padStart(3, '0')}</span>
      <div className="max-w-readable">
        <p className="text-[0.9375rem] text-ink">A result from a sensitive category</p>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          This came from a category — adult, dating, political or health — where being listed is
          revealing in itself. It stays hidden until you ask for it.
        </p>
        <button type="button" onClick={onReveal} className="btn-quiet mt-3">
          Show this result
        </button>
      </div>
    </li>
  );
}
