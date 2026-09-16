'use client';

import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoverageEntry, ScanEvent } from '@/lib/orchestrator';
import {
  SECTION_LABELS,
  type Finding,
  type RemovalOpportunity,
  type Section,
} from '@/lib/normalize/finding';
import { assessConfidence } from '@/lib/confidence/score';
import { OWNERSHIP_CAVEAT } from '@/lib/confidence/signals';
import { CoveragePanel } from './CoveragePanel';
import { Counter } from './Counter';
import { FindingEntry, SensitiveEntry, type Verdict } from './FindingEntry';
import { RemovalSection } from './RemovalSection';
import { ScanningScreen } from './ScanningScreen';
import { ScanTrace, type TraceLine } from './ScanTrace';
import { Explainer } from './Explainer';

/**
 * The whole experience: enter details, watch the scan, read the report.
 *
 * All state lives here, in the browser, for the life of the tab. Nothing is
 * persisted and nothing is sent back after the scan finishes — including the
 * "is this you?" answers, which stay local.
 */

type Stage = 'form' | 'scanning' | 'report';

interface SourceInfo {
  id: string;
  label: string;
  description: string;
  sendsRawEmail: boolean;
  configured: boolean;
}

const SECTION_ORDER: Section[] = [
  'breaches',
  'stealer',
  'profiles',
  'usernames',
  'search',
  'archive',
  'other',
];

const MAX_TRACE_LINES = 14;

const stageMotion = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.35, ease: [0.22, 1, 0.36, 1] as const },
};

