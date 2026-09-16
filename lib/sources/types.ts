import type { Identity } from '../identity';
import type { Finding, RemovalOpportunity } from '../normalize/finding';

/**
 * The contract every data source implements.
 *
 * Two rules matter more than the shape:
 *
 *   1. A source never throws into the orchestrator. Failures are returned as a
 *      SourceOutcome so they land in the coverage panel instead of killing the
 *      scan. One dead provider degrades the report; it never ends it.
 *   2. A source declares whether it receives the raw email address. That flag
 *      drives the consent UI, so the person can see -- and refuse -- exactly
 *      which third parties their address is sent to.
 */

export type SourceKind =
  | 'breach'
  | 'stealer'
  | 'profile'
  | 'search'
  | 'username'
  | 'archive'
  | 'broker';

export type InputRequirement = 'email' | 'username' | 'name';

export type SourceStatus =
  | 'pending'
  | 'running'
  | 'ok'
  | 'partial'
  | 'failed'
  | 'not_configured'
  | 'rate_limited'
  | 'skipped';

export type SourceOutcome =
  | { status: 'ok'; checked?: number }
  | { status: 'partial'; checked: number; total: number; reason: string }
  | { status: 'failed'; reason: string }
  | { status: 'not_configured'; missing: string[] }
  | { status: 'rate_limited'; retryAfterSeconds?: number }
  | { status: 'skipped'; reason: string; because?: 'declined' | 'no_input' };

/**
 * Facts one source learns that another can use, scoped to a single scan.
 *
 * This exists so the username sweep can tell the difference between "somebody
 * has this username" and "this person has this username". It is passed through
 * the context rather than held in module state so it cannot leak between
 * requests or grow unbounded.
 */
export interface Corroboration {
  /** Hosts the person provably controls, e.g. accounts verified on Gravatar. */
  confirmedHosts: Set<string>;
}

export interface ScanContext {
  identity: Identity;
  /** Shared, request-scoped findings from other sources. */
  corroboration: Corroboration;
  /** True once the person has proved they control the address. */
  emailVerified: boolean;
  /** Source ids the person declined in the consent step. */
  declinedSources: ReadonlySet<string>;
  /** Wall-clock deadline for the whole scan. */
  deadline: number;
  signal: AbortSignal;
}

export interface Emit {
  finding(finding: Finding): void;
  removalOpportunity(opportunity: RemovalOpportunity): void;
  /** Drives the live counter during long sweeps such as the username scan. */
  progress(done: number, total: number): void;
}

export interface Source {
  id: string;
  label: string;
  kind: SourceKind;
  /** One line shown on /about/sources describing what this actually checks. */
  description: string;
  /** Link to the provider, for attribution. */
  homepage?: string;
  requires: readonly InputRequirement[];
  /**
   * Whether the raw email address is transmitted to a third party. Sources that
   * only send a hash, or that take a username, report false.
   */
  sendsRawEmail: boolean;
  /** Env vars that must be present. Empty means the source always runs. */
  requiredEnv: readonly string[];
  run(context: ScanContext, emit: Emit): Promise<SourceOutcome>;
}

export function missingEnv(source: Source): string[] {
  return source.requiredEnv.filter((name) => !process.env[name]);
}

export function isConfigured(source: Source): boolean {
  return missingEnv(source).length === 0;
}

export function hasRequiredInput(source: Source, identity: Identity): boolean {
  return source.requires.every((requirement) => {
    if (requirement === 'email') return Boolean(identity.emailNormalized);
    if (requirement === 'username') return Boolean(identity.username);
    return Boolean(identity.name);
  });
}
