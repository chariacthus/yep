import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logger } from '@/lib/logger';
import { confirmChallenge } from '@/lib/verification';

export const runtime = 'nodejs';

const schema = z.object({
  email: z.string().min(3).max(254),
  code: z.string().min(4).max(10),
});

const MESSAGES: Record<string, string> = {
  expired: 'That code has expired. Request a new one.',
  mismatch: 'That code was issued for a different address.',
  wrong_code: 'That code is not right. Check it and try again.',
  too_many_attempts: 'Too many incorrect attempts. Request a new code.',
};

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Enter the code from your email.' }, { status: 400 });
  }

  const result = await confirmChallenge(parsed.data.email, parsed.data.code);

  if (!result.ok) {
    logger.info('Verification attempt rejected', { reason: result.reason });
    return NextResponse.json(
      { error: MESSAGES[result.reason] ?? 'That code could not be confirmed.' },
      { status: 400 },
    );
  }

  logger.info('Email verified');
  return NextResponse.json({ ok: true });
}
