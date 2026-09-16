'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CoverageEntry, ScanEvent } from '@/lib/orchestrator';
import { SECTION_LABELS, type Finding, type RemovalOpportunity, type Section } from '@/lib/normalize/finding';
import { assessConfidence } from '@/lib/confidence/score';
import { CoveragePanel } from './CoveragePanel';
import { FindingCard, type Verdict } from './FindingCard';
import { RemovalSection } from './RemovalSection';
import { Explainer } from './Explainer';

/**
 * The whole experience: enter details, verify, watch the scan, read the report.
 *
 * All state is held here, in the browser, for the life of the tab. Nothing is
 * persisted and nothing is sent back after the scan finishes — including the
 * "is this you?" answers, which stay local.
 */

type Stage = 'form' | 'verify' | 'scanning' | 'report';

interface SourceInfo {
  id: string;
  label: string;
  description: string;
  sendsRawEmail: boolean;
  configured: boolean;
  requires: string[];
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

export function ScanFlow() {
  const [stage, setStage] = useState<Stage>('form');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [locality, setLocality] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [declined, setDeclined] = useState<Set<string>>(new Set());

  const [findings, setFindings] = useState<Finding[]>([]);
  const [opportunities, setOpportunities] = useState<RemovalOpportunity[]>([]);
  const [coverage, setCoverage] = useState<CoverageEntry[]>([]);
  const [progress, setProgress] = useState<Record<string, { done: number; total: number }>>({});
  const [partial, setPartial] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>({});

  const abortRef = useRef<AbortController | null>(null);

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

  const startVerification = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/verify/start', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'Could not send the code.');
        return;
      }
      setStage('verify');
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }, [email]);

  const runScan = useCallback(async () => {
    setError(null);
    setBusy(true);
    setFindings([]);
    setOpportunities([]);
    setProgress({});
    setPartial(false);

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
              break;
            case 'source_status':
              setCoverage((current) =>
                current.map((entry) =>
                  entry.id === event.id
                    ? { ...entry, status: event.status, detail: event.detail ?? entry.detail }
                    : entry,
                ),
              );
              break;
            case 'progress':
              setProgress((current) => ({
                ...current,
                [event.id]: { done: event.done, total: event.total },
              }));
              break;
            case 'finding':
              setFindings((current) => [...current, event.finding]);
              break;
            case 'removal_opportunity':
              setOpportunities((current) => [...current, event.opportunity]);
              break;
            case 'scan_complete':
              if (event.coverage.length > 0) setCoverage(event.coverage);
              setPartial(event.partial);
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
  }, [email, name, username, locality, declined]);

  const confirmCode = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      const response = await fetch('/api/verify/confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? 'That code could not be confirmed.');
        setBusy(false);
        return;
      }
      await runScan();
    } catch {
      setError('Could not reach the server.');
      setBusy(false);
    }
  }, [email, code, runScan]);

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
      verified: active.filter((finding) => finding.confidence.level === 'verified').length,
      likely: active.filter((finding) => finding.confidence.level === 'likely').length,
      possible: active.filter((finding) => finding.confidence.level === 'possible').length,
    };
  }, [findings, verdicts]);

  // ---------------------------------------------------------------- render

  if (stage === 'form') {
    return (
      <div className="mx-auto max-w-readable space-y-8 px-4 py-12">
        <div className="space-y-3">
          <h1 className="text-2xl font-semibold tracking-tight">
            Find out where your information is exposed
          </h1>
          <p className="text-muted leading-relaxed">
            Enter your own details. We check breach records, public profiles and archived pages,
            then explain what each result means and what you can do about it. You will verify your
            email address first, so this can only be used on yourself.
          </p>
        </div>

        <form
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void startVerification();
          }}
          className="space-y-5"
        >
          <div className="space-y-1.5">
            <label htmlFor="email" className="block text-sm font-medium">
              Your email address
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
            <p className="text-xs text-faint">
              We send a code here to confirm it is yours. It is never stored.
            </p>
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="name" className="block text-sm font-medium">
                Your name <span className="font-normal text-faint">(optional)</span>
              </label>
              <input
                id="name"
                value={name}
                onChange={(changeEvent) => setName(changeEvent.target.value)}
                className="field"
                placeholder="Jane Okonkwo"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="username" className="block text-sm font-medium">
                A username you use <span className="font-normal text-faint">(optional)</span>
              </label>
              <input
                id="username"
                value={username}
                onChange={(changeEvent) => setUsername(changeEvent.target.value)}
                className="field"
                placeholder="janeo"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="locality" className="block text-sm font-medium">
              Your town or city <span className="font-normal text-faint">(optional)</span>
            </label>
            <input
              id="locality"
              value={locality}
              onChange={(changeEvent) => setLocality(changeEvent.target.value)}
              className="field"
              placeholder="Manchester"
            />
            <p className="text-xs text-faint">
              Used only to tell you apart from other people with your name. It makes name results
              more accurate, never less.
            </p>
          </div>

          {rawEmailSources.length > 0 ? (
            <fieldset className="card space-y-3 p-4">
              <legend className="px-1 text-sm font-medium">
                Which services may receive your address
              </legend>
              <p className="text-sm text-muted">
                Most checks use a one-way hash of your address. These ones need the address itself.
                Turn off any you would rather not use — the report will say they were skipped.
              </p>
              {rawEmailSources.map((source) => (
                <label key={source.id} className="flex items-start gap-3">
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
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm text-ink">{source.label}</span>
                    <span className="block text-sm text-muted">{source.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {error ? <p className="text-sm text-verified">{error}</p> : null}

          <button type="submit" disabled={busy || !email} className="btn-primary">
            {busy ? 'Sending code…' : 'Send verification code'}
          </button>
        </form>

        <p className="text-xs leading-relaxed text-faint">
          We never ask for, retrieve or display passwords. If a breach included credentials, the
          report says so and nothing more.
        </p>
      </div>
    );
  }

  if (stage === 'verify') {
    return (
      <div className="mx-auto max-w-readable space-y-6 px-4 py-12">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Check your email</h1>
          <p className="text-muted">
            We sent a six-digit code to the address you entered. It expires in 15 minutes.
          </p>
        </div>

        <form
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault();
            void confirmCode();
          }}
          className="space-y-4"
        >
          <div className="space-y-1.5">
            <label htmlFor="code" className="block text-sm font-medium">
              Verification code
            </label>
            <input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(changeEvent) => setCode(changeEvent.target.value)}
              className="field max-w-[12rem] font-mono text-lg tracking-[0.3em]"
              placeholder="000000"
            />
          </div>

          {error ? <p className="text-sm text-verified">{error}</p> : null}

          <div className="flex flex-wrap gap-3">
            <button type="submit" disabled={busy || code.length < 4} className="btn-primary">
              {busy ? 'Checking…' : 'Verify and start scan'}
            </button>
            <button type="button" onClick={() => setStage('form')} className="btn-quiet">
              Back
            </button>
          </div>
        </form>
      </div>
    );
  }

  const scanning = stage === 'scanning';

  return (
    <div className="mx-auto max-w-3xl space-y-8 px-4 py-12">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {scanning ? 'Scanning…' : 'Your exposure report'}
        </h1>
        {scanning ? (
          <p className="text-muted">
            Results appear as they arrive. You can start reading before it finishes.
          </p>
        ) : (
          <p className="text-muted">
            {summary.verified} confirmed, {summary.likely} likely and {summary.possible} possible
            results.
            {partial ? ' This scan was only partly completed.' : ''}
          </p>
        )}
      </div>

      {partial && !scanning ? (
        <div className="space-y-3 rounded-lg border border-line bg-raised px-4 py-3">
          <p className="text-sm font-medium text-ink">This scan was partly completed.</p>
          <p className="text-sm leading-relaxed text-muted">
            At least one source could not be checked. Anything it might have found is unknown rather
            than absent — do not read this report as an all-clear.
          </p>
          <Explainer educationKey="coverage" />
        </div>
      ) : null}

      <CoveragePanel coverage={coverage} progress={progress} scanning={scanning} />

      {error ? <p className="text-sm text-verified">{error}</p> : null}

      {findings.length === 0 && !scanning ? (
        <div className="card p-6">
          <p className="text-sm font-medium text-ink">Nothing was found in the sources we checked.</p>
          <p className="mt-1.5 text-sm leading-relaxed text-muted">
            That is genuinely good news for those sources, but it is not the whole internet. Open
            the panel above to see exactly what was checked.
          </p>
        </div>
      ) : null}

      {SECTION_ORDER.map((section) => {
        const items = grouped.get(section);
        if (!items || items.length === 0) return null;
        return (
          <section key={section} className="space-y-3">
            <h2 className="text-lg font-semibold tracking-tight">
              {SECTION_LABELS[section]}
              <span className="ml-2 text-sm font-normal text-faint">{items.length}</span>
            </h2>
            <ul className="space-y-2">
              {items.map((finding) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  verdict={verdicts[finding.id]}
                  onVerdict={(verdict) => applyVerdict(finding, verdict)}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {!scanning ? <RemovalSection opportunities={opportunities} /> : null}

      {!scanning ? (
        <div className="space-y-3 border-t border-line pt-6">
          <Explainer educationKey="confidence" />
          <Explainer educationKey="no_passwords" />
          <p className="text-xs leading-relaxed text-faint">
            This report exists only in this browser tab. Closing it discards everything — we kept no
            copy.
          </p>
        </div>
      ) : null}
    </div>
  );
}
