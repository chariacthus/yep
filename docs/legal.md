# Legal and licensing notes

Read this before deploying publicly. Some of it is load-bearing.

## Have I Been Pwned

**Review the current [Terms of Use](https://haveibeenpwned.com/TermsOfUse) before
setting `HIBP_API_KEY` in production.** As of September 2026 they restrict
third-party use and prohibit building a "substantially similar breach database
or search engine". Two design decisions in this codebase exist to stay on the
right side of that, but they are not a substitute for reading the terms
yourself, and getting written confirmation from HIBP is advisable:

- **Every search is a self-search.** Email verification is mandatory, so the
  service can only ever be run against an address the user controls.
- **Nothing is cached.** `lib/sources/hibp.ts` holds results for the lifetime of
  one request. There is no store of breach-to-address mappings anywhere, because
  that store would be the prohibited thing.

The Core tier explicitly does not permit acting on behalf of third parties.
Pro adds k-anonymity search, which this code prefers whenever it is available.

Breach data is CC BY licensed; attribution appears on `/about/sources`.

The application works without HIBP configured. That is deliberate — the free
sources carry the product if this integration is not available to you.

## WhatsMyName

`data/wmn-data.json` is CC BY-SA 4.0, © 2015–2026 Micah Hoffman and
contributors. Attribution is on `/about/sources`.

`data/wmn-health.json` is a derivative work of that dataset and should be
distributed under the same licence.

## Data brokers

- The California registry is a public record published by the CPPA.
- `github.com/brianreumere/data-brokers` is BSD-2-Clause.
- We do **not** submit DROP requests on anyone's behalf. No third-party API
  exists for it, and acting as an agent would mean holding identity documents.

## Name frequency data

US Census Bureau surname data is public domain. The given-name frequencies come
from FiveThirtyEight's dataset (CC BY 4.0), attributed on `/about/sources`.

## Search providers

Brave runs its own index and requires attribution. Google's Custom Search JSON
API is closed to new customers and fully deprecated on 1 January 2027, so it is
not an option. Google-scraping SERP APIs carry litigation risk — Google sued
SerpAPI in December 2025 — which is why `ENABLE_SERP_SCRAPER_PROVIDERS` defaults
to `false`.

## Username probing

The sweep sends ordinary unauthenticated GET requests to public profile URLs,
one host at a time, and abandons a host that refuses twice. It reads at most
512 KB and never stores or renders fetched HTML. Some sites' terms discourage
automated access regardless; the concurrency and back-off settings exist to keep
this within the bounds of courteous behaviour, and hosts can be excluded via
`data/wmn-health.json`.

## Positioning

A tool that finds information about a person can be mistaken for a
background-check service, which in the US is FCRA territory. Two things keep
this out of that category, and both must stay:

1. Verification means it only ever runs on the user's own address.
2. The terms shown in the footer prohibit use for employment, tenancy and credit
   screening.

## Data protection

The service processes personal data (an email address, optionally a name and
username). The lawful basis is the user's explicit request. Data minimisation is
structural rather than promised: there is no database, the identity exists only
for the life of one request, and rate-limit keys are irreversible daily-salted
HMACs. If you deploy in the EU or UK, you will still need a privacy notice and,
for HIBP, their Data Processing Addendum.
