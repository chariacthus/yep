import { describeError, HttpError } from './http';
import type { Handle, ScanContext, SourceOutcome } from './types';

/**
 * Run a per-handle check across every handle in the scan.
 *
 * Adapters used to look at `handles[0]` only, which quietly meant that a handle
 * built from someone's name never reached GitHub, GitLab or Docker Hub — the
 * exact places a forgotten account under a real name tends to sit. These are
 * single-request lookups, so checking all of them costs little.
 *
 * `check` returns how many findings it emitted, and is free to throw. One
 * handle failing does not invalidate the rest, but a run that only half
 * completed is reported as partial rather than as a clean result.
 */
export async function sweepHandles(
  context: ScanContext,
  check: (handle: Handle) => Promise<number>,
  options: { rateLimitStatuses?: readonly number[] } = {},
): Promise<SourceOutcome> {
  const rateLimited = options.rateLimitStatuses ?? [429, 403];
  const total = context.handles.length;

  let checked = 0;
  let completed = 0;
  let lastError: unknown;

  for (const handle of context.handles) {
    try {
      checked += await check(handle);
      completed += 1;
    } catch (error) {
      // A rate limit applies to the whole source, so there is no point
      // continuing with the remaining handles.
      if (error instanceof HttpError && rateLimited.includes(error.status)) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      lastError = error;
    }
  }

  if (completed === 0) return { status: 'failed', reason: describeError(lastError) };
  if (completed < total) {
    return { status: 'partial', checked, total, reason: describeError(lastError) };
  }
  return { status: 'ok', checked };
}
