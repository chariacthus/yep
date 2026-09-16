import Link from 'next/link';

export const metadata = {
  title: 'Privacy — Exposure Scanner',
};

/**
 * What happens to the person's information, stage by stage.
 *
 * Written as a factual account of the implementation rather than a policy
 * document, because a privacy tool that is vague about its own data handling
 * has no standing to advise anyone.
 */
export default function PrivacyPage() {
  const stages: Array<{ stage: string; what: string; where: string; lifetime: string }> = [
    {
      stage: 'You submit your details',
      what: 'Your email address, and any optional fields',
      where: 'In the body of an encrypted request — never in a URL, so it cannot reach an access log',
      lifetime: 'The request only',
    },
    {
      stage: 'Verification',
      what: 'A one-way HMAC of your address, and one of the code',
      where: 'A signed, HttpOnly cookie on your own device. We store nothing server-side',
      lifetime: '15 minutes for the code, 1 hour once verified',
    },
    {
      stage: 'The scan',
      what: 'Your address in a variable in memory',
      where: 'The server process handling your request',
      lifetime: 'Until the request ends',
    },
    {
      stage: 'Talking to providers',
      what: 'A partial SHA-1 hash, or a SHA-256 hash, wherever a provider supports it',
      where: 'Sent to Have I Been Pwned and Gravatar respectively',
      lifetime: 'Transient',
    },
    {
      stage: 'Providers needing the address itself',
      what: 'Your full address',
      where: 'Only the providers you left switched on, listed before you start',
      lifetime: 'Transient',
    },
    {
      stage: 'The report',
      what: 'Findings, which reference "your email address" but never contain it',
      where: 'Streamed to your browser and held in the tab',
      lifetime: 'Until you close the tab',
    },
    {
      stage: 'Afterwards',
      what: 'Nothing',
      where: 'No database write, no file, no log line',
      lifetime: '—',
    },
    {
      stage: 'Rate limiting',
      what: 'A daily-salted HMAC of your address and IP — irreversible',
      where: 'A short-lived counter',
      lifetime: 'At most 24 hours',
    },
  ];

  return (
    <div className="mx-auto max-w-3xl space-y-10 px-4 py-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">What happens to your information</h1>
        <p className="leading-relaxed text-muted">
          There are no accounts and no scan history, because there is no database. Your report
          exists in your browser tab and nowhere else. This page describes exactly what exists at
          each stage of a scan.
        </p>
      </header>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Stage by stage</h2>
        <ul className="space-y-2">
          {stages.map((item) => (
            <li key={item.stage} className="card p-4">
              <p className="text-sm font-medium text-ink">{item.stage}</p>
              <dl className="mt-2 space-y-1 text-sm text-muted">
                <div className="flex gap-2">
                  <dt className="shrink-0 text-faint">What:</dt>
                  <dd>{item.what}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-faint">Where:</dt>
                  <dd>{item.where}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 text-faint">For how long:</dt>
                  <dd>{item.lifetime}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Logging</h2>
        <p className="text-sm leading-relaxed text-muted">
          Server logs record a random scan identifier, which sources ran, how long they took and
          whether they failed. They never record your address, name or username. This is enforced by
          a test that runs a real scan with marker values and fails the build if any of them appears
          in the captured output — not merely by our intention to be careful.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">Passwords</h2>
        <p className="text-sm leading-relaxed text-muted">
          This tool never asks for, retrieves, stores or displays a password, including yours. Where
          a breach included credentials, the report records that fact and nothing else. One of the
          sources we use returns stolen passwords in its API response; our code does not read those
          fields, and a test feeds it a response containing them to confirm none reaches the report.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold tracking-tight">What this tool is not</h2>
        <p className="text-sm leading-relaxed text-muted">
          It is not a background-check or people-search service. Email verification means it can
          only be run on an address you control. Using it for employment, tenancy or credit
          screening is prohibited.
        </p>
      </section>

      <p className="text-sm">
        <Link href="/" className="text-accent hover:underline">
          ← Back to the scanner
        </Link>
      </p>
    </div>
  );
}
