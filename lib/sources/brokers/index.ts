import brokerData from '../../../data/brokers.json';
import type { RemovalOpportunity } from '../../normalize/finding';
import type { Emit, ScanContext, Source, SourceOutcome } from '../types';

/**
 * Data brokers — deliberately NOT a detection source.
 *
 * We cannot confirm that somebody is listed on a people-search site without
 * scraping it. That would break those sites' terms, and it is precisely the
 * look-up-a-stranger behaviour this tool exists to oppose. Asserting a listing
 * we have not verified would be fabrication, which the product forbids.
 *
 * So this emits removal *opportunities* with no confidence level attached, and
 * the UI labels the whole section as not being a detection. What the person
 * gets is still concretely useful: the brokers that hold data of the kind their
 * scan surfaced, a working opt-out link for each, and — for Californians — the
 * one request that covers every registered broker at once.
 */

interface BrokerEntry {
  id: string;
  name: string;
  aliases: string[];
  website?: string;
  optOutUrl?: string;
  process?: string;
  helpUrl?: string;
  optOutWorking?: boolean;
  workaround?: string;
  registeredInCalifornia: boolean;
  collects: string[];
}

interface BrokerData {
  californiaRegistryIncluded: boolean;
  californiaRegisteredCount: number;
  brokers: BrokerEntry[];
}

const data = brokerData as unknown as BrokerData;

/** Brokers with a working opt-out are listed first; they are the actionable ones. */
function rank(broker: BrokerEntry): number {
  let score = 0;
  if (broker.optOutUrl) score -= 2;
  if (broker.optOutWorking === true) score -= 2;
  if (broker.optOutWorking === false) score += 3;
  if (broker.registeredInCalifornia) score -= 1;
  return score;
}

const MAX_LISTED = 40;

export const brokerSource: Source = {
  id: 'brokers',
  label: 'Data broker directory',
  kind: 'broker',
  description:
    'Lists data brokers and how to opt out of each. This does not check whether you are listed — see the note on the section.',
  homepage: 'https://cppa.ca.gov/data_broker_registry/',
  // Nothing is sent anywhere: this is a local directory lookup.
  requires: ['name'],
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    if (!context.identity.name) {
      return {
        status: 'skipped',
        reason: 'No name was provided, and brokers index people by name',
      };
    }

    const brokers = [...data.brokers].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_LISTED);

    for (const broker of brokers) {
      const relevance = broker.registeredInCalifornia
        ? 'Registered as a data broker in California, which means it buys or sells personal information about people it has no direct relationship with.'
        : 'A people-search or data-broker site known to compile personal records.';

      const detail = [
        broker.process,
        broker.optOutWorking === false
          ? 'This opt-out was last recorded as not working.'
          : undefined,
        broker.workaround,
      ]
        .filter(Boolean)
        .join(' ');

      emit.removalOpportunity({
        id: `broker:${broker.id}`,
        brokerName: broker.name,
        website: broker.website,
        optOutUrl: broker.optOutUrl ?? broker.helpUrl,
        collects: broker.collects,
        relevance: detail ? `${relevance} ${detail}` : relevance,
        jurisdiction: broker.registeredInCalifornia ? 'california' : 'us',
        difficulty:
          broker.optOutWorking === false ? 'hard' : broker.optOutUrl ? 'easy' : 'moderate',
      } satisfies RemovalOpportunity);
    }

    return { status: 'ok', checked: brokers.length };
  },
};

export const brokerDirectoryMeta = {
  total: data.brokers.length,
  californiaRegistryIncluded: data.californiaRegistryIncluded,
  californiaRegisteredCount: data.californiaRegisteredCount,
};
