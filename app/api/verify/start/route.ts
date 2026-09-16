import { NextResponse } from 'next/server';
import { z } from 'zod';
import { looksLikeEmail, normalizeEmail } from '@/lib/identity';
import { logger } from '@/lib/logger';
import { checkRateLimit, clientIp, RULES } from '@/lib/ratelimit';
import { sendVerificationCode } from '@/lib/email';
import { issueChallenge } from '@/lib/verification';

/**
 * Starts email verification.
 *
 * This endpoint is the abuse boundary for the whole product: it is what makes
 * every scan a self-search rather than a lookup of somebody else. It is also
 * the one endpoint that can put a message in a stranger's inbox, so the rate
 * limits here are deliberately tight.
 *
 * The address arrives in the POST body, never a query string, so it cannot end
 * up in an access log or a Referer header.
 */

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().min(3).max(254),
  turnstileToken: z.string().optional(),
});

async function verifyTurnstile(token: string | undefined, ip: string): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true; // Not configured: no bot check to fail.
  if (!token) return false;

  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    logger.warn('Turnstile verification unreachable');
    return false;
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter an email address.' }, { status: 400 });
  }

  const email = parsed.data.email.trim();
  if (!looksLikeEmail(email)) {
    return NextResponse.json({ error: 'That does not look like an email address.' }, { status: 400 });
  }

  const ip = clientIp(request.headers);

  if (!(await verifyTurnstile(parsed.data.turnstileToken, ip))) {
    return NextResponse.json({ error: 'Bot check failed. Please try again.' }, { status: 403 });
  }

  // Both limits are checked. The per-address limit stops one inbox being
  // targeted; the per-IP limit stops one client targeting many inboxes.
  const [byEmail, byIp] = await Promise.all([
    checkRateLimit(normalizeEmail(email), RULES.verificationSendPerEmail),
    checkRateLimit(ip, RULES.verificationSendPerIp),
  ]);

  const limited = !byEmail.allowed ? byEmail : !byIp.allowed ? byIp : null;
  if (limited) {
    return NextResponse.json(
      { error: 'Too many codes requested. Try again later.' },
      { status: 429, headers: { 'retry-after': String(limited.retryAfterSeconds) } },
    );
  }

  const code = await issueChallenge(email);
  const sent = await sendVerificationCode(email, code);

  if (!sent.ok) {
    return NextResponse.json(
      { error: sent.reason ?? 'The code could not be sent.' },
      { status: 502 },
    );
  }

  logger.info('Verification code issued');
  return NextResponse.json({ ok: true });
}
