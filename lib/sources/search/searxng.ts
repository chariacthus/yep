import { reveal } from '../../identity';
import { assessConfidence } from '../../confidence/score';
import type { SignalId } from '../../confidence/signals';
import { searchRemovalActions } from '../../normalize/removal';
import { describeError, HttpError, requestJson } from '../http';
import type { Emit, ScanContext, Source, SourceOutcome } from '../types';

/**
 * Web search, without an API key.
 *
 * Every commercial search API now wants a card on file, so this talks to
 * SearXNG — open-source metasearch that anybody can self-host, and that has a
 * documented JSON endpoint. Point `SEARXNG_URL` at your own instance and this
 * becomes reliable; left unset it tries a short list of public ones, which is
 * best-effort by nature and says so when none answer.
 *
 * This is the source that answers "what else mentions me": the address in
 * quotes, the name with a town beside it, the handle on its own. Those queries
 * are also the weakest evidence in the report — a name search returns whoever
 * shares the name — so the confidence engine caps them and the common-name
 * penalty applies.
 */

/** Public instances that publish a JSON API. Tried in order. */
const FALLBACK_INSTANCES = [
  'https://searx.be',
  'https://search.inetol.net',
  'https://priv.au',
  'https://search.bus-hit.me',
];

function instances(): string[] {
  const configured = process.env.SEARXNG_URL?.trim();
  if (configured) return [configured.replace(/\/$/, '')];
  return FALLBACK_INSTANCES;
}

interface SearxResult {
  url?: string;
  title?: string;
  content?: string;
  publishedDate?: string;
}

interface SearxResponse {
  results?: SearxResult[];
}

interface Query {
  text: string;
  basis: 'email' | 'username' | 'name' | 'name_locality';
}

function buildQueries(context: ScanContext): Query[] {
  const queries: Query[] = [];
  const name = context.identity.name ? reveal(context.identity.name) : undefined;
  const locality = context.identity.locality ? reveal(context.identity.locality) : undefined;

  // Quoted, so the engine matches the address rather than its parts.
  queries.push({ text: `"${reveal(context.identity.emailNormalized)}"`, basis: 'email' });

  // A name plus a town is far more specific than a name alone, which is why
  // the locality field exists at all.
  if (name && locality) queries.push({ text: `"${name}" "${locality}"`, basis: 'name_locality' });
  else if (name) queries.push({ text: `"${name}"`, basis: 'name' });

  const given = context.handles.find((handle) => !handle.derived);
  if (given) queries.push({ text: `"${given.value}"`, basis: 'username' });

  return queries;
}

function signalsFor(basis: Query['basis']): SignalId[] {
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

/** Runs one query against the first instance that answers. */
async function search(
  query: string,
  context: ScanContext,
  preferred: string[],
): Promise<{ results: SearxResult[]; instance: string } | null> {
  for (const instance of preferred) {
    try {
      const response = await requestJson<SearxResponse>(
        `${instance}/search?q=${encodeURIComponent(query)}&format=json&safesearch=0`,
        {
          headers: { accept: 'application/json' },
          signal: context.signal,
          timeoutMs: 12_000,
        },
      );
      if (Array.isArray(response?.results)) {
        return { results: response.results, instance };
      }
    } catch {
      // Try the next instance; public ones go down or disable JSON regularly.
    }
  }
  return null;
}

export const searxngSource: Source = {
  id: 'websearch',
  label: 'Web search',
  kind: 'search',
  description:
    'Searches the open web for your address, and for your name alongside your town. Name results are the weakest evidence here and are never treated as confirmed.',
  homepage: 'https://searxng.org',
  requires: ['email'],
  // The query is the address; that is the point of the search.
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const queries = buildQueries(context);
    const searchedName = context.identity.name ? reveal(context.identity.name) : undefined;

    const seen = new Set<string>();
    let emitted = 0;
    let answered = 0;

    // Whichever instance answers first is used for the rest, so one working
    // instance is not abandoned for a broken one on the next query.
    let preferred = instances();

    for (const query of queries) {
      if (Date.now() > context.deadline) break;

      try {
        const found = await search(query.text, context, preferred);
        if (!found) continue;

        answered += 1;
        preferred = [found.instance, ...preferred.filter((item) => item !== found.instance)];

        for (const result of found.results.slice(0, RESULTS_PER_QUERY)) {
          if (!result.url || seen.has(result.url)) continue;
          seen.add(result.url);

          let host: string;
          try {
            host = new URL(result.url).hostname.replace(/^www\./, '');
          } catch {
            continue;
          }

          const isNameOnly = query.basis === 'name' || query.basis === 'name_locality';

          emit.finding({
            id: `websearch:${result.url}`,
            section: 'search',
            title: result.title?.slice(0, 120) ?? host,
            provider: { id: 'websearch', label: 'Web search', url: 'https://searxng.org' },
            origin: { name: host, domain: host },
            discoveredAt: result.publishedDate,
            dataTypes:
              query.basis === 'email' ? ['email'] : isNameOnly ? ['name'] : ['username'],
            confidence: assessConfidence({
              signals: signalsFor(query.basis),
              nameOnly: isNameOnly,
              usernameOnly: query.basis === 'username',
              nameSearched: searchedName,
            }),
            evidence: { url: result.url, label: 'Open the page' },
            whyItMatters:
              result.content?.replace(/<[^>]+>/g, '').slice(0, 220) ||
              'This page is indexed and publicly reachable.',
            actions: [
              {
                type: 'review_account',
                label: 'Check what this page shows',
                detail: 'Open it first — plenty of indexed pages are harmless.',
                url: result.url,
              },
              ...searchRemovalActions(result.url),
            ],
            educationKey: 'search_result',
          });
          emitted += 1;
        }
      } catch (error) {
        if (error instanceof HttpError && error.status === 429) {
          return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
        }
        return { status: 'failed', reason: describeError(error) };
      }
    }

    if (answered === 0) {
      return {
        status: 'failed',
        reason: process.env.SEARXNG_URL
          ? 'Your SearXNG instance did not answer'
          : 'No public search instance answered — set SEARXNG_URL to your own for reliable results',
      };
    }

    if (answered < queries.length) {
      return {
        status: 'partial',
        checked: answered,
        total: queries.length,
        reason: 'Some searches did not run',
      };
    }

    return { status: 'ok', checked: emitted };
  },
};
