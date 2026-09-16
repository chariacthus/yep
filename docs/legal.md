# Legal and licensing notes

Read this before deploying publicly. Some of it is load-bearing.

## Email verification is off by default

`REQUIRE_EMAIL_VERIFICATION` defaults to `false`, so no address is ever proved to
belong to the person entering it. This is a cost decision — requiring it means
running a mail service — and it changes the legal posture, so it is recorded
here rather than buried:

- **Sensitive results are withheld from everyone.** HIBP's `IsSensitive`
  breaches and the adult, dating, political and health username categories are
  never returned while verification is off. The count of withheld results is
  reported, so the omission is visible rather than silent.
- **Commit-history email mining is not implemented**, though it would work and
  would be useful. Without verification it would make this a tool for finding
  other people's addresses.
- **The affirmation checkbox** on the form is what the screening prohibition
  rests on. It is weak, and it is deliberate that it is explicit.
- **Turn verification on before enabling HIBP.** See below.

## Have I Been Pwned

**Review the current [Terms of Use](https://haveibeenpwned.com/TermsOfUse) before
setting `HIBP_API_KEY` in production.** As of September 2026 they restrict
third-party use and prohibit building a "substantially similar breach database
or search engine". Two design decisions in this codebase exist to stay on the
right side of that, but they are not a substitute for reading the terms
yourself, and getting written confirmation from HIBP is advisable:

- **Every search should be a self-search.** Set
  `REQUIRE_EMAIL_VERIFICATION=true` alongside `HIBP_API_KEY`, so the service can
  only be run against an address the user controls.
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

## LeakCheck

The public API is keyless and their terms permit commercial use in exchange for
a "Powered by LeakCheck" link, which appears on `/about/sources`. Keep it there.

It returns breach names and data categories only — there is no endpoint on the
public tier that could return a credential even if we asked for one.

## The HIBP breach catalogue

`GET /api/v3/breaches` needs no API key; only the per-address lookups do. The app
uses the catalogue unconditionally to describe breaches found by other sources,
which is within the documented terms and is attributed under CC BY on
`/about/sources`. Nothing is cached per-address, so this does not build the
"substantially similar breach database" the terms prohibit — it caches the public
catalogue, which is the same thing their own website serves.

## The keyless profile sources

GitLab, Docker Hub, npm, Bitbucket, RubyGems, Packagist and Hex.pm are queried
through their public, documented APIs with no authentication, at one request each
per scan. Nothing is scraped and no rate limit is pressed.

Addresses discovered on those public profiles are **masked** before they reach
the report, unless they match the address being scanned. The profile is public
either way, but returning the full address in a machine-readable report would
make this a convenient harvester.

PyPI is deliberately absent: its user pages answer HTTP 200 for every username,
so an existence check there would report a false positive on every scan.

## Positioning

A tool that finds information about a person can be mistaken for a
background-check service, which in the US is FCRA territory. Three things keep
this out of that category, and all must stay:

1. The affirmation checkbox, and — where verification is enabled — proof that
   the address belongs to the user.
2. Sensitive-category results are withheld while ownership is unproved.
3. The terms shown in the footer prohibit use for employment, tenancy and credit
   screening.

## Data protection

The service processes personal data (an email address, optionally a name and
username). The lawful basis is the user's explicit request. Data minimisation is
structural rather than promised: there is no database, the identity exists only
for the life of one request, and rate-limit keys are irreversible daily-salted
HMACs. If you deploy in the EU or UK, you will still need a privacy notice and,
for HIBP, their Data Processing Addendum.
