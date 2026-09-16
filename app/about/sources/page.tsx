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
    <div className="mx-auto max-w-readable space-y-10 py-12">
      <header>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.5rem]">
          What we check, and what we cannot
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted">
          No service can search the whole internet, and this one does not pretend to. It queries a
          specific set of sources, each with its own coverage and limits. Everything below reflects
          how this particular deployment is configured right now.
        </p>
      </header>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Sources</h2>
        <ul className="mt-4 space-y-2">
          {SOURCES.map((source) => {
            const configured = isConfigured(source);
            return (
              <li key={source.id} className="glass flex items-start justify-between gap-5 p-4 sm:p-5">
                <div className="min-w-0">
                  <p className="text-[1.0625rem] font-medium text-ink">{source.label}</p>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted">
                    {source.description}
                  </p>
                  <p className="mt-2 text-[0.75rem] text-faint">
                    Needs {source.requires.join(' + ')} ·{' '}
                    {source.sendsRawEmail
                      ? 'receives your email address'
                      : 'never receives your email address'}
                    {!configured ? ` · missing ${missingEnv(source).join(', ')}` : ''}
                  </p>
                </div>
                <span
                  className={`pill shrink-0 ${configured ? 'bg-good/15 text-good' : 'text-faint'}`}
                >
                  {configured ? 'Active' : 'Not set up'}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">How we pick what to check</h2>
        <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">Handles have to earn the full sweep.</strong> The one you
            type is always swept. Ones we build from your address or name are first tried against
            about forty mainstream sites; if a guess exists on none of them, we drop it rather than
            make seven hundred more requests for a string we invented.
          </li>
          <li>
            <strong className="text-ink">Your name and town raise confidence, never results.</strong>{' '}
            They are matched against what a profile already publishes. A town only counts once the
            name has matched — plenty of strangers live in yours.
          </li>
          <li>
            <strong className="text-ink">A username match alone stays &ldquo;possible&rdquo;.</strong>{' '}
            Handles are not unique. Something else has to line up before a result is called likely.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">What we deliberately do not use</h2>
        <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-muted">
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
          <li>
            <strong className="text-ink">Mining public commit history for email addresses.</strong>{' '}
            Code-hosting platforms expose the address attached to every public commit. It would be a
            genuinely useful finding, and it is also precisely what an email harvester would want.
            Since this deployment does not verify that you own the address you enter, building it
            would make this a tool for finding other people&apos;s addresses. Excluded.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Tried and rejected</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          Sources we built against and then dropped, because testing showed they could not give an
          honest answer.
        </p>
        <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-muted">
          <li>
            <strong className="text-ink">PyPI.</strong> Its user pages answer HTTP 200 for every
            username, real or not, because they sit behind a bot challenge. A simple existence check
            would have reported a match for every single person who ever ran a scan. There is no way
            to tell a real account from a fictional one without solving the challenge, so it is not
            used at all.
          </li>
          <li>
            <strong className="text-ink">Sites that block automated requests outright.</strong> Where
            a source cannot be reached from a server, it is not listed as a source. A check that
            always fails quietly is worse than no check, because its silence reads as a clean result.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Data broker directory</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          {brokerDirectoryMeta.total} brokers, of which {brokerDirectoryMeta.californiaRegisteredCount}{' '}
          are in California&apos;s official registry.{' '}
          {brokerDirectoryMeta.californiaRegistryIncluded
            ? 'The registry was available when this build was made.'
            : 'The California registry could not be fetched when this build was made, so the directory is smaller than it should be.'}
        </p>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Credits and licences</h2>
        <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-muted">
          <li>
            Breach descriptions, dates and data categories from{' '}
            <a
              className="text-accent hover:underline"
              href="https://haveibeenpwned.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              Have I Been Pwned
            </a>
            , used under Creative Commons Attribution. Their breach catalogue is public and needs
            no API key, which is why every breach we find comes with a real description and a link
            even though we hold no subscription.
          </li>
          <li>
            Breach lookups powered by{' '}
            <a
              className="text-accent hover:underline"
              href="https://leakcheck.io"
              rel="noopener noreferrer"
              target="_blank"
            >
              LeakCheck
            </a>{' '}
            and{' '}
            <a
              className="text-accent hover:underline"
              href="https://xposedornot.com"
              rel="noopener noreferrer"
              target="_blank"
            >
              XposedOrNot
            </a>
            , both free and keyless.
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
            Web search via{' '}
            <a
              className="text-accent hover:underline"
              href="https://searxng.org"
              rel="noopener noreferrer"
              target="_blank"
            >
              SearXNG
            </a>
            , open-source metasearch that needs no API key.
          </li>
          <li>
            Name frequency data from the US Census Bureau (public domain) and FiveThirtyEight
            (CC BY 4.0).
          </li>
          <li>Infostealer intelligence from Hudson Rock&apos;s free Cavalier API.</li>
        </ul>
      </section>

      <p className="pt-2">
        <Link href="/" className="btn-quiet">
          ← Back to the scanner
        </Link>
      </p>
    </div>
  );
}
