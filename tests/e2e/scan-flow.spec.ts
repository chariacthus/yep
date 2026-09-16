import { expect, test } from '@playwright/test';

/**
 * The flow a person actually walks through.
 *
 * This runs against a dev server with no provider keys. That is deliberate: the
 * most important thing to prove is that a scan which can reach almost nothing
 * still produces a coherent, honest report rather than an empty page or a false
 * all-clear.
 */

const ADDRESS = 'e2e-canary@example-canary.invalid';

test('a person can scan without any email step and gets an honest report', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('exposed');

  await page.fill('#email', ADDRESS);
  await page.fill('#name', 'John Smith');
  await page.fill('#username', 'e2ecanaryhandle');
  await page.fill('#locality', 'Bristol');

  // The consent step must name the services that receive the raw address.
  await expect(page.getByText('Services that receive your address')).toBeVisible();

  // The scan cannot start until ownership is affirmed — with no verification,
  // this checkbox is the only thing the terms rest on.
  await expect(page.getByRole('button', { name: /Begin scan/i })).toBeDisabled();
  await page.check('input[required][type=checkbox]');
  await expect(page.getByRole('button', { name: /Begin scan/i })).toBeEnabled();

  await page.getByRole('button', { name: /Begin scan/i }).click();

  // The scanning screen must show the work happening, not just a spinner: how
  // many services are done, how far through the site sweep it is, and which
  // check is running right now.
  await expect(page.getByRole('heading', { name: 'Scanning' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Services', { exact: true })).toBeVisible();
  await expect(page.getByText('Found', { exact: true })).toBeVisible();
  await expect(page.getByText('Live trace')).toBeVisible();

  // The full source list stays available underneath, collapsed.
  await expect(page.getByText(/\d+ of \d+ sources done/)).toBeVisible();

  await expect(page.getByRole('heading', { name: /Exposure report/ })).toBeVisible({
    timeout: 180_000,
  });

  // Exactly one top-level heading, whatever stage we are in.
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

  // Coverage is stated as a count rather than a warning banner. Sources needing
  // a key nobody has are left out of the scan entirely, so the number reflects
  // what could actually run.
  await expect(page.getByText(/\d+ of \d+ sources checked/)).toBeVisible();

  // Ownership was asserted, not proved, and the report still says so.
  await expect(page.getByText(/took your word/)).toBeVisible();

  // Broker entries must never be presented as detections.
  await expect(page.getByText('Not a detection.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the official DROP platform/ })).toBeVisible();

  // Nothing in the report may look like a credential.
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toMatch(/\bpassword is\b|\bpassword:\s*\S/);
});

test('a finding can be opened and dismissed as not you', async ({ page }) => {
  await page.goto('/');
  await page.fill('#email', ADDRESS);
  await page.fill('#username', 'sindresorhus');
  await page.check('input[required][type=checkbox]');
  await page.getByRole('button', { name: /Begin scan/i }).click();

  await expect(page.getByRole('heading', { name: /Exposure report/ })).toBeVisible({
    timeout: 180_000,
  });

  const firstEntry = page.locator('li button[aria-expanded]').first();
  if ((await firstEntry.count()) === 0) test.skip(true, 'No findings reachable from this network');

  // Every finding carries a link to the thing it found, on the collapsed row.
  // Checking whether a result is really yours means opening it, so the link
  // cannot be buried behind a disclosure.
  const link = page.locator('li:has(button[aria-expanded]) a[target="_blank"]').first();
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute('href', /^https?:\/\//);

  await firstEntry.click();
  // The reasoning behind a confidence level is always shown, never implied.
  await expect(page.getByText('Why we think this').first()).toBeVisible();

  await page.getByRole('button', { name: 'No', exact: true }).first().click();
  await expect(page.getByText('You said this is not you').first()).toBeVisible();
});

test('the sources page states what is not set up and what was rejected', async ({ page }) => {
  await page.goto('/about/sources');

  await expect(page.getByRole('heading', { name: /What we check/ })).toBeVisible();
  await expect(page.getByText('HIBP_API_KEY')).toBeVisible();
  await expect(page.getByText(/What we deliberately do not use/)).toBeVisible();
  // Sources dropped on evidence are recorded, not quietly omitted.
  await expect(page.getByRole('heading', { name: 'Tried and rejected' })).toBeVisible();
  await expect(page.getByText(/PyPI/)).toBeVisible();
});
