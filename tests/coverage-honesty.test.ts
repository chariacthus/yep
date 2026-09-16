import { describe, expect, it } from 'vitest';
import { buildIdentity } from '@/lib/identity';
import { runScan, type CoverageEntry, type ScanEvent } from '@/lib/orchestrator';
import { SOURCES } from '@/lib/sources/registry';

/**
 * The report must never imply it looked somewhere it did not.
 *
 * A scan that could not reach four of its sources has not "found nothing" -- it
 * has not looked. These tests pin the behaviour that keeps that distinction
 * visible, because it is the difference between a useful report and a false
 * reassurance.
 */

async function collect(options: {
  declined?: string[];
  username?: string;
  name?: string;
}): Promise<{ events: ScanEvent[]; coverage: CoverageEntry[]; partial: boolean }> {
  const events: ScanEvent[] = [];
  let coverage: CoverageEntry[] = [];
  let partial = false;

  for await (const event of runScan({
    identity: buildIdentity({
      email: 'subject@example.test',
      name: options.name,
      username: options.username,
    }),
    emailVerified: true,
    declinedSources: new Set(options.declined ?? []),
    budgetMs: 8000,
  })) {
    events.push(event);
    if (event.type === 'scan_complete') {
      coverage = event.coverage;
      partial = event.partial;
    }
  }

  return { events, coverage, partial };
}

const ALL_SOURCE_IDS = SOURCES.map((source) => source.id);

/**
 * Sources needing an API key this deployment does not have are left out of the
 * scan entirely. They are not a gap in coverage — they were never part of it —
 * and counting them made every run report itself as half-finished.
 */
const RUNNABLE_SOURCE_IDS = SOURCES.filter((source) => source.requiredEnv.length === 0).map(
  (source) => source.id,
);

describe('every source that can run is accounted for', () => {
  it('appears in the coverage list whatever happened to it', async () => {
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS });

    expect(coverage).toHaveLength(RUNNABLE_SOURCE_IDS.length);
    expect(coverage.map((entry) => entry.id).sort()).toEqual([...RUNNABLE_SOURCE_IDS].sort());
  });

  it('announces the list before any work starts', async () => {
    const { events } = await collect({ declined: ALL_SOURCE_IDS });
    const started = events.find((event) => event.type === 'scan_started');

    expect(started?.type).toBe('scan_started');
    if (started?.type !== 'scan_started') throw new Error('unreachable');
    expect(started.sources).toHaveLength(RUNNABLE_SOURCE_IDS.length);
  });
});

describe('declining a source', () => {
  it('is reported as skipped, with the reason, rather than hidden', async () => {
    const { coverage } = await collect({ declined: ['xposedornot'] });
    const entry = coverage.find((item) => item.id === 'xposedornot')!;

    expect(entry.status).toBe('skipped');
    expect(entry.detail).toMatch(/chose not to share/i);
  });

  it('means the source produces no findings at all', async () => {
    const { events } = await collect({ declined: ALL_SOURCE_IDS });
    expect(events.filter((event) => event.type === 'finding')).toHaveLength(0);
  });
});

describe('a source needing an API key nobody has', () => {
  it('is left out of the scan rather than reported as a gap', async () => {
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS });

    // HIBP's account lookup has no key in the test environment.
    expect(coverage.find((entry) => entry.id === 'hibp')).toBeUndefined();
    expect(coverage.some((entry) => entry.status === 'not_configured')).toBe(false);
  });

  it('does not on its own make a scan partial', async () => {
    // Every runnable source declined, so the only reason to be partial would be
    // the absent paid ones. Declining is itself a gap, so assert the reason.
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS });
    expect(coverage.every((entry) => entry.status === 'skipped')).toBe(true);
  });
});

describe('a source with nothing to work on', () => {
  it('is skipped with an explanation', async () => {
    // The broker directory indexes people by name, and no name was given.
    const declined = ALL_SOURCE_IDS.filter((id) => id !== 'brokers');
    const { coverage } = await collect({ declined });
    const entry = coverage.find((item) => item.id === 'brokers')!;

    expect(entry.status).toBe('skipped');
    expect(entry.detail).toMatch(/name/i);
  });
});

describe('a fully-declined scan', () => {
  it('still produces a coherent, honest report', async () => {
    const { events, partial, coverage } = await collect({ declined: ALL_SOURCE_IDS });
    const complete = events.find((event) => event.type === 'scan_complete');

    expect(complete).toBeDefined();
    // Declining every source really is a gap, and must be reported as one.
    expect(partial).toBe(true);
    expect(coverage.every((entry) => entry.status !== 'pending')).toBe(true);
    expect(coverage.every((entry) => entry.status !== 'running')).toBe(true);
  });
});

describe('handles derived from the email address', () => {
  it('lets a scan with no username reach the username sources', async () => {
    // Nothing but an address is given, yet the sweep still has something to
    // search for — which is the whole point of deriving handles.
    const declined = ALL_SOURCE_IDS.filter((id) => id !== 'usernames');
    const { coverage } = await collect({ declined });
    const entry = coverage.find((item) => item.id === 'usernames')!;

    expect(entry.status).not.toBe('skipped');
  });
});
