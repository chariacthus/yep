# Exposure Scanner

A privacy tool that helps someone find out where **their own** information is
publicly exposed — breaches, public profiles, old accounts, archived pages — and
then explains what each result means and what they can do about it.

It is built around five rules that shaped nearly every technical decision here:

1. **Never touch credentials.** No password is collected, retrieved, stored or
   displayed. A breach finding can say *"password credentials were included"*.
   It can never say more than that.
2. **Never fabricate.** There is no demo data. If a source is unconfigured,
   rate-limited or broken, the report says so and marks itself partial.
3. **Never over-claim a match.** Confidence is explicit, explained, and capped.
   A name-only match is never presented as the person.
4. **Never retain.** There is no database. The submitted identity lives in one
   request and the report lives in the browser tab.
5. **Never withhold silently.** Results that are held back, sources that could
   not be reached and sites that gave no answer are all counted and reported.

## Quick start

```bash
npm install
npm run dev
```

Then open <http://localhost:3000>. That is the whole setup — no `.env` file, no
account, no email service, no API keys, no cost.

Eleven of the fifteen sources run with no configuration at all. The other four
need a paid key and report themselves as "not set up" in the report rather than
failing quietly, so a scan without them is still useful and still honest about
what it could not reach.

For a real deployment, set `APP_SECRET` to a random value
(`openssl rand -base64 32`). Without it the app generates a temporary one per
process, which works fine but means rate-limit counters are not shared between
instances and reset on restart.

## How a scan works

```
Browser ──POST /api/scan ──▶ orchestrator
                              ├─ runs every configured source at once
                              ├─ normalises → scores → attaches actions
                              └─ streams SSE events as they happen
Browser assembles the report in memory.
```

The whole scan happens inside one long-lived request. There is no job queue and
no scan store, which removes an entire class of privacy risk: there is nothing
to leak, expire, or hand over.

## Confidence

Confidence answers exactly one question: **does this finding match the
identifiers that were entered?** It deliberately does not answer "does this
person own those identifiers" — conflating the two produces nonsense in both
directions. If somebody types an address that really is in a breach, the match
is certain; what is unproven is that the address is theirs. That caveat appears
once at the top of the report instead of being smeared across every finding.

Every finding carries the signals that produced its level, in plain language.
Three caps override the score unconditionally (`lib/confidence/score.ts`):

1. A finding whose only link to the person is a **name** can never exceed
   *possible*.
2. A **username-only** hit stays at *possible* until something independent
   corroborates it.
3. ***Confirmed*** requires an exact match on an identifier that was actually
   entered. Weak signals cannot accumulate their way to certainty.

Common names are discounted using published frequency data, so "John Smith" is
penalised and a rare name is not. Where the system cannot tell, it asks: every
uncertain finding has an *"Is this you?"* control, and the answer stays in the
browser.

## Sources

| Source | Needs a key | Gets your address |
|---|---|---|
| Gravatar | optional | no — SHA-256 hash only |
| GitLab | no | no |
| Have I Been Pwned | yes | no, with Pro k-anonymity; yes on fallback |
| XposedOrNot | no | yes |
| Hudson Rock (infostealers) | no | yes |
| keys.openpgp.org | no | yes |
| Email domain (MX/SPF/DMARC) | no | no — the domain part only |
| GitHub | optional | no |
| Bitbucket | no | no |
| Docker Hub | no | no |
| npm registry | no | no |
| Internet Archive | no | no |
| Brave Search | yes | no |
| Username sweep (~700 sites) | no | no |
| Data broker directory | no | no — local lookup |

An address found on somebody's public profile is **masked** in the report unless
it matches the one being scanned. The page is public either way, but returning
the full address in a machine-readable report would make this a harvester.

**PyPI is deliberately absent.** Its user pages answer HTTP 200 for every
username, real or not, so an existence check there would have reported a match
for every person who ever ran a scan.

Sources that receive the raw address are listed in the UI before the scan
starts, with a toggle for each. Declining one is reported as skipped, not hidden.

`/about/sources` shows what is switched on in a given deployment, and what we
deliberately refuse to use and why.

### Data brokers are not detections

We cannot confirm somebody is listed on a people-search site without scraping
it — which breaks those sites' terms and is exactly the look-up-a-stranger
behaviour this tool exists to oppose. So brokers appear as **removal
opportunities**, clearly labelled as not being detections, with a working
opt-out link each and California's DROP platform as the headline action.

## Tests

```bash
npm test          # unit and contract tests
npm run test:e2e  # Playwright
```

Three of these are the actual safety controls rather than documentation of
intent:

- `tests/no-credentials.test.ts` feeds the Hudson Rock adapter a response
  containing real-shaped stolen passwords — that API genuinely returns them —
  and fails if any marker survives into a finding.
- `tests/logging-canary.test.ts` runs a real scan with marker values and fails
  if any of them reaches stdout.
- `tests/coverage-honesty.test.ts` pins the rule that a scan which could not
  check something never reports itself as complete — including the case where
  every source was declined.

`tests/new-sources.test.ts` covers the keyless profile sources against recorded
response shapes, with particular attention to how each API signals "no such
user". Each does it differently, and getting it wrong means a confident false
positive on every scan.

## Regenerating the vendored data

```bash
npm run data:wmn            # refresh the WhatsMyName site list
npm run data:wmn:validate   # re-test detection logic; needs network, takes minutes
npm run data:brokers        # rebuild the broker directory
npx tsx scripts/build-names.ts
```

`data:wmn:validate` is the largest false-positive control in the username sweep:
it re-tests every site against the known-good usernames the dataset ships and
excludes any whose detection logic has rotted. Run it on a schedule.

## Deployment

Any Node host. The constraint is the username sweep: `SCAN_BUDGET_MS` defaults
to 240s and must stay below the platform's function timeout (Vercel Pro caps at
300s). When the budget expires the scan reports *"checked 540 of 709 sites"*
rather than stopping quietly. A long-running container removes the cap.

See `.env.example` for configuration and **[docs/legal.md](docs/legal.md)** for
licensing and terms — in particular, read HIBP's Terms of Use before enabling
that integration in production.
