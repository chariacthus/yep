import { devOnlyNotice, logger } from './logger';

/**
 * Sends the verification code.
 *
 * The message is deliberately plain. Somebody who did not request it should be
 * able to read it, understand that no account was created and nothing was
 * searched, and ignore it — because the address field is the one thing on this
 * site that can be filled in by another person.
 */

export interface SendResult {
  ok: boolean;
  reason?: string;
}

function body(code: string): { text: string; html: string } {
  const text = [
    `Your verification code is ${code}`,
    '',
    'It expires in 15 minutes.',
    '',
    'This code was requested on a privacy scanning tool. Entering it starts a',
    'search for public exposure of this email address, and nothing else.',
    '',
    'If you did not request this, no account has been created and no search has',
    'been run. You can ignore this message and nothing will happen.',
  ].join('\n');

  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;line-height:1.6;color:#1a1a1a">
<p>Your verification code is:</p>
<p style="font-size:28px;font-weight:600;letter-spacing:0.15em;font-family:ui-monospace,monospace">${code}</p>
<p>It expires in 15 minutes.</p>
<p style="color:#555">This code was requested on a privacy scanning tool. Entering it starts a search for public exposure of this email address, and nothing else.</p>
<p style="color:#555">If you did not request this, no account has been created and no search has been run. You can ignore this message and nothing will happen.</p>
</body></html>`;

  return { text, html };
}

async function sendViaResend(to: string, code: string, apiKey: string): Promise<SendResult> {
  const { text, html } = body(code);

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: process.env.EMAIL_FROM ?? 'noreply@example.com',
      to: [to],
      subject: `${code} is your verification code`,
      text,
      html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // The address itself is never logged, only the provider's status.
    logger.error('Verification email rejected by provider', { status: response.status });
    return { ok: false, reason: 'The email could not be sent' };
  }
  return { ok: true };
}

/**
 * `to` is the raw address. It is passed straight to the delivery provider and
 * is never logged, stored, or returned.
 */
export async function sendVerificationCode(to: string, code: string): Promise<SendResult> {
  const resendKey = process.env.RESEND_API_KEY;

  if (resendKey) {
    try {
      return await sendViaResend(to, code, resendKey);
    } catch {
      logger.error('Verification email transport failed');
      return { ok: false, reason: 'The email could not be sent' };
    }
  }

  // No transport configured. In development this prints the code so the flow is
  // usable; in production it refuses rather than silently doing nothing.
  if (process.env.NODE_ENV === 'production') {
    logger.error('No email transport is configured; refusing to verify');
    return { ok: false, reason: 'Email delivery is not configured on this deployment' };
  }

  devOnlyNotice(`[dev] verification code: ${code}`);
  return { ok: true };
}

export function emailDeliveryConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY) || process.env.NODE_ENV !== 'production';
}
