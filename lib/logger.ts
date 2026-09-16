import pino from 'pino';
import { isPrivate, REDACTED } from './identity';

/**
 * The only thing in this codebase allowed to write to stdout.
 *
 * Logs carry a random scan id, source ids, statuses, durations and error
 * classes. They must never carry an email address, a name, a username, a
 * finding body, or a URL built from user input. Two mechanisms enforce that:
 *
 *   - `sanitize` below walks every value and replaces anything that looks like
 *     a wrapped private value, or an address, before it reaches pino.
 *   - tests/logging-canary.test.ts runs a real scan with canary strings and
 *     asserts none of them appear in captured output.
 *
 * The ESLint config bans `console.*` everywhere else in lib/ and app/api/.
 */

const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/g;

/** Keys whose values are redacted outright, whatever they contain. */
const SENSITIVE_KEYS = new Set([
  'email',
  'emailNormalized',
  'name',
  'personName',
  'username',
  'locality',
  'query',
  'q',
  'password',
  'passwords',
  'credential',
  'credentials',
  'secret',
  'token',
  'apiKey',
  'authorization',
  'cookie',
]);

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (isPrivate(value)) return REDACTED;

  if (typeof value === 'string') {
    // Defence in depth: even an unwrapped address never makes it to disk.
    return value.replace(EMAIL_PATTERN, REDACTED);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeValue(value.message, depth + 1) };
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeValue(item, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEYS.has(key) ? REDACTED : sanitizeValue(item, depth + 1);
    }
    return out;
  }
  return '[unserialisable]';
}

export function sanitizeForLog(value: unknown): unknown {
  return sanitizeValue(value);
}

const base = pino({
  level: process.env.LOG_LEVEL ?? (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  // pino's own redaction, as a second layer behind `sanitize`.
  redact: {
    paths: [...SENSITIVE_KEYS].map((key) => `*.${key}`),
    censor: REDACTED,
  },
  base: undefined,
});

type Fields = Record<string, unknown>;

function emit(level: 'debug' | 'info' | 'warn' | 'error', message: string, fields?: Fields): void {
  const clean = fields ? (sanitizeValue(fields) as Fields) : undefined;
  const safeMessage = message.replace(EMAIL_PATTERN, REDACTED);
  if (clean) base[level](clean, safeMessage);
  else base[level](safeMessage);
}

export const logger = {
  debug: (message: string, fields?: Fields) => emit('debug', message, fields),
  info: (message: string, fields?: Fields) => emit('info', message, fields),
  warn: (message: string, fields?: Fields) => emit('warn', message, fields),
  error: (message: string, fields?: Fields) => emit('error', message, fields),
};

/**
 * Used by the development email transport when no delivery provider is
 * configured. Refuses to run in production so a code can never be logged on a
 * live deployment.
 */
export function devOnlyNotice(message: string): void {
  if (process.env.NODE_ENV === 'production') return;
  console.info(message);
}
