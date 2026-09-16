import { rateLimitKey } from './crypto';
import { logger } from './logger';

/**
 * Sliding-window rate limiting.
 *
 * Keys are HMACs salted with the current date, so the store never holds a
 * reversible email address or IP. Upstash Redis is used when configured; the
 * in-memory fallback is correct for a single process and is fine for local
 * development, but does not hold across serverless instances -- production
 * deployments should set the Upstash variables.
 */

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Maximum events permitted inside the window. */
  limit: number;
  windowSeconds: number;
  /** Distinguishes counters so an email limit cannot consume an IP limit. */
  purpose: string;
}

function limitFrom(name: string, fallback: number): number {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : fallback;
}

/**
 * Defaults sized for a public deployment, but not so tight that somebody
 * running this for themselves trips over them: re-scanning after adding a
 * username, or checking a second address, is normal use rather than abuse.
 *
 * The verification limits stay strict whatever else changes, because that is
 * the one endpoint that can put a message in a stranger's inbox.
 */
export const RULES = {
  verificationSendPerEmail: { limit: 3, windowSeconds: 3600, purpose: 'verify-email' },
  verificationSendPerIp: { limit: 10, windowSeconds: 3600, purpose: 'verify-ip' },
  scanPerEmail: {
    limit: limitFrom('SCAN_LIMIT_PER_EMAIL_PER_DAY', 20),
    windowSeconds: 86_400,
    purpose: 'scan-email',
  },
  scanPerIp: {
    limit: limitFrom('SCAN_LIMIT_PER_IP_PER_DAY', 100),
    windowSeconds: 86_400,
    purpose: 'scan-ip',
  },
} satisfies Record<string, RateLimitRule>;

const memory = new Map<string, number[]>();

function checkInMemory(key: string, rule: RateLimitRule, now: number): RateLimitResult {
  const windowMs = rule.windowSeconds * 1000;
  const hits = (memory.get(key) ?? []).filter((at) => at > now - windowMs);

  if (hits.length >= rule.limit) {
    const oldest = hits[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)),
    };
  }

  hits.push(now);
  memory.set(key, hits);

  // Opportunistic cleanup so the map cannot grow without bound.
  if (memory.size > 10_000) {
    for (const [existingKey, timestamps] of memory) {
      if (timestamps.every((at) => at <= now - windowMs)) memory.delete(existingKey);
    }
  }

  return { allowed: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
}

async function checkUpstash(
  key: string,
  rule: RateLimitRule,
  now: number,
  url: string,
  token: string,
): Promise<RateLimitResult> {
  const windowMs = rule.windowSeconds * 1000;
  const member = `${now}-${Math.random().toString(36).slice(2, 8)}`;

  // One round trip: drop expired members, add this one, count, reset the TTL.
  const pipeline = [
    ['ZREMRANGEBYSCORE', key, '0', String(now - windowMs)],
    ['ZADD', key, String(now), member],
    ['ZCARD', key],
    ['EXPIRE', key, String(rule.windowSeconds)],
  ];

  const response = await fetch(`${url}/pipeline`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(pipeline),
    signal: AbortSignal.timeout(3000),
  });

  if (!response.ok) throw new Error(`Upstash responded ${response.status}`);

  const results = (await response.json()) as Array<{ result: unknown }>;
  const count = Number(results[2]?.result ?? 0);

  if (count > rule.limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: rule.windowSeconds };
  }
  return { allowed: true, remaining: Math.max(0, rule.limit - count), retryAfterSeconds: 0 };
}

/**
 * `subject` is a raw email or IP. It is hashed here and never stored in the
 * clear -- callers do not need to pre-hash it.
 */
export async function checkRateLimit(
  subject: string,
  rule: RateLimitRule,
): Promise<RateLimitResult> {
  const key = `rl:${rule.purpose}:${rateLimitKey(subject, rule.purpose)}`;
  const now = Date.now();

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (url && token) {
    try {
      return await checkUpstash(key, rule, now, url, token);
    } catch (error) {
      // A rate limiter that fails open is better than an outage, but it is a
      // real degradation and must be visible in the logs.
      logger.error('Rate limit store unavailable, falling back to in-process counter', {
        purpose: rule.purpose,
        error,
      });
    }
  }

  return checkInMemory(key, rule, now);
}

/** Best-effort client IP from proxy headers. Only ever used hashed. */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return headers.get('x-real-ip') ?? '0.0.0.0';
}
