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

  const rawEmailSources = useMemo(
    () => sources.filter((source) => source.sendsRawEmail && source.configured),
    [sources],
  );

  const pushTrace = useCallback((line: TraceLine) => {
    setTrace((current) => [...current, line].slice(-MAX_TRACE_LINES));
  }, []);

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
              setProgress((current) => ({
                ...current,
                [event.id]: { done: event.done, total: event.total },
              }));
              break;

            case 'finding':
              setFindings((current) => [...current, event.finding]);
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
  }, [email, name, username, locality, declined, pushTrace]);

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

  const usernameProgress = progress.usernames;

  // ------------------------------------------------------------------ render

  return (
    <AnimatePresence mode="wait" initial={false}>
      {stage === 'form' ? (
        <motion.div key="form" {...(reduced ? {} : stageMotion)} className="py-10 sm:py-16">
          <header className="max-w-readable">
            <p className="tag-accent">Open a case</p>
            <h1 className="display mt-4 text-4xl sm:text-5xl">
              Find out where you are exposed
            </h1>
            <p className="mt-5 text-[0.9375rem] leading-relaxed text-muted">
              Enter your own details. We check breach records, public profiles, archived pages and
              around seven hundred websites, then explain what each result means and what you can do
              about it. Nothing is stored — the report exists in this tab and nowhere else.
            </p>
          </header>

          <form
            onSubmit={(submitEvent) => {
              submitEvent.preventDefault();
              void runScan();
            }}
            className="mt-12 max-w-readable space-y-10"
          >
            <div className="space-y-8">
              <div>
                <label htmlFor="email" className="tag block">
                  Email address
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(changeEvent) => setEmail(changeEvent.target.value)}
                  className="field mt-2 text-lg"
                  placeholder="you@example.com"
                />
              </div>

              <div className="grid gap-8 sm:grid-cols-2">
                <div>
                  <label htmlFor="username" className="tag block">
                    Username <span className="normal-case tracking-normal">(optional)</span>
                  </label>
                  <input
                    id="username"
                    value={username}
                    onChange={(changeEvent) => setUsername(changeEvent.target.value)}
                    className="field mt-2"
                    placeholder="janeo"
                  />
                  <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-faint">
                    Unlocks the seven-hundred-site sweep and the developer platforms.
                  </p>
                </div>
                <div>
                  <label htmlFor="name" className="tag block">
                    Name <span className="normal-case tracking-normal">(optional)</span>
                  </label>
                  <input
                    id="name"
                    value={name}
                    onChange={(changeEvent) => setName(changeEvent.target.value)}
                    className="field mt-2"
                    placeholder="Jane Okonkwo"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="locality" className="tag block">
                  Town or city <span className="normal-case tracking-normal">(optional)</span>
                </label>
                <input
                  id="locality"
                  value={locality}
                  onChange={(changeEvent) => setLocality(changeEvent.target.value)}
                  className="field mt-2"
                  placeholder="Bristol"
                />
                <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-faint">
                  Only used to tell you apart from other people with your name.
                </p>
              </div>
            </div>

            {rawEmailSources.length > 0 ? (
              <fieldset className="rule pt-6">
                <legend className="tag">Services that receive your address</legend>
                <p className="mt-3 max-w-readable text-sm leading-relaxed text-muted">
                  Most checks send only a one-way hash. These need the address itself. Turn off any
                  you would rather not use — the report will say they were skipped.
                </p>
                <div className="mt-4 space-y-3">
                  {rawEmailSources.map((source) => (
                    <label key={source.id} className="flex cursor-pointer items-start gap-3">
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
                        className="mt-1 accent-[rgb(var(--accent))]"
                      />
                      <span>
                        <span className="block text-sm text-ink">{source.label}</span>
                        <span className="block text-sm leading-relaxed text-muted">
                          {source.description}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}

            {/*
              Without email verification this checkbox is the only thing standing
              between the tool and casual use on other people. It is not much,
              but it is explicit, and it is what the terms rest on.
            */}
            <label className="flex cursor-pointer items-start gap-3 border-l-2 border-rule pl-4">
              <input
                type="checkbox"
                required
                checked={affirmed}
                onChange={(changeEvent) => setAffirmed(changeEvent.target.checked)}
                className="mt-1 accent-[rgb(var(--accent))]"
              />
              <span className="text-sm leading-relaxed text-muted">
                These details are mine. I am not using this to look up another person, or for
                employment, tenancy or credit screening.
              </span>
            </label>

            {error ? <p className="text-sm text-alarm">{error}</p> : null}

            <div className="flex flex-wrap items-center gap-4">
              <button type="submit" disabled={busy || !email || !affirmed} className="btn-primary">
                {busy ? 'Opening…' : 'Begin scan'}
              </button>
              <span className="font-mono text-[0.6875rem] text-faint">
                No account. No email. Nothing kept.
              </span>
            </div>
          </form>
        </motion.div>
      ) : (
        <motion.div key="report" {...(reduced ? {} : stageMotion)} className="py-10 sm:py-14">
          <header className="rule-none flex flex-wrap items-baseline justify-between gap-4 pb-6">
            <div>
              <p className="tag-accent">{stage === 'scanning' ? 'In progress' : 'Case file'}</p>
              <h1 className="display mt-3 text-3xl sm:text-4xl">
                {stage === 'scanning' ? 'Scanning' : 'Exposure report'}
              </h1>
            </div>
            {stage === 'report' ? (
              <dl className="flex gap-6 font-mono text-xs">
                <div>
                  <dt className="tag">Confirmed</dt>
                  <dd className="mt-1 text-lg text-accent">
                    <Counter value={summary.confirmed} />
                  </dd>
                </div>
                <div>
                  <dt className="tag">Likely</dt>
                  <dd className="mt-1 text-lg text-ink">
                    <Counter value={summary.likely} />
                  </dd>
                </div>
                <div>
                  <dt className="tag">Possible</dt>
                  <dd className="mt-1 text-lg text-muted">
                    <Counter value={summary.possible} />
                  </dd>
                </div>
              </dl>
            ) : usernameProgress ? (
              <p className="font-mono text-sm text-muted">
                <Counter value={usernameProgress.done} className="text-accent" /> /{' '}
                {usernameProgress.total} sites
              </p>
            ) : null}
          </header>

          {stage === 'scanning' ? (
            <p className="max-w-readable pb-6 text-sm leading-relaxed text-muted">
              Results appear as they arrive. You can start reading before it finishes.
            </p>
          ) : null}

          <CoveragePanel
            coverage={coverage}
            progress={progress}
            scanning={stage === 'scanning'}
          />

          {stage === 'scanning' ? <ScanTrace lines={trace} /> : null}

          {stage === 'report' ? (
            <div className="space-y-4 pt-8">
              {ownershipAsserted ? (
                <p className="max-w-readable border-l-2 border-rule-strong pl-4 text-sm leading-relaxed text-muted">
                  {OWNERSHIP_CAVEAT}
                </p>
              ) : null}

              {partial ? (
                <div className="max-w-readable space-y-3 border-l-2 border-accent pl-4">
                  <p className="text-sm leading-relaxed text-muted">
                    <span className="text-ink">This scan was only partly completed.</span> At least
                    one source could not be checked, so anything it might have found is unknown
                    rather than absent. Do not read this as an all-clear.
                  </p>
                  <Explainer educationKey="coverage" />
                </div>
              ) : null}

              {withheld > 0 ? (
                <p className="max-w-readable border-l-2 border-rule-strong pl-4 text-sm leading-relaxed text-muted">
                  <span className="text-ink">
                    {withheld} result{withheld === 1 ? ' was' : 's were'} withheld.
                  </span>{' '}
                  They come from categories — adult, dating, political, health — where being listed
                  is revealing in itself. Because your email address was never verified, we cannot
                  tell that you are the person being searched for, so these are not shown to anyone.
                </p>
              ) : null}
            </div>
          ) : null}

          {error ? <p className="pt-6 text-sm text-alarm">{error}</p> : null}

          {findings.length === 0 && stage === 'report' ? (
            <div className="max-w-readable pt-10">
              <p className="text-[0.9375rem] text-ink">
                Nothing was found in the sources we checked.
              </p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                That is genuinely good news for those sources, but it is not the whole internet.
                Open the coverage list above to see exactly what was checked.
              </p>
            </div>
          ) : null}

          <div className="pt-4">
            {SECTION_ORDER.map((section) => {
              const items = grouped.get(section);
              if (!items || items.length === 0) return null;

              return (
                <section key={section} className="pt-10">
                  <header className="flex items-baseline justify-between gap-4 pb-1">
                    <h2 className="display text-2xl">{SECTION_LABELS[section]}</h2>
                    <span className="tag">{items.length}</span>
                  </header>
                  <ul>
                    {items.map((finding, index) =>
                      finding.flags?.sensitive && !revealed.has(finding.id) ? (
                        <SensitiveEntry
                          key={finding.id}
                          index={index + 1}
                          onReveal={() =>
                            setRevealed((current) => new Set(current).add(finding.id))
                          }
                        />
                      ) : (
                        <FindingEntry
                          key={finding.id}
                          finding={finding}
                          index={index + 1}
                          verdict={verdicts[finding.id]}
                          onVerdict={(verdict) => applyVerdict(finding, verdict)}
                        />
                      ),
                    )}
                  </ul>
                </section>
              );
            })}
          </div>

          {stage === 'report' ? <RemovalSection opportunities={opportunities} /> : null}

          {stage === 'report' ? (
            <div className="rule mt-12 space-y-3 pt-8">
              <Explainer educationKey="confidence" />
              <Explainer educationKey="no_passwords" />
              <p className="max-w-readable pt-3 font-mono text-[0.6875rem] leading-relaxed text-faint">
                This report exists only in this browser tab. Closing it discards everything — we
                kept no copy.
              </p>
            </div>
          ) : null}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
