import { logger } from '../logger';

/**
 * Outbound HTTP shared by every source.
 *
 * Centralised so that timeouts, the user agent, body-size caps and the
 * never-log-a-URL-containing-user-input rule are applied uniformly rather than
 * remembered separately in nine adapters.
 */

export const USER_AGENT =
  'ExposureScanner/0.1 (privacy self-assessment tool; +https://github.com/chariacthus/yep)';

/** Reading more than this from a probe response is never necessary. */
export const MAX_BODY_BYTES = 512 * 1024;

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(`Upstream responded ${status}`);
    this.name = 'HttpError';
  }
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Redirects are not followed by default; probes care about the first status. */
  redirect?: RequestRedirect;
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return seconds;
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  return undefined;
}

/**
 * `url` frequently contains the person's email or username, so it is never
 * logged. Only the host is, and only on failure.
 */
export async function request(url: string, options: FetchOptions = {}): Promise<Response> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 8000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

  const response = await fetch(url, {
    method: options.method ?? 'GET',
    headers: { 'user-agent': USER_AGENT, accept: 'application/json', ...options.headers },
    body: options.body,
    redirect: options.redirect ?? 'manual',
    signal,
  });

  if (response.status === 429 || response.status === 503) {
    throw new HttpError(response.status, parseRetryAfter(response.headers.get('retry-after')));
  }
  return response;
}

export async function requestJson<T>(url: string, options: FetchOptions = {}): Promise<T | null> {
  const response = await request(url, options);

  // A 404 is a legitimate "no data for this subject" from most of these APIs.
  if (response.status === 404) return null;
  if (!response.ok) throw new HttpError(response.status);

  return (await response.json()) as T;
}

/** Reads at most MAX_BODY_BYTES, so a hostile or enormous page cannot exhaust memory. */
export async function readBodyCapped(response: Response, limit = MAX_BODY_BYTES): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';

  const decoder = new TextDecoder();
  let text = '';
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (total >= limit) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return text;
}

export function describeError(error: unknown): string {
  if (error instanceof HttpError) {
    return error.status === 429
      ? 'The provider rate-limited us'
      : `The provider returned an error (${error.status})`;
  }
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'The provider did not respond in time';
    }
    return 'Could not reach the provider';
  }
  return 'Unknown error';
}

export function logSourceFailure(sourceId: string, error: unknown): void {
  logger.warn('Source failed', {
    sourceId,
    error: error instanceof Error ? { name: error.name, message: error.message } : 'unknown',
  });
}
