import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { describeError, request } from './http';
import { closeAccountAction, legalErasureAction } from '../normalize/removal';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * keys.openpgp.org.
 *
 * A published PGP key means the address was deliberately made public and is
 * permanently associated with an identity. Low volume, but a genuine and
 * frequently forgotten exposure — people publish a key once and never think
 * about it again.
 *
 * The key material itself is public by design and is not a credential; we do
 * not retrieve or display it regardless, only the fact that one exists.
 */

const API = 'https://keys.openpgp.org/vks/v1/by-email';

export const openPgpSource: Source = {
  id: 'openpgp',
  label: 'OpenPGP key servers',
  kind: 'profile',
  description:
    'Checks whether a public encryption key has been published against your address, which permanently ties it to a public identity.',
  homepage: 'https://keys.openpgp.org',
  requires: ['email'],
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);

    try {
      const response = await request(`${API}/${encodeURIComponent(email)}`, {
        headers: { accept: 'text/plain' },
        signal: context.signal,
        timeoutMs: 8000,
      });

      if (response.status === 404) return { status: 'ok', checked: 0 };
      if (!response.ok) return { status: 'failed', reason: `Key server returned ${response.status}` };

      emit.finding({
        id: 'openpgp:key',
        section: 'profiles',
        title: 'A public encryption key is published for your address',
        provider: { id: 'openpgp', label: 'keys.openpgp.org', url: 'https://keys.openpgp.org' },
        origin: { name: 'keys.openpgp.org', domain: 'keys.openpgp.org' },
        dataTypes: ['email'],
        confidence: assessConfidence({
          signals: ['email_exact'],
          nameOnly: false,
        }),
        evidence: {
          url: `https://keys.openpgp.org/search?q=${encodeURIComponent(email)}`,
          label: 'View the key server entry',
        },
        whyItMatters:
          'A published key confirms this address is real and in use — exactly what makes it valuable to list compilers.',
        actions: [
          {
            type: 'review_account',
            label: 'Unpublish the identity',
            detail: 'keys.openpgp.org lets you remove it by confirming the address.',
            url: 'https://keys.openpgp.org/manage',
          },
          {
            type: 'review_account',
            label: 'Older key servers cannot be deleted from',
            detail: 'The SKS network is append-only. Publish a revocation certificate instead.',
            url: 'https://keys.openpgp.org/about',
          },
        ],
        educationKey: 'public_profile',
      });

      return { status: 'ok', checked: 1 };
    } catch (error) {
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
