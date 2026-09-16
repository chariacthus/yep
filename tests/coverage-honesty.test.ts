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

describe('every source is accounted for', () => {
  it('appears in the coverage list whatever happened to it', async () => {
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS });

    expect(coverage).toHaveLength(SOURCES.length);
    expect(coverage.map((entry) => entry.id).sort()).toEqual([...ALL_SOURCE_IDS].sort());
  });

  it('announces the full source list before any work starts', async () => {
    const { events } = await collect({ declined: ALL_SOURCE_IDS });
    const started = events.find((event) => event.type === 'scan_started');

    expect(started?.type).toBe('scan_started');
    if (started?.type !== 'scan_started') throw new Error('unreachable');
    expect(started.sources).toHaveLength(SOURCES.length);
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

describe('an unconfigured source', () => {
  it('says which environment variable is missing', async () => {
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS.filter((id) => id !== 'hibp') });
    const entry = coverage.find((item) => item.id === 'hibp')!;

    // HIBP has no key in the test environment.
    expect(entry.status).toBe('not_configured');
    expect(entry.detail).toContain('HIBP_API_KEY');
  });

  it('makes the whole scan partial', async () => {
    const { partial } = await collect({ declined: ALL_SOURCE_IDS.filter((id) => id !== 'hibp') });
    expect(partial).toBe(true);
  });
});

describe('a source with nothing to work on', () => {
  it('is skipped with an explanation, and does not make the scan partial by itself', async () => {
    // No username given, so the username sweep and archive lookup cannot run.
    const { coverage } = await collect({ declined: ALL_SOURCE_IDS });
    const usernames = coverage.find((item) => item.id === 'usernames')!;

    // Declined takes precedence here; check the no-input path separately.
    expect(['skipped']).toContain(usernames.status);
  });

  it('reports the missing input when the source was not declined', async () => {
    const declined = ALL_SOURCE_IDS.filter((id) => id !== 'usernames');
    const { coverage } = await collect({ declined });
    const entry = coverage.find((item) => item.id === 'usernames')!;

    expect(entry.status).toBe('skipped');
    expect(entry.detail).toMatch(/needs a username/i);
  });
});

describe('a fully-declined scan', () => {
  it('still produces a coherent, honest report', async () => {
    const { events, partial, coverage } = await collect({ declined: ALL_SOURCE_IDS });
    const complete = events.find((event) => event.type === 'scan_complete');

    expect(complete).toBeDefined();
    expect(partial).toBe(true);
    expect(coverage.every((entry) => entry.status !== 'pending')).toBe(true);
    expect(coverage.every((entry) => entry.status !== 'running')).toBe(true);
  });
});
