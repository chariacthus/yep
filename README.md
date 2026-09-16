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
5. **Self-search only.** Email ownership is verified before any result is shown.

## Quick start

```bash
npm install
cp .env.example .env.local     # set APP_SECRET at minimum
npm run dev
```

Only `APP_SECRET` is required to run locally. With no provider keys at all the
app still works end to end and reports honestly that most sources were not
checked — which is the behaviour worth seeing first.

In development, verification codes are printed to the server log instead of
being emailed.

## How a scan works

```
Browser ──POST /api/verify/start───▶ emails a code, sets a signed cookie
Browser ──POST /api/verify/confirm─▶ sets a verified cookie (no server state)
Browser ──POST /api/scan ──────────▶ orchestrator
                                      ├─ runs every configured source at once
                                      ├─ normalises → scores → attaches actions
                                      └─ streams SSE events as they happen
Browser assembles the report in memory.
```

The whole scan happens inside one long-lived request. There is no job queue and
no scan store, which removes an entire class of privacy risk: there is nothing
to leak, expire, or hand over.

## Confidence

Every finding carries the signals that produced its level, rendered in plain
language in the report. Three caps override the score unconditionally
(`lib/confidence/score.ts`):

1. A finding whose only link to the person is a **name** can never exceed
   *possible*.
2. A **username-only** hit stays at *possible* until something independent
   corroborates it.
3. ***Verified*** requires a match on the address the person proved they own, or
   their own explicit confirmation.

Common names are discounted using published frequency data, so "John Smith" is
penalised and a rare name is not. Where the system cannot tell, it asks: every
uncertain finding has an *"Is this you?"* control, and the answer stays in the
browser.

## Sources

| Source | Needs a key | Gets your address |
|---|---|---|
| Gravatar | optional | no — SHA-256 hash only |
| Have I Been Pwned | yes | no, with Pro k-anonymity; yes on fallback |
| XposedOrNot | no | yes |
| Hudson Rock (infostealers) | no | yes |
| keys.openpgp.org | no | yes |
| GitHub | optional | no |
| Internet Archive | no | no |
| Brave Search | yes | no |
| Username sweep (~700 sites) | no | no |
| Data broker directory | no | no — local lookup |

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

Two of these are the actual safety controls rather than documentation of intent:

- `tests/no-credentials.test.ts` feeds the Hudson Rock adapter a response
  containing real-shaped stolen passwords — that API genuinely returns them —
  and fails if any marker survives into a finding.
- `tests/logging-canary.test.ts` runs a real scan with marker values and fails
  if any of them reaches stdout.

`tests/coverage-honesty.test.ts` pins the rule that a scan which could not check
something never reports itself as complete.

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
