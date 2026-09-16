import { z } from 'zod';
import { buildIdentity, looksLikeEmail, normalizeEmail } from '@/lib/identity';
import { logger } from '@/lib/logger';
import { runScan, scanBudgetMs, type ScanEvent } from '@/lib/orchestrator';
import { checkRateLimit, clientIp, RULES } from '@/lib/ratelimit';
import { isVerified } from '@/lib/verification';

/**
 * Runs a scan and streams the results.
 *
 * The whole scan happens inside this one request. Nothing is written to a
 * database, a cache, or a file: the identity lives in a local variable for the
 * lifetime of the request and the findings go straight down the wire to the
 * browser, which assembles the report itself.
 *
 * That is the privacy model in one sentence — there is no scan store, so there
 * is nothing to leak, expire, or hand over.
 */

export const runtime = 'nodejs';
// This request is intentionally long-lived; the sweep streams for minutes.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const schema = z.object({
  email: z.string().min(3).max(254),
  name: z.string().max(120).optional(),
  username: z.string().max(80).optional(),
  locality: z.string().max(120).optional(),
  declinedSources: z.array(z.string().max(40)).max(40).optional(),
});

function encode(event: ScanEvent): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`);
}

function errorStream(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return errorStream('That request was not valid.', 400);

  const { email, name, username, locality } = parsed.data;
  if (!looksLikeEmail(email)) return errorStream('That does not look like an email address.', 400);

  // Verification is not optional. It is what keeps this a tool for checking
  // your own exposure rather than for looking up other people.
  if (!(await isVerified(email))) {
    return errorStream('Verify your email address before scanning.', 403);
  }

  const ip = clientIp(request.headers);
  const [byEmail, byIp] = await Promise.all([
    checkRateLimit(normalizeEmail(email), RULES.scanPerEmail),
    checkRateLimit(ip, RULES.scanPerIp),
  ]);

  if (!byEmail.allowed || !byIp.allowed) {
    const limited = byEmail.allowed ? byIp : byEmail;
    return new Response(JSON.stringify({ error: 'You have run several scans already today.' }), {
      status: 429,
      headers: {
        'content-type': 'application/json',
        'retry-after': String(limited.retryAfterSeconds),
      },
    });
  }

  const identity = buildIdentity({ email, name, username, locality });
  const declinedSources = new Set(parsed.data.declinedSources ?? []);

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const close = () => {
        if (!closed) {
          closed = true;
          controller.close();
        }
      };

      // If the person closes the tab, stop doing work on their behalf.
      request.signal.addEventListener('abort', close);

      try {
        for await (const event of runScan({
          identity,
          emailVerified: true,
          declinedSources,
          budgetMs: scanBudgetMs(),
        })) {
          if (closed || request.signal.aborted) break;
          controller.enqueue(encode(event));
        }
      } catch (error) {
        logger.error('Scan stream failed', { error });
        if (!closed) {
          controller.enqueue(
            encode({
              type: 'scan_complete',
              coverage: [],
              partial: true,
              counts: { findings: 0, removalOpportunities: 0 },
            }),
          );
        }
      } finally {
        close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform',
      connection: 'keep-alive',
      // Stops proxies buffering the stream, which would defeat live progress.
      'x-accel-buffering': 'no',
    },
  });
}
