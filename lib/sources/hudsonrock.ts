import { reveal } from '../identity';
import { assessConfidence } from '../confidence/score';
import type { Finding } from '../normalize/finding';
import { describeError, HttpError, requestJson } from './http';
import type { Emit, ScanContext, Source, SourceOutcome } from './types';

/**
 * Hudson Rock's Cavalier community API — infostealer infection intelligence.
 *
 * This is the source with the sharpest credential-handling problem, and the
 * clearest illustration of the rule. Its responses include `top_passwords` and
 * `top_logins` fields containing actual stolen credentials.
 *
 * We destructure exactly the fields we want and never touch those. There is no
 * pass-through of the raw object anywhere in this file, no spread of the
 * response into a finding, and the Finding type has nowhere to put a credential
 * even if one were extracted. tests/no-credentials.test.ts feeds this adapter a
 * fixture containing passwords and asserts none of them reach the output.
 */

/**
 * Read at call time rather than module load, so contract tests can point the
 * adapter at a local fixture server.
 */
function apiBase(): string {
  return process.env.HUDSONROCK_API_BASE ?? 'https://cavalier.hudsonrock.com/api/json/v2/osint-tools';
}

interface StealerRecord {
  date_compromised?: string;
  computer_name?: string;
  operating_system?: string;
  antiviruses?: string[];
  total_user_services?: number;
  total_corporate_services?: number;
  // NOTE: the API also returns top_passwords and top_logins. They are
  // deliberately absent from this interface so they cannot be read by accident.
}

interface CavalierResponse {
  message?: string;
  stealers?: StealerRecord[];
}

function toFinding(record: StealerRecord, index: number, emailVerified: boolean): Finding {
  const compromisedAt = record.date_compromised;
  const year = compromisedAt ? Number(compromisedAt.slice(0, 4)) : undefined;
  const serviceCount = (record.total_user_services ?? 0) + (record.total_corporate_services ?? 0);

  const deviceDescription = [record.computer_name, record.operating_system]
    .filter(Boolean)
    .join(' · ');

  return {
    id: `hudsonrock:${index}`,
    section: 'stealer',
    title: 'Your credentials were taken from a device by malware',
    provider: { id: 'hudsonrock', label: 'Hudson Rock', url: 'https://www.hudsonrock.com' },
    origin: { name: deviceDescription || 'An infected device' },
    occurredAt: compromisedAt
      ? { date: compromisedAt, year: Number.isFinite(year) ? year : undefined, precision: 'day' }
      : undefined,
    dataTypes: ['email', 'password_credential', 'device_info'],
    confidence: assessConfidence({
      signals: ['email_exact'],
      nameOnly: false,
    }),
    whyItMatters:
      'This is not a company being breached — it means a device was infected with software that harvested saved logins and session cookies directly from the browser. ' +
      (serviceCount > 0
        ? `Credentials for around ${serviceCount} services were taken from this machine. `
        : '') +
      'Anything signed in on that device at the time may be affected, and stolen session tokens can sometimes bypass two-factor authentication.',
    actions: [
      {
        type: 'scan_device',
        label: 'Treat the device as compromised',
        detail: deviceDescription
          ? `Run a full malware scan on ${deviceDescription}, or have it rebuilt. Until that is done, changing passwords on it will not help — the new ones can be captured too.`
          : 'Run a full malware scan on the device you use most, or have it rebuilt. Changing passwords on an infected machine does not help.',
      },
      {
        type: 'change_password',
        label: 'Change your passwords from a different, trusted device',
        detail:
          'Start with your email account, then anything financial. Use a device you are confident is clean.',
      },
      {
        type: 'enable_2fa',
        label: 'Sign out all sessions and re-enable two-factor authentication',
        detail:
          'Stolen session cookies stay valid until sessions are revoked. Most services have a "sign out everywhere" control in their security settings.',
      },
    ],
    educationKey: 'stealer_log',
    flags: { malware: true },
  };
}

export const hudsonRockSource: Source = {
  id: 'hudsonrock',
  label: 'Hudson Rock (infostealer data)',
  kind: 'stealer',
  description:
    'Checks whether your address appears in data harvested from malware-infected computers. Free and keyless, but it receives your address in full.',
  homepage: 'https://www.hudsonrock.com',
  requires: ['email'],
  sendsRawEmail: true,
  requiredEnv: [],

  async run(context: ScanContext, emit: Emit): Promise<SourceOutcome> {
    const email = reveal(context.identity.emailNormalized);

    try {
      const data = await requestJson<CavalierResponse>(
        `${apiBase()}/search-by-email?email=${encodeURIComponent(email)}`,
        { signal: context.signal, timeoutMs: 12_000 },
      );

      const stealers = data?.stealers;
      if (!Array.isArray(stealers) || stealers.length === 0) {
        return { status: 'ok', checked: 0 };
      }

      stealers.forEach((record, index) => {
        // Only the named fields are read. The response's credential fields are
        // never dereferenced.
        emit.finding(
          toFinding(
            {
              date_compromised: record.date_compromised,
              computer_name: record.computer_name,
              operating_system: record.operating_system,
              total_user_services: record.total_user_services,
              total_corporate_services: record.total_corporate_services,
            },
            index,
            context.emailVerified,
          ),
        );
      });

      return { status: 'ok', checked: stealers.length };
    } catch (error) {
      if (error instanceof HttpError && error.status === 429) {
        return { status: 'rate_limited', retryAfterSeconds: error.retryAfterSeconds };
      }
      return { status: 'failed', reason: describeError(error) };
    }
  },
};
