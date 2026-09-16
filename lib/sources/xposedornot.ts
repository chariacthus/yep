import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import { mapDataClasses } from '../normalize/dataclasses';
import type { Finding } from '../normalize/finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * XposedOrNot — a keyless breach index.
 *
 * Valuable because it needs no subscription, so the tool is useful to somebody
 * who has configured nothing at all. The trade-off is that its API takes the
 * address in the clear, with no k-anonymity option, which is why it is declared
 * `sendsRawEmail` and can be declined in the consent step.
 *
 * The response shape is parsed defensively: fields are optional and types are
 * checked, because a keyless public API can change without notice and a shape
 * change must degrade to "no findings", never to a crash or a wrong finding.
 */

/**
 * Read at call time rather than module load, so contract tests can point the
 * adapter at a local fixture server.
 */
function apiBase(): string {
  return process.env.XPOSEDORNOT_API_BASE ?? 'https://api.xposedornot.com/v1';
}

interface BreachDetail {
  breach?: string;
  details?: string;
  domain?: string;
  industry?: string;
  /** Semicolon-separated data classes, e.g. "Email addresses;Passwords". */
  xposed_data?: string;
  /** Usually a year. */
  xposed_date?: string;
  xposed_records?: number;
  /** How the credentials were stored: plaintext, easytocrack, hardtocrack... */
  password_risk?: string;
}

interface AnalyticsResponse {
  ExposedBreaches?: { breaches_details?: BreachDetail[] };
  Error?: string;
}

/**
 * Describes how well credentials were protected. This is a property of the
 * breach, not a credential -- no value is involved -- and it materially changes
 * how urgent the response is.
 */
function credentialStorageNote(risk: string | undefined): string {
  switch (risk?.toLowerCase()) {
    case 'plaintext':
      return 'The passwords in this breach were stored without any protection, so they were readable immediately.';
    case 'easytocrack':
      return 'The passwords were stored with weak protection and are likely to have been recovered.';
    case 'hardtocrack':
      return 'The passwords were stored with strong protection, which slows attackers down but does not make the breach harmless.';
    default:
      return '';
  }
}

function toFinding(detail: BreachDetail, emailVerified: boolean): Finding | null {
  const name = detail.breach?.trim();
  if (!name) return null;

  const classes = (detail.xposed_data ?? '')
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);

  const dataTypes = mapDataClasses(classes);
  if (!dataTypes.includes('email')) dataTypes.push('email');

  const includesCredentials = dataTypes.includes('password_credential');
  const year = Number(detail.xposed_date?.slice(0, 4));

  const description = [
    detail.details?.trim(),
    includesCredentials ? credentialStorageNote(detail.password_risk) : '',
  ]
    .filter(Boolean)
    .join(' ')
    .slice(0, 600);

  return {
    id: `xon:${name}`,
    section: 'breaches',
    title: `Your email address was in the ${name} breach`,
    provider: { id: 'xposedornot', label: 'XposedOrNot', url: 'https://xposedornot.com' },
    origin: { name, domain: detail.domain || undefined },
    occurredAt: Number.isFinite(year) ? { year, precision: 'year' } : undefined,
    dataTypes,
    confidence: assessConfidence({
      signals: ['email_exact'],
      nameOnly: false,
    }),
    evidence: { url: 'https://xposedornot.com', label: 'About this index' },
    whyItMatters:
      description ||
      `Your address appears in data taken from ${name}. Information from a breach circulates indefinitely once it is out.`,
    actions: includesCredentials
      ? [
          {
            type: 'change_password',
            label: 'Change this password everywhere you used it',
            detail: `Change your ${name} password, and change it anywhere else you reused it.`,
          },
          {
            type: 'enable_2fa',
            label: 'Turn on two-factor authentication',
            detail: 'This makes a stolen password insufficient on its own. Start with your email account.',
          },
        ]
      : [
          {
            type: 'review_account',
            label: 'Check whether you still use this account',
            detail: 'Closing an account you no longer use removes the data the service still holds.',
          },
        ],
    educationKey: includesCredentials ? 'password_in_breach' : 'breach',
  };
}

export const xposedOrNotSource: Source = {
  id: 'xposedornot',
  label: 'XposedOrNot',
  kind: 'breach',
  description:
    'A free, open breach index. Needs no API key, so it works out of the box — but it receives your address in full.',
  homepage: 'https://xposedornot.com',
  requires: ['email'],
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);

    try {
      const data = await requestJson<AnalyticsResponse>(
        `${apiBase()}/breach-analytics?email=${encodeURIComponent(email)}`,
        { signal: context.signal, timeoutMs: 12_000 },
      );

      // "Not found" is the documented way this API says the address is clean.
      if (!data || data.Error) return { status: 'ok', checked: 0 };

      const details = data.ExposedBreaches?.breaches_details;
      if (!Array.isArray(details)) return { status: 'ok', checked: 0 };

      let emitted = 0;
      for (const detail of details) {
        const finding = toFinding(detail, context.emailVerified);
        if (finding) {
          emit.finding(finding);
          emitted += 1;
        }
      }
      return { status: 'ok', checked: emitted };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
