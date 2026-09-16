import type { Action } from './finding';

/**
 * Removal routes that apply to a whole class of exposure.
 *
 * The point of this file is that "how do I get rid of it" is never answered
 * with a shrug. Some things genuinely cannot be deleted; for those the honest
 * answer is what to do instead, said briefly.
 */

export function legalErasureAction(subject: string, url?: string): Action {
  return {
    type: 'opt_out',
    label: 'Demand deletion under GDPR',
    detail: `If ${subject} won't remove it, you can make them. UK and EU law gives you a right to erasure with a one-month deadline; several US states match it. Email their privacy address.`,
    url,
  };
}

export function searchRemovalActions(pageUrl?: string): Action[] {
  return [
    {
      type: 'opt_out',
      label: 'Ask the site to take it down',
      detail: 'Only this removes the page. De-indexing just hides it from search.',
      url: pageUrl,
    },
    {
      type: 'opt_out',
      label: 'Remove it from Google',
      detail: 'Google de-indexes results containing personal details, and pages already deleted.',
      url: 'https://support.google.com/websearch/troubleshooter/9685456',
    },
    {
      type: 'opt_out',
      label: 'Remove it from Bing',
      detail: 'Bing runs the same process.',
      url: 'https://www.bing.com/webmasters/tools/contentremoval',
    },
  ];
}

export function archiveRemovalAction(pageUrl?: string): Action {
  return {
    type: 'opt_out',
    label: 'Request archive removal',
    detail:
      'Email info@archive.org with the URLs. Deleting the original does not remove the snapshot — these are separate.',
    url:
      pageUrl ??
      'https://help.archive.org/help/how-do-i-request-to-remove-something-from-archive-org/',
  };
}

export function closeAccountAction(serviceName: string, domain?: string): Action {
  return {
    type: 'close_account',
    label: `Delete your ${serviceName} account`,
    detail: `Worth doing if you no longer use it — an unused account still holds your data and can still be breached.`,
    url: domain ? `https://${domain}` : undefined,
  };
}

export const REGULATOR_ACTION: Action = {
  type: 'opt_out',
  label: 'Escalate if ignored',
  detail: 'Complain to the ICO, your national DPA, or your state attorney general. It is free.',
  url: 'https://www.edpb.europa.eu/about-edpb/about-edpb/members_en',
};
