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
      where:
        'In the body of an encrypted request — never in a URL, so it cannot reach an access log or a Referer header',
      lifetime: 'The request only',
    },
    {
      stage: 'The scan runs',
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
      stage: 'Your email domain',
      what: 'Only the part after the @, looked up in public DNS',
      where: 'Public DNS resolvers',
      lifetime: 'Transient',
    },
    {
      stage: 'The report',
      what: 'Findings, which refer to "your email address" but never contain it',
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
    <div className="mx-auto max-w-readable space-y-10 py-12">
      <header>
        <h1 className="text-[2rem] font-semibold leading-tight tracking-[-0.03em] sm:text-[2.5rem]">
          What happens to your information
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-muted">
          There are no accounts, no scan history and no email, because there is no database and no
          mail service. Your report exists in your browser tab and nowhere else. This page describes
          exactly what exists at each stage of a scan.
        </p>
      </header>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Stage by stage</h2>
        <ol className="mt-4 space-y-2">
          {stages.map((item, index) => (
            <li key={item.stage} className="glass flex gap-4 p-4 sm:p-5">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/18 text-[0.75rem] font-semibold text-accent-soft">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="text-[1.0625rem] font-medium text-ink">{item.stage}</p>
                <dl className="mt-2 space-y-1.5 text-[0.9375rem] text-muted">
                  <div className="flex gap-3">
                    <dt className="label w-14 shrink-0">What</dt>
                    <dd>{item.what}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="label w-14 shrink-0">Where</dt>
                    <dd>{item.where}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="label w-14 shrink-0">For</dt>
                    <dd>{item.lifetime}</dd>
                  </div>
                </dl>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">No verification, and what follows from it</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          This deployment does not email you a code, so nothing proves that the address you enter is
          yours. That is a deliberate trade — running a mail service costs money — and it has
          consequences we would rather state than hide:
        </p>
        <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed text-muted">
          <li>
            Results from sensitive categories — adult, dating, political, health — are{' '}
            <span className="text-ink">withheld entirely</span>, from everyone. Nobody should be able
            to type a stranger&apos;s username and learn which dating sites they use. The report says
            how many results were withheld.
          </li>
          <li>
            Your report carries a standing note that the details were asserted rather than proved.
            Confidence levels describe how well a result matched what you typed — not whether you are
            the person it belongs to.
          </li>
          <li>
            We do not read public commit history for email addresses, though we could. Without
            verification that would make this a tool for finding other people&apos;s addresses.
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Logging</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          Server logs record a random scan identifier, which sources ran, how long they took and
          whether they failed. They never record your address, name or username. This is enforced by
          a test that runs a real scan with marker values and fails the build if any of them appears
          in the captured output — not merely by our intention to be careful.
        </p>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">Passwords</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          This tool never asks for, retrieves, stores or displays a password, including yours. Where
          a breach included credentials, the report records that fact and nothing else. One of the
          sources we use returns stolen passwords in its API response; our code does not read those
          fields, and a test feeds it a response containing them to confirm none reaches the report.
        </p>
      </section>

      <section>
        <h2 className="text-[1.375rem] font-semibold tracking-[-0.02em]">What this tool is not</h2>
        <p className="mt-3 text-[0.9375rem] leading-relaxed text-muted">
          It is not a background-check or people-search service. Using it for employment, tenancy or
          credit screening is prohibited.
        </p>
      </section>

      <p className="pt-2">
        <Link href="/" className="btn-quiet">
          ← Back to the scanner
        </Link>
      </p>
    </div>
  );
}
