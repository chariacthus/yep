/**
 * Masking for identifiers found on other people's public pages.
 *
 * A public profile that publishes an email address is publicly readable — we are
 * not revealing anything a visit to the page would not. But returning the full
 * address in a machine-readable report turns this tool into a convenient email
 * harvester, especially now that ownership is asserted rather than proved.
 *
 * So a discovered address is shown in full only when it matches the one the
 * person entered — in which case they already know it — and masked otherwise.
 */

export function maskEmail(address: string): string {
  const at = address.lastIndexOf('@');
  if (at <= 0) return '•••';

  const local = address.slice(0, at);
  const domain = address.slice(at + 1);
  const head = local.slice(0, 1);

  return `${head}${'•'.repeat(Math.max(3, Math.min(8, local.length - 1)))}@${domain}`;
}

/**
 * Full address when it is the one the person entered, masked otherwise.
 */
export function presentEmail(found: string, entered: string): string {
  return found.trim().toLowerCase() === entered.trim().toLowerCase()
    ? found
    : maskEmail(found);
}
