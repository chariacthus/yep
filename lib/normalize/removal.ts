import type { Action } from './finding';

/**
 * Removal routes that apply to a whole class of exposure.
 *
 * The point of this file is that "how do I get rid of it" should never be
 * answered with a shrug. Some things genuinely cannot be deleted — a breach
 * that already happened, an immutable package version — and for those the
 * honest answer is what to do *instead*, not silence.
 *
 * Every finding in the report ends up with at least one of these.
 */

/** The legal route. Works whether or not a company offers a delete button. */
export function legalErasureAction(subject: string, url?: string): Action {
  return {
    type: 'opt_out',
    label: 'Demand erasure under data-protection law',
    detail:
      `If ${subject} will not remove it voluntarily, you may have a legal right to make them. ` +
      'In the UK and EU, GDPR Article 17 requires a response within one month. California, Colorado, Connecticut, Virginia and a growing list of other US states have equivalent rights. ' +
      'Write to their privacy or data-protection address, state that you are exercising your right to erasure, and ask them to confirm in writing when it is done.',
    url,
  };
}

/** Getting a page out of search results, which is separate from deleting it. */
export function searchRemovalActions(pageUrl?: string): Action[] {
  return [
    {
      type: 'opt_out',
      label: 'Ask the site to take the page down',
      detail:
        'This is the only thing that actually removes the content. De-indexing hides a page from search results while leaving it live for anyone with the link.',
      url: pageUrl,
    },
    {
      type: 'opt_out',
      label: 'Ask Google to remove it from results',
      detail:
        'Google removes results containing personal information such as your address, phone number or identifiers, and will de-index a page that is already gone. Use their "Results about you" tool.',
      url: 'https://support.google.com/websearch/troubleshooter/9685456',
    },
    {
      type: 'opt_out',
      label: 'Ask Bing to do the same',
      detail: 'Bing runs an equivalent content-removal process for personal information.',
      url: 'https://www.bing.com/webmasters/tools/contentremoval',
    },
  ];
}

/** Archived copies outlive the original, and have their own process. */
export function archiveRemovalAction(pageUrl?: string): Action {
  return {
    type: 'opt_out',
    label: 'Request removal from the archive',
    detail:
      'The Internet Archive considers exclusion requests for pages about you. Email info@archive.org with the exact URLs and why you want them excluded. Removing the original page does not remove the archived copy — these are separate requests.',
    url: pageUrl ?? 'https://help.archive.org/help/how-do-i-request-to-remove-something-from-archive-org/',
  };
}

/** Closing an account is the only thing that removes what a service still holds. */
export function closeAccountAction(serviceName: string, domain?: string): Action {
  return {
    type: 'close_account',
    label: `Delete your ${serviceName} account if you no longer use it`,
    detail:
      `An account you have stopped using still holds everything you ever gave it, and is one more place that can be breached. ` +
      (domain
        ? `Look under account or privacy settings on ${domain}, or search "${serviceName} delete account".`
        : `Look under account or privacy settings, or search "${serviceName} delete account".`),
    url: domain ? `https://${domain}` : undefined,
  };
}

/**
 * For exposures that cannot be undone. Saying so plainly, and redirecting to
 * what does help, beats implying a removal route that does not exist.
 */
export function containmentAction(reason: string, whatHelps: string): Action {
  return {
    type: 'review_account',
    label: 'This one cannot be deleted — contain it instead',
    detail: `${reason} ${whatHelps}`,
  };
}

/** Where to go when the site itself will not help. */
export const REGULATOR_ACTION: Action = {
  type: 'opt_out',
  label: 'Escalate to a regulator if they refuse',
  detail:
    'If a company ignores a lawful erasure request, you can complain to your data-protection authority — the ICO in the UK, your national DPA in the EU, or your state attorney general in the US. Complaints are free and companies take them seriously.',
  url: 'https://www.edpb.europa.eu/about-edpb/about-edpb/members_en',
};
