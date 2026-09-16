/**
 * The identity a person submits, and the rules for handling it.
 *
 * Everything in this file exists to make one failure mode structurally hard:
 * accidentally writing somebody's email address, name, or username into a log
 * line, an error message, or a response body.
 *
 * The mechanism is a branded wrapper whose `toString` and `toJSON` return a
 * redaction marker. Interpolating a `Private<string>` into a template literal,
 * passing it to `JSON.stringify`, or handing it to a logger yields
 * "[redacted]" rather than the value. Reading the real value requires calling
 * `reveal()`, which is greppable and appears in only a handful of places --
 * the outbound provider calls that genuinely need it.
 */

const VALUE = Symbol('private.value');

export const REDACTED = '[redacted]';

export interface Private<T extends string> {
  readonly [VALUE]: T;
  toString(): string;
  toJSON(): string;
}

/** Wraps a sensitive string so it cannot be logged or serialised by accident. */
export function priv<T extends string>(value: T): Private<T> {
  return {
    [VALUE]: value,
    toString: () => REDACTED,
    toJSON: () => REDACTED,
  };
}

/**
 * Unwraps a sensitive value. Every call site is a deliberate decision to expose
 * the value to something -- grep for `reveal(` to audit them.
 */
export function reveal<T extends string>(value: Private<T>): T {
  return value[VALUE];
}

export function isPrivate(value: unknown): value is Private<string> {
  return typeof value === 'object' && value !== null && VALUE in value;
}

export type Email = Private<string>;
export type PersonName = Private<string>;
export type Username = Private<string>;

/** The identity under scan. Never stored, never logged, never echoed back. */
export interface Identity {
  email: Email;
  /** Normalised: trimmed and lowercased. Hashes must be built from this. */
  emailNormalized: Email;
  name?: PersonName;
  username?: Username;
  /** Optional free-text locality used only to corroborate name matches. */
  locality?: PersonName;
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * Deliberately permissive. We are not trying to decide whether an address is
 * deliverable -- the verification code does that, definitively. This only
 * rejects input that cannot be an address at all.
 */
export function looksLikeEmail(raw: string): boolean {
  const value = raw.trim();
  if (value.length < 3 || value.length > 254) return false;
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  const domain = value.slice(at + 1);
  return domain.includes('.') && !domain.startsWith('.') && !domain.endsWith('.');
}

export function buildIdentity(input: {
  email: string;
  name?: string;
  username?: string;
  locality?: string;
}): Identity {
  const trimmedName = input.name?.trim();
  const trimmedUsername = input.username?.trim();
  const trimmedLocality = input.locality?.trim();

  return {
    email: priv(input.email.trim()),
    emailNormalized: priv(normalizeEmail(input.email)),
    name: trimmedName ? priv(trimmedName) : undefined,
    username: trimmedUsername ? priv(trimmedUsername) : undefined,
    locality: trimmedLocality ? priv(trimmedLocality) : undefined,
  };
}

/**
 * Every string in an identity, revealed. Used only by the logging canary test,
 * which asserts that none of them ever reaches a log line.
 */
export function identityStrings(identity: Identity): string[] {
  const out = [reveal(identity.email), reveal(identity.emailNormalized)];
  if (identity.name) out.push(reveal(identity.name));
  if (identity.username) out.push(reveal(identity.username));
  if (identity.locality) out.push(reveal(identity.locality));
  return out;
}
