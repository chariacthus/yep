import { resolveMx, resolveTxt } from 'node:dns/promises';
import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { Action } from '../normalize/finding';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * The email address's own domain, by DNS.
 *
 * Not an exposure so much as a property of the address: who actually runs it,
 * and how easy it is for somebody to send mail that appears to come from it.
 * Spoofability matters here because the rest of this report is a list of places
 * that know the address — and a forged message from your own address is the most
 * effective phishing there is.
 *
 * Framing is the difficult part. Telling somebody on gmail.com that Google
 * publishes `p=none` is a fact about Google, which they can do precisely nothing
 * about; the same finding on a domain they own is a genuine action. So the
 * source reports large providers as informational and only calls it actionable
 * when the domain looks like the person's own.
 *
 * DNS is the only network this source touches, and only for the domain part.
 */

/** Providers where the domain's configuration is the provider's business. */
const LARGE_PROVIDERS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.net',
  'web.de',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'fastmail.com',
  'hey.com',
  'tutanota.com',
  'tuta.com',
]);

/** Recognises who runs the mail, from the MX hostnames. */
function identifyProvider(exchanges: string[]): string | null {
  const joined = exchanges.join(' ').toLowerCase();
  if (joined.includes('google') || joined.includes('googlemail')) return 'Google';
  if (joined.includes('outlook') || joined.includes('protection.outlook')) return 'Microsoft';
  if (joined.includes('yahoodns')) return 'Yahoo';
  if (joined.includes('icloud') || joined.includes('apple')) return 'Apple';
  if (joined.includes('protonmail') || joined.includes('proton.me')) return 'Proton';
  if (joined.includes('zoho')) return 'Zoho';
  if (joined.includes('fastmail') || joined.includes('messagingengine')) return 'Fastmail';
  if (joined.includes('mimecast')) return 'Mimecast';
  if (joined.includes('pphosted') || joined.includes('proofpoint')) return 'Proofpoint';
  return null;
}

/** Reads the enforcement level out of a DMARC record. */
function dmarcPolicy(record: string | null): 'none' | 'quarantine' | 'reject' | null {
  if (!record) return null;
  const match = record.match(/\bp\s*=\s*(none|quarantine|reject)\b/i);
  return (match?.[1]?.toLowerCase() as 'none' | 'quarantine' | 'reject') ?? null;
}

export const emailDomainSource: Source = {
  id: 'email-domain',
  label: 'Email domain protections',
  kind: 'profile',
  description:
    'Looks up public DNS records for your email domain to see who runs it and how easily somebody could forge mail from your address.',
  requires: ['email'],
  // Only the domain part is ever resolved, never the address.
  sendsRawEmail: false,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const address = reveal(context.identity.emailNormalized);
    const domain = address.slice(address.lastIndexOf('@') + 1);
    if (!domain || !domain.includes('.')) {
      return { status: 'skipped', reason: 'The address has no usable domain' };
    }

    try {
      const exchanges = await resolveMx(domain)
        .then((records) => records.map((record) => record.exchange))
        .catch(() => [] as string[]);

      if (exchanges.length === 0) {
        // No MX at all is worth saying: the address cannot receive mail, which
        // usually means a typo or a domain that has lapsed.
        emit.finding({
          id: 'email-domain:no-mx',
          section: 'other',
          title: 'This domain has no mail servers',
          provider: { id: 'email-domain', label: 'Public DNS' },
          origin: { name: domain, domain },
          dataTypes: ['email'],
          confidence: assessConfidence({ signals: ['email_exact'], nameOnly: false }),
          whyItMatters:
            `Public DNS lists no mail servers for ${domain}, so this address cannot currently receive email. ` +
            'That normally means a typo in the domain, or a domain that has been allowed to lapse. A lapsed domain is worth attention: whoever registers it next can receive mail sent to your old address, including password resets.',
          actions: [
            {
              type: 'review_account',
              label: 'Check the domain is right',
              detail:
                'If the spelling is correct and the domain was yours, consider which accounts still use this address for recovery.',
            },
          ],
          educationKey: 'public_profile',
        });
        return { status: 'ok', checked: 1 };
      }

      const txt = await resolveTxt(domain).catch(() => [] as string[][]);
      const spf = txt.flat().find((record) => record.toLowerCase().startsWith('v=spf1')) ?? null;

      const dmarcRecord = await resolveTxt(`_dmarc.${domain}`)
        .then((records) => records.map((parts) => parts.join('')).find((r) => r.toLowerCase().includes('v=dmarc1')) ?? null)
        .catch(() => null);

      const policy = dmarcPolicy(dmarcRecord);
      const provider = identifyProvider(exchanges);
      const ownDomain = !LARGE_PROVIDERS.has(domain);

      // Weak means: no DMARC at all, or DMARC that asks for nothing to be done.
      const weak = !dmarcRecord || policy === 'none' || !spf;

      const protections = [
        `mail handled by ${provider ?? exchanges[0]?.replace(/\.$/, '') ?? 'an unidentified server'}`,
        spf ? 'SPF present' : 'no SPF record',
        dmarcRecord ? `DMARC ${policy ?? 'present'}` : 'no DMARC record',
      ].join(' · ');

      const actions: Action[] = [];
      if (weak && ownDomain) {
        actions.push({
          type: 'review_privacy_settings',
          label: 'Tighten the anti-spoofing records on your domain',
          detail:
            'Publish an SPF record listing your senders, then a DMARC record at _dmarc.' +
            domain +
            ' starting at p=none to collect reports, and move to p=quarantine or p=reject once you know what sends mail as you.',
        });
      } else {
        actions.push({
          type: 'enable_2fa',
          label: 'Protect the mailbox itself',
          detail:
            'Your email account can reset the password on almost everything else you own, so it is the single account most worth putting a strong unique password and two-factor authentication on.',
        });
      }

      // The title only raises an alarm where the person can actually act. On a
      // large provider these records are the provider's to set, and phrasing it
      // as their problem would be both useless and misleading.
      const title = ownDomain
        ? weak
          ? `Mail from ${domain} is relatively easy to forge`
          : `${domain} publishes anti-forgery protections`
        : `Your email is handled by ${provider ?? domain}`;

      emit.finding({
        id: 'email-domain:posture',
        section: 'other',
        title,
        provider: { id: 'email-domain', label: 'Public DNS' },
        origin: { name: domain, domain },
        dataTypes: ['email'],
        confidence: assessConfidence({ signals: ['email_exact'], nameOnly: false }),
        whyItMatters:
          `${protections}. ` +
          (weak
            ? 'Without a strict DMARC policy, a message claiming to come from this domain is more likely to reach an inbox. That matters here because everything else in this report is a place that knows your address — and the most convincing phishing message anyone will ever receive is one that appears to come from their own address. '
            : 'A published DMARC policy means forged mail claiming to come from this domain is likely to be quarantined or rejected outright. ') +
          (ownDomain
            ? 'This looks like a domain you control, so these records are yours to change.'
            : 'This is a large mail provider, so these settings are theirs rather than yours — it is context, not a task.'),
        actions,
        educationKey: 'public_profile',
      });

      return { status: 'ok', checked: 1 };
    } catch {
      return { status: 'failed', reason: 'Could not read DNS records for the domain' };
    }
  },
};