export function ScanFlow() {
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [locality, setLocality] = useState('');
  const [affirmed, setAffirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  const [findings, setFindings] = useState<Finding[]>([]);
  const [opportunities, setOpportunities] = useState<RemovalOpportunity[]>([]);
  const [coverage, setCoverage] = useState<CoverageEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [trace, setTrace] = useState<TraceLine[]>([]);
  const [partial, setPartial] = useState(false);
  const [ownershipAsserted, setOwnershipAsserted] = useState(true);
  const [withheld, setWithheld] = useState(0);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});
  const [revealed, setRevealed] = useState<Set<string>>(new Set());

  const abortRef = useRef<AbortController | null>(null);
  /** Source id → human label, for the trace feed. */
  const sourceLabels = useRef(new Map<string, string>());
  const reduced = useReducedMotion();

  useEffect(() => {
    fetch('/api/sources')
      .then((response) => response.json())
      .then((data: { sources: SourceInfo[] }) => setSources(data.sources))
      .catch(() => setSources([]));
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  // Moving between stages replaces the whole screen, so the old scroll position
  // is meaningless — and since the submit button sits near the bottom of a long
  // form, keeping it would drop the viewer below the scanning screen entirely.
  useEffect(() => {
    if (stage === 'form') return;
    window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });
  }, [stage, reduced]);

  const rawEmailSources = useMemo(
    () => sources.filter((source) => source.sendsRawEmail && source.configured),
    [sources],
  );

  const pushTrace = useCallback((line: TraceLine) => {
    setTrace((current) => [...current, line].slice(-MAX_TRACE_LINES));
  }, []);

  const pendingProgress = useRef<Record<string, { done: number; total: number }>>({});
  const progressFrame = useRef<number | null>(null);

  const scheduleProgressFlush = useCallback(() => {
    if (progressFrame.current !== null) return;
    progressFrame.current = requestAnimationFrame(() => {
      progressFrame.current = null;
      const pending = pendingProgress.current;
      pendingProgress.current = {};
      if (Object.keys(pending).length === 0) return;
      setProgress((current) => ({ ...current, ...pending }));
    });
  }, []);

  useEffect(
    () => () => {
      if (progressFrame.current !== null) cancelAnimationFrame(progressFrame.current);
    },
    [],
  );

  const runScan = useCallback(async () => {
    setError(null);
    setBusy(true);
    setFindings([]);
    setOpportunities([]);
    setProgress({});
    setTrace([]);
    setPartial(false);
    setWithheld(0);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email,
          name: name || undefined,
          username: username || undefined,
          locality: locality || undefined,
          declinedSources: [...declined],
        }),
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? 'The scan could not be started.');
        setBusy(false);
        return;
      }

      setStage('scanning');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const chunks = buffer.split('\n\n');
        buffer = chunks.pop() ?? '';

        for (const chunk of chunks) {
          const line = chunk.trim();
          if (!line.startsWith('data: ')) continue;

          let event: ScanEvent;
          try {
            event = JSON.parse(line.slice(6)) as ScanEvent;
          } catch {
            continue;
          }

          switch (event.type) {
            case 'scan_started':
              setCoverage(event.sources);
              for (const source of event.sources) {
                sourceLabels.current.set(source.id, source.label);
              }
              pushTrace({
                id: `start-${event.scanId}`,
                label: `scan opened · ${event.sources.length} sources`,
                tone: 'run',
              });
              break;

            case 'source_status': {
              setCoverage((current) =>
                current.map((entry) =>
                  entry.id === event.id
                    ? { ...entry, status: event.status, detail: event.detail ?? entry.detail }
                    : entry,
                ),
              );
              const tone =
                event.status === 'running'
                  ? 'run'
                  : event.status === 'ok'
                    ? 'miss'
                    : event.status === 'failed' || event.status === 'rate_limited'
                      ? 'warn'
                      : 'miss';
              pushTrace({
                id: `${event.id}-${event.status}`,
                label: sourceLabels.current.get(event.id) ?? event.id,
                detail: event.status.replace('_', ' '),
                tone,
              });
              break;
            }

            case 'progress':
              // Buffered and flushed on an animation frame: the sweep emits
              // these far faster than the screen refreshes, and applying each
              // one separately re-rendered the whole tree for no visible gain.
              pendingProgress.current[event.id] = { done: event.done, total: event.total };
              scheduleProgressFlush();
              break;

            case 'finding':
              // Upsert, not append: the server re-sends a finding when a second
              // source reports the same thing and the two are merged.
              setFindings((current) => {
                const index = current.findIndex((item) => item.id === event.finding.id);
                if (index === -1) return [...current, event.finding];
                const next = [...current];
                next[index] = event.finding;
                return next;
              });
              pushTrace({
                id: `f-${event.finding.id}`,
                label: event.finding.origin.name,
                detail: 'found',
                tone: 'hit',
              });
              break;

            case 'removal_opportunity':
              setOpportunities((current) => [...current, event.opportunity]);
              break;

            case 'scan_complete':
              if (event.coverage.length > 0) setCoverage(event.coverage);
              setPartial(event.partial);
              setOwnershipAsserted(event.ownershipAsserted);
              setWithheld(event.counts.withheld);
              setStage('report');
              break;
          }
        }
      }
      setStage('report');
    } catch (caught) {
      if ((caught as Error)?.name !== 'AbortError') {
        setError('The scan was interrupted.');
        setStage('report');
      }
    } finally {
      setBusy(false);
    }
  }, [email, name, username, locality, declined, pushTrace, scheduleProgressFlush]);

  /** Re-scores a finding when the person answers "is this you?". */
  const applyVerdict = useCallback((finding: Finding, verdict: Verdict) => {
    setVerdicts((current) => ({ ...current, [finding.id]: verdict }));
    setFindings((current) =>
      current.map((item) =>
        item.id === finding.id
          ? {
              ...item,
              confidence: assessConfidence({
                signals: item.confidence.signals
                  .filter((signal) => signal.id !== 'user_confirmed' && signal.id !== 'user_rejected')
                  .map((signal) => signal.id),
                nameOnly: item.section === 'search' && item.dataTypes.includes('name'),
                userVerdict: verdict,
              }),
            }
          : item,
      ),
    );
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<Section, Finding[]>();
    for (const finding of findings) {
      const list = map.get(finding.section) ?? [];
      list.push(finding);
      map.set(finding.section, list);
    }
    return map;
  }, [findings]);

  const summary = useMemo(() => {
    const active = findings.filter((finding) => verdicts[finding.id] !== 'rejected');
    return {
      confirmed: active.filter((finding) => finding.confidence.level === 'confirmed').length,
      likely: active.filter((finding) => finding.confidence.level === 'likely').length,
      possible: active.filter((finding) => finding.confidence.level === 'possible').length,
      total: active.length,
    };
  }, [findings, verdicts]);


  // ------------------------------------------------------------------ render

  return (
    <AnimatePresence mode="wait" initial={false}>
      {stage === 'form' ? (
        <motion.div key="form" {...(reduced ? {} : stageMotion)} className="py-10 sm:py-14">
          <header className="mx-auto max-w-readable">
            <h1 className="text-[2.5rem] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[3.25rem]">
              Find out where
              <br />
              you are exposed
            </h1>
            <p className="mt-5 text-[1.0625rem] leading-relaxed text-muted">
              Breaches, social accounts, public profiles and old pages — across seven hundred sites.
              Nothing is stored.
            </p>
          </header>

          <form
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              void runScan();
            }}
            className="mx-auto mt-10 max-w-readable space-y-5"
          >
            <div className="glass space-y-5 p-5 sm:p-6">
              <div>
                <label htmlFor="email" className="label mb-2 block">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(changeEvent) => setEmail(changeEvent.target.value)}
                  className="field"
                  placeholder="you@example.com"
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <div>
                  <label htmlFor="username" className="label mb-2 block">
                    Username <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    id="username"
                    value={username}
                    onChange={(changeEvent) => setUsername(changeEvent.target.value)}
                    className="field"
                    placeholder="janeo"
                  />
                  <p className="mt-2 text-[0.75rem] leading-relaxed text-faint">
                    Optional — we also check handles taken from your address.
                  </p>
                </div>
                <div>
                  <label htmlFor="name" className="label mb-2 block">
                    Name <span className="text-faint">(optional)</span>
                  </label>
                  <input
                    id="name"
                    value={name}
                    onChange={(changeEvent) => setName(changeEvent.target.value)}
                    className="field"
                    placeholder="Jane Okonkwo"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="locality" className="label mb-2 block">
                  Town or city <span className="text-faint">(optional)</span>
                </label>
                <input
                  id="locality"
                  value={locality}
                  onChange={(changeEvent) => setLocality(changeEvent.target.value)}
                  className="field"
                  placeholder="Bristol"
                />
                <p className="mt-2 text-[0.75rem] leading-relaxed text-faint">
                  Tells you apart from others with your name.
                </p>
              </div>
            </div>

            {rawEmailSources.length > 0 ? (
              // A real <fieldset>/<legend> cuts a notch in the panel border, which
              // the glass edge makes obvious. A labelled group gives the same
              // semantics with one element and an unbroken edge.
              <div role="group" aria-labelledby="consent-heading" className="glass p-5 sm:p-6">
                <h2 id="consent-heading" className="text-[1.0625rem] font-medium text-ink">
                  Services that receive your address
                </h2>
                <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
                  Most checks send a one-way hash. These need the address itself.
                </p>
                <div className="mt-4 space-y-2">
                  {rawEmailSources.map((source) => (
                    <label
                      key={source.id}
                      className="well flex cursor-pointer items-start gap-3 p-3.5"
                    >
                      <input
                        type="checkbox"
                        checked={!declined.has(source.id)}
                        onChange={(changeEvent) =>
                          setDeclined((current) => {
                            const next = new Set(current);
                            if (changeEvent.target.checked) next.delete(source.id);
                            else next.add(source.id);
                            return next;
                          })
                        }
                        className="mt-1 h-4 w-4 accent-[rgb(var(--accent))]"
                      />
                      <span>
                        <span className="block text-[0.9375rem] font-medium text-ink">
                          {source.label}
                        </span>
                        <span className="mt-0.5 block text-[0.875rem] leading-relaxed text-muted">
                          {source.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}

            {/*
              Without email verification this checkbox is the only thing standing
              between the tool and casual use on other people. It is not much,
              but it is explicit, and it is what the terms rest on.
            */}
            <label className="glass flex cursor-pointer items-start gap-3 p-4 sm:p-5">
              <input
                type="checkbox"
                required
                checked={affirmed}
                onChange={(changeEvent) => setAffirmed(changeEvent.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[rgb(var(--accent))]"
              />
              <span className="text-[0.9375rem] leading-relaxed text-muted">
                These details are mine. Not for looking up other people, or for screening anyone.
              </span>
            </label>

            {error ? (
              <p className="rounded-glass-sm border border-alarm/30 bg-alarm/10 px-4 py-3 text-[0.9375rem] text-alarm">
                {error}
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-4">
              <motion.button
                type="submit"
                whileTap={reduced ? undefined : { scale: 0.97 }}
                disabled={busy || !email || !affirmed}
                className="btn-primary"
              >
                {busy ? 'Opening…' : 'Begin scan'}
              </motion.button>
              <span className="text-[0.8125rem] text-faint">
                No account. No email. Nothing kept.
              </span>
            </div>
          </form>
        </motion.div>
      ) : (
        <motion.div
          key="report"
          {...(reduced ? {} : stageMotion)}
          className="mx-auto max-w-readable space-y-4 py-10 sm:py-14"
        >
          {stage === 'scanning' ? (
            <ScanningScreen
              coverage={coverage}
              progress={progress}
              findingCount={findings.length}
            />
          ) : null}

          {/*
            The scanning screen provides its own heading, so rendering this one
            as well — even hidden — would put two <h1>s on the page.
          */}
          {stage === 'report' ? (
            <header className="flex flex-wrap items-end justify-between gap-5">
              <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.5rem]">
                Exposure report
              </h1>

              <dl className="flex gap-2">
                {(
                  [
                    ['Confirmed', summary.confirmed, 'text-accent-soft'],
                    ['Likely', summary.likely, 'text-ink'],
                    ['Possible', summary.possible, 'text-muted'],
                  ] as const
                ).map(([label, value, tone]) => (
                  <div key={label} className="glass min-w-[5.5rem] px-4 py-3 text-center">
                    <dd className={`text-[1.75rem] font-semibold leading-none ${tone}`}>
                      <Counter value={value} />
                    </dd>
                    <dt className="mt-1.5 text-[0.75rem] text-faint">{label}</dt>
                  </div>
                ))}
              </dl>
            </header>
          ) : null}

          <CoveragePanel
            coverage={coverage}
            progress={progress}
            scanning={stage === 'scanning'}
          />

          {stage === 'scanning' ? <ScanTrace lines={trace} /> : null}

          {stage === 'report' ? (
            <div className="space-y-3">
              {withheld > 0 ? (
                <p className="glass p-4 text-[0.9375rem] leading-relaxed text-muted sm:p-5">
                  <span className="font-medium text-ink">{withheld} withheld.</span> Adult, dating,
                  political and health results stay hidden — we cannot confirm the address is yours.
                </p>
              ) : null}

              {ownershipAsserted ? (
                <p className="px-1 text-[0.8125rem] leading-relaxed text-faint">
                  {OWNERSHIP_CAVEAT}
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <p className="rounded-glass-sm border border-alarm/30 bg-alarm/10 px-4 py-3 text-[0.9375rem] text-alarm">
              {error}
            </p>
          ) : null}

          {findings.length === 0 && stage === 'report' ? (
            <div className="glass p-5 sm:p-6">
              <p className="text-[1.0625rem] font-medium text-ink">Nothing found.</p>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">
                Good news for the sources we checked — open Coverage to see which those were.
              </p>
            </div>
          ) : null}

          <div className="space-y-8 pt-4">
            {SECTION_ORDER.map((section) => {
              const items = grouped.get(section);
              if (!items || items.length === 0) return null;

              return (
                <motion.section
                  key={section}
                  initial={reduced ? false : { opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                >
                  <header className="mb-3 flex items-center gap-2.5 px-1">
                    <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">
                      {SECTION_LABELS[section]}
                    </h2>
                    <span className="pill text-faint">{items.length}</span>
                  </header>
                  <ul className="space-y-2.5">
                    {items.map((finding) =>
                      finding.flags?.sensitive && !revealed.has(finding.id) ? (
                        <SensitiveEntry
                          key={finding.id}
                          onReveal={() =>
                            setRevealed((current) => new Set(current).add(finding.id))
                          }
                        />
                      ) : (
                        <FindingEntry
                          key={finding.id}
                          finding={finding}
                          verdict={verdicts[finding.id]}
                          onVerdict={(verdict) => applyVerdict(finding, verdict)}
                        />
                      ),
                    )}
                  </ul>
                </motion.section>
              );
            })}
          </div>

          {stage === 'report' ? <RemovalSection opportunities={opportunities} /> : null}

          {stage === 'report' ? (
            <div className="space-y-2.5 pt-6">
              <Explainer educationKey="confidence" />
              <Explainer educationKey="no_passwords" />
              <p className="px-1 pt-2 text-[0.8125rem] leading-relaxed text-faint">
                This report lives in this tab only. Close it and it is gone.
              </p>
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
