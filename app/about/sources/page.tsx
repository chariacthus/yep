import Link from 'next/link';
import { SOURCES } from '@/lib/sources/registry';
import { isConfigured, missingEnv } from '@/lib/sources/types';
import { brokerDirectoryMeta } from '@/lib/sources/brokers';
import { WMN_AUTHORS } from '@/lib/sources/usernames/wmn';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'What we check — Exposure Scanner',
};

/**
 * The honesty page.
 *
 * No single API can search the internet, and a tool that implies otherwise is
 * selling false reassurance. This page states what each source actually covers,
 * whether it is switched on in this deployment, and what we deliberately refuse
 * to use.
 */
export default function SourcesPage() {
  return (
    <div className="mx-auto max-w-readable space-y-10 px-4 py-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">What we check, and what we cannot</h1>
        <p className="leading-relaxed text-muted">
          No service can search the whole internet, and this one does not pretend to. It queries a
          specific set of sources, each with its own coverage and limits. Everything below reflects
          how this particular deployment is configured right now.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Sources</h2>
        <ul className="space-y-2">
          {SOURCES.map((source) => {
            const configured = isConfigured(source);
            return (
              <li key={source.id} className="card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-ink">{source.label}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{source.description}</p>
                    <p className="mt-2 text-xs text-faint">
                      Needs: {source.requires.join(', ')} ·{' '}
                      {source.sendsRawEmail
                        ? 'receives your email address'
                        : 'does not receive your email address'}
                    </p>
                    {!configured ? (
                      <p className="mt-1 text-xs text-faint">
                        Not set up here (missing {missingEnv(source).join(', ')})
                      </p>
                    ) : null}
                  </div>
                  <span
                    className={`shrink-0 text-xs ${configured ? 'text-muted' : 'text-faint'}`}
                  >
                    {configured ? 'Active' : 'Not set up'}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">What we deliberately do not use</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Services that return plaintext passwords</strong> — such as
            Dehashed or Snusbase. This tool never handles credentials, even yours, so a source whose
            value is returning them is of no use to it.
          </li>
          <li>
            <strong className="text-ink">Criminal forums, stolen-data markets and combolists.</strong>{' '}
            Out of scope entirely. We only read from services that publish breach metadata lawfully.
          </li>
          <li>
            <strong className="text-ink">Password-checking endpoints.</strong> Checking a password
            against a breach list means asking you to type one, and we will not do that.
          </li>
          <li>
            <strong className="text-ink">People-search APIs</strong> such as Pipl or Spokeo. Those
            are the data-broker problem itself, and using them to build a profile of somebody is the
            behaviour this tool exists to help you undo.
          </li>
          <li>
            <strong className="text-ink">Scraping people-search sites to confirm a listing.</strong>{' '}
            It breaks their terms, and it would mean searching for a named person — so broker
            entries are presented as removal opportunities, never as detections.
          </li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Data broker directory</h2>
        <p className="text-sm leading-relaxed text-muted">
          {brokerDirectoryMeta.total} brokers, of which {brokerDirectoryMeta.californiaRegisteredCount}{' '}
          are in California&apos;s official registry.{' '}
          {brokerDirectoryMeta.californiaRegistryIncluded
            ? 'The registry was available when this build was made.'
            : 'The California registry could not be fetched when this build was made, so the directory is smaller than it should be.'}
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Credits and licences</h2>
        <ul className="space-y-2 text-sm leading-relaxed text-muted">
          <li>
            Breach data from{' '}
            <a
              className="text-accent hover:underline"
              href="https://haveibeenpwned.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Have I Been Pwned
            </a>
            , used under Creative Commons Attribution.
          </li>
          <li>
            Username site data from the{' '}
            <a
              className="text-accent hover:underline"
              href="https://github.com/WebBreacher/WhatsMyName"
              rel="noopener noreferrer"
              target="_blank"
            >
              WhatsMyName project
            </a>{' '}
            by {WMN_AUTHORS.join(', ')}, licensed CC BY-SA 4.0.
          </li>
          <li>
            Data broker opt-out details from{' '}
            <a
              className="text-accent hover:underline"
              href="https://github.com/brianreumere/data-brokers"
              rel="noopener noreferrer"
              target="_blank"
            >
              brianreumere/data-brokers
            </a>{' '}
            (BSD-2-Clause), and the California Privacy Protection Agency&apos;s public registry.
          </li>
          <li>
            Name frequency data from the US Census Bureau (public domain) and FiveThirtyEight
            (CC BY 4.0).
          </li>
          <li>Infostealer intelligence from Hudson Rock&apos;s free Cavalier API.</li>
        </ul>
      </section>

      <p className="text-sm">
        <Link href="/" className="text-accent hover:underline">
          ← Back to the scanner
        </Link>
      </p>
    </div>
  );
}
