'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useState } from 'react';
import { DATA_TYPE_LABELS, type Finding } from '@/lib/normalize/finding';
import { ConfidenceBadge, ConfidenceReasons } from './ConfidenceBadge';
import { Explainer } from './Explainer';

export type Verdict = 'confirmed' | 'rejected' | undefined;

/**
 * One finding, as a glass card that expands in place.
 *
 * The collapsed state carries only what is needed to decide whether to look:
 * what was found, where, when, and how sure we are. Everything else waits.
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

/**
 * The link as a person reads it: the host, and enough of the path to tell one
 * profile from another. The full URL is on the anchor, so hovering still shows
 * exactly where it goes.
 */
function readableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    const host = url.host.replace(/^www\./, '');
    const path = decodeURIComponent(url.pathname).replace(/\/$/, '');
    const tail = path.length > 28 ? `${path.slice(0, 27)}…` : path;
    return host + tail;
  } catch {
    return raw;
  }
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-4 px-4 py-3">
      <dt className="label w-24 shrink-0">{label}</dt>
      <dd className="min-w-0 text-[0.9375rem] text-ink">{children}</dd>
    </div>
  );
}

export function FindingEntry({
  finding,
  verdict,
  onVerdict,
}: {
  finding: Finding;
  verdict: Verdict;
  onVerdict: (verdict: Verdict) => void;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  const when = formatWhen(finding);
  const includesCredentials = finding.dataTypes.includes('password_credential');
  const rejected = verdict === 'rejected';
  const link = finding.evidence?.url;
  // The title usually already names the service. Repeating it underneath is the
  // kind of filler that makes a report feel padded.
  const showsOrigin = !finding.title.includes(finding.origin.name);

  return (
    <motion.li
      layout={reduced ? false : 'position'}
      initial={reduced ? false : { opacity: 0, y: 12, scale: 0.985 }}
      animate={{ opacity: rejected ? 0.45 : 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 360, damping: 32, mass: 0.8 }}
      className="glass overflow-hidden"
    >
      <motion.button
        type="button"
        whileTap={reduced ? undefined : { scale: 0.985 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start justify-between gap-4 p-4 text-left sm:p-5"
      >
        <span className="min-w-0">
          <span className="block text-[1.0625rem] font-medium leading-snug text-ink">
            {finding.title}
          </span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-faint">
            {[
              showsOrigin ? finding.origin.name : null,
              when,
              finding.flags?.unverifiedBreach ? 'unconfirmed breach' : null,
            ]
              .filter((part): part is string => Boolean(part))
              .map((part, index) => (
                <span key={part} className="flex items-center gap-x-2">
                  {index > 0 ? <span aria-hidden>·</span> : null}
                  <span className={part === when ? 'tabular' : undefined}>{part}</span>
                </span>
              ))}
          </span>
        </span>

        <span className="flex shrink-0 items-center gap-2.5">
          <ConfidenceBadge confidence={finding.confidence} />
          {/* iOS uses a chevron that turns, not a plus that becomes a cross. */}
          <motion.svg
            aria-hidden
            viewBox="0 0 7 12"
            fill="none"
            className="chevron"
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
        </span>
      </motion.button>

      {link ? (
        <motion.a
          layout={reduced ? false : 'position'}
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow"
          whileTap={reduced ? undefined : { scale: 0.99 }}
          className="flex items-center gap-2 border-t border-[rgb(var(--edge)/var(--edge-alpha))] px-4 py-2.5 text-[0.8125rem] font-medium text-accent-soft transition-colors hover:bg-[rgb(var(--glass)/0.07)] sm:px-5"
        >
          <span className="min-w-0 flex-1 truncate">{readableUrl(link)}</span>
          <svg aria-hidden viewBox="0 0 12 12" fill="none" className="h-3 w-3 shrink-0">
            <path
              d="M3.5 8.5L8.5 3.5M8.5 3.5H4.5M8.5 3.5V7.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <span className="sr-only">{finding.evidence?.label ?? 'Open in a new tab'}</span>
        </motion.a>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            key="detail"
            initial={reduced ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduced ? undefined : { height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="space-y-6 px-4 pb-5 sm:px-5">
              <dl className="well list-inset overflow-hidden">
                <MetaRow label="Where">
                  {finding.origin.name}
                  {finding.origin.domain ? (
                    <span className="mono-xs ml-2 text-faint">{finding.origin.domain}</span>
                  ) : null}
                </MetaRow>
                <MetaRow label="When">
                  <span className="tabular">{when ?? 'Not known'}</span>
                </MetaRow>
                <MetaRow label="Exposed">
                  <span className="flex flex-wrap gap-1.5">
                    {finding.dataTypes.map((type) => (
                      <span key={type} className="pill text-muted">
                        {DATA_TYPE_LABELS[type]}
                      </span>
                    ))}
                  </span>
                </MetaRow>
                <MetaRow label="Found by">
                  <span className="text-muted">
                    {finding.provider.label}
                    {finding.alsoSeenBy?.length ? (
                      <>
                        {', '}
                        {finding.alsoSeenBy.join(', ')}
                        <span className="ml-2 text-[0.8125rem] text-accent-soft">
                          {finding.alsoSeenBy.length + 1} independent sources agree
                        </span>
                      </>
                    ) : null}
                  </span>
                </MetaRow>
              </dl>

              {includesCredentials ? (
                <p className="rounded-glass-sm border border-warn/25 bg-warn/[0.09] px-4 py-3 text-[0.9375rem] leading-relaxed text-muted">
                  Password credentials were included in this breach. This tool never retrieves or
                  shows the credential itself — only the fact that it was part of the data.
                </p>
              ) : null}

              <div>
                <p className="label mb-2">Why this matters</p>
                <p className="text-[0.9375rem] leading-relaxed text-muted">
                  {finding.whyItMatters}
                </p>
              </div>

              <ConfidenceReasons confidence={finding.confidence} />

              {finding.actions.length > 0 ? (
                <div>
                  <p className="label mb-3">What to do</p>
                  <ol className="space-y-3">
                    {finding.actions.map((action, actionIndex) => (
                      <li key={action.label} className="well flex gap-3 px-4 py-3.5">
                        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[0.6875rem] font-semibold text-accent-soft">
                          {actionIndex + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[0.9375rem] font-medium text-ink">
                            {action.label}
                          </span>
                          <span className="mt-1 block text-[0.9375rem] leading-relaxed text-muted">
                            {action.detail}
                          </span>
                          {action.url ? (
                            <a
                              href={action.url}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="mt-2 inline-block text-[0.875rem] font-medium text-accent-soft hover:underline"
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

              <Explainer educationKey={finding.educationKey} />

              <div className="flex flex-wrap items-center gap-2.5 border-t border-glass/[0.07] pt-4">
                <span className="label">Is this you?</span>
                <motion.button
                  type="button"
                  whileTap={reduced ? undefined : { scale: 0.95 }}
                  onClick={() => onVerdict(verdict === 'confirmed' ? undefined : 'confirmed')}
                  aria-pressed={verdict === 'confirmed'}
                  className={`btn-quiet ${verdict === 'confirmed' ? '!bg-accent/25 !text-accent-soft' : ''}`}
                >
                  Yes
                </motion.button>
                <motion.button
                  type="button"
                  whileTap={reduced ? undefined : { scale: 0.95 }}
                  onClick={() => onVerdict(verdict === 'rejected' ? undefined : 'rejected')}
                  aria-pressed={rejected}
                  className={`btn-quiet ${rejected ? '!bg-accent/25 !text-accent-soft' : ''}`}
                >
                  No
                </motion.button>
                <span className="text-[0.75rem] text-faint">Stays in this browser</span>
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
export function SensitiveEntry({ onReveal }: { onReveal: () => void }) {
  return (
    <li className="glass p-5">
      <p className="text-[1.0625rem] font-medium text-ink">A result from a sensitive category</p>
      <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-muted">
        This came from a category — adult, dating, political or health — where being listed is
        revealing in itself. It stays hidden until you ask for it.
      </p>
      <button type="button" onClick={onReveal} className="btn-quiet mt-3.5">
        Show this result
      </button>
    </li>
  );
}
