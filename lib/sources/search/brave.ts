import { reveal } from '../../identity';
import { assessConfidence } from '../../confidence/score';
import type { SignalId } from '../../confidence/signals';
import { describeError, HttpError, requestJson } from '../http';
import type { Emit, ScanContext, Source, SourceOutcome } from '../types';

/**
 * Brave Search.
 *
 * Chosen over the Google-backed SERP APIs for two reasons: Brave runs its own
 * index rather than scraping Google, which avoids the legal exposure that
 * scraping APIs carry, and it does not require sending anything beyond the
 * query itself.
 *
 * Search results are the weakest evidence in the report. A name query returns
 * whoever shares that name, so results here are capped at "possible" unless the
 * query was for something genuinely identifying. The confidence engine enforces
 * that; this adapter only reports which signals apply.
 *
 * Attribution is required by Brave's terms and appears on /about/sources.
 */

const API = 'https://api.search.brave.com/res/v1/web/search';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
  age?: string;
  page_age?: string;
}

interface BraveResponse {
  web?: { results?: BraveResult[] };
}

interface Query {
  text: string;
  /** What the query actually pins the result to. */
  basis: 'email' | 'username' | 'name' | 'name_locality';
}

function buildQueries(context: ScanContext): Query[] {
  const queries: Query[] = [];
  const name = context.identity.name ? reveal(context.identity.name) : undefined;
  const username = context.identity.username ? reveal(context.identity.username) : undefined;
  const locality = context.identity.locality ? reveal(context.identity.locality) : undefined;

  // The address is only ever queried once the person has proved it is theirs.
  if (context.emailVerified) {
    queries.push({ text: `"${reveal(context.identity.emailNormalized)}"`, basis: 'email' });
  }
  if (username) queries.push({ text: `"${username}"`, basis: 'username' });
  if (name && locality) queries.push({ text: `"${name}" "${locality}"`, basis: 'name_locality' });
  else if (name) queries.push({ text: `"${name}"`, basis: 'name' });

  return queries;
}

function signalsFor(basis: Query['basis'], emailVerified: boolean): SignalId[] {
  switch (basis) {
    case 'email':
      return ['email_exact'];
    case 'username':
      return ['username_exact'];
    case 'name_locality':
      return ['name_plus_locality'];
    default:
      return ['name_exact'];
  }
}

const RESULTS_PER_QUERY = 8;

export const braveSearchSource: Source = {
  id: 'brave',
  label: 'Brave Search',
  kind: 'search',
  description:
    'Searches an independent web index for pages mentioning your details. Name searches are the weakest evidence here and are never treated as confirmed.',
  homepage: 'https://brave.com/search/api/',
  requires: ['name'],
  sendsRawEmail: false,
  requiredEnv: ['BRAVE_SEARCH_API_KEY'],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const key = process.env.BRAVE_SEARCH_API_KEY;
    if (!key) return { status: 'not_configured', missing: ['BRAVE_SEARCH_API_KEY'] };

    const queries = buildQueries(context);
    if (queries.length === 0) return { status: 'skipped', reason: 'Nothing to search for' };

    const seen = new Set<string>();
    let emitted = 0;
    let failures = 0;

    for (const query of queries) {
      if (Date.now() > context.deadline) {
        return {
          status: 'partial',
          checked: queries.indexOf(query),
          total: queries.length,
          reason: 'The scan ran out of time before every search was run',
        };
      }

      try {
        const response = await requestJson<BraveResponse>(
          `${API}?q=${encodeURIComponent(query.text)}&count=${RESULTS_PER_QUERY}`,
          {
            headers: { 'x-subscription-token': key, accept: 'application/json' },
            signal: context.signal,
            timeoutMs: 10_000,
          },
        );

        for (const result of response?.web?.results ?? []) {
          if (!result.url || seen.has(result.url)) continue;
          seen.add(result.url);

          const isNameOnly = query.basis === 'name' || query.basis === 'name_locality';
          let host: string;
          try {
            host = new URL(result.url).hostname.replace(/^www\./, '');
          } catch {
            continue;
          }

          emit.finding({
            id: `brave:${result.url}`,
            section: 'search',
            title: result.title?.slice(0, 140) ?? host,
            provider: { id: 'brave', label: 'Brave Search', url: 'https://brave.com/search/api/' },
            origin: { name: host, domain: host },
            discoveredAt: result.page_age ?? result.age,
            dataTypes: isNameOnly ? ['name'] : query.basis === 'email' ? ['email'] : ['username'],
            confidence: assessConfidence({
              signals: signalsFor(query.basis, context.emailVerified),
              nameOnly: isNameOnly,
              usernameOnly: query.basis === 'username',
              nameSearched: context.identity.name ? reveal(context.identity.name) : undefined,
            }),
            evidence: { url: result.url, label: 'Open the page' },
            whyItMatters:
              (result.description?.replace(/<[^>]+>/g, '').slice(0, 300) ?? '') ||
              'This page is indexed and publicly reachable.',
            actions: [
              {
                type: 'review_account',
                label: 'Check what this page shows about you',
                detail:
                  'If it is yours, the site that hosts it controls whether it stays up. De-indexing alone leaves the page live.',
                url: result.url,
              },
            ],
            educationKey: 'search_result',
          });
          emitted += 1;
        }
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
        }
        failures += 1;
      }
    }

    if (failures === queries.length) {
      return { status: 'failed', reason: describeError(new Error('all queries failed')) };
    }
    if (failures > 0) {
      return {
        status: 'partial',
        checked: queries.length - failures,
        total: queries.length,
        reason: 'Some searches failed',
      };
    }
    return { status: 'ok', checked: emitted };
  },
};
