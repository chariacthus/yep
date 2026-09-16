import { NextResponse } from 'next/server';
import { SOURCES } from '@/lib/sources/registry';
import { isConfigured, missingEnv } from '@/lib/sources/types';
import { brokerDirectoryMeta } from '@/lib/sources/brokers';

/**
 * What this deployment can actually check.
 *
 * Powers the consent step and the /about/sources page. Reporting an
 * unconfigured source honestly, before a scan runs, is the difference between
 * "we checked and found nothing" and "we never looked" — and the person
 * deserves to know which one they are getting.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  return NextResponse.json({
    sources: SOURCES.map((source) => ({
      id: source.id,
      label: source.label,
      kind: source.kind,
      description: source.description,
      homepage: source.homepage,
      requires: source.requires,
      sendsRawEmail: source.sendsRawEmail,
      configured: isConfigured(source),
      missingEnv: missingEnv(source),
    })),
    brokerDirectory: brokerDirectoryMeta,
  });
}
