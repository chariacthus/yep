import { expect, test } from '@playwright/test';

/**
 * The flow a person actually walks through.
 *
 * This runs against a dev server with no provider keys and, in most CI
 * environments, no outbound access to the providers either. That is deliberate:
 * the most important thing to prove is that a scan which can reach almost
 * nothing still produces a coherent, honest report rather than an empty page or
 * a false all-clear.
 */

const ADDRESS = 'e2e-canary@example-canary.invalid';

test('a person can verify, scan, and get an honest report', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1 })).toContainText('exposed');

  await page.fill('#email', ADDRESS);
  await page.fill('#name', 'John Smith');
  await page.fill('#username', 'e2ecanaryhandle');
  await page.fill('#locality', 'Bristol');

  // The consent step must name the services that receive the raw address.
  await expect(page.getByText('Which services may receive your address')).toBeVisible();

  await page.getByRole('button', { name: 'Send verification code' }).click();
  await expect(page.locator('#code')).toBeVisible({ timeout: 20_000 });

  // In development the code is printed to the server log rather than emailed.
  const code = await readDevCode();
  await page.fill('#code', code);
  await page.getByRole('button', { name: /Verify and start scan/ }).click();

  // The scanning screen must show what is being checked, not just a spinner.
  await expect(page.getByRole('heading', { name: /Scanning/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText('Have I Been Pwned')).toBeVisible();

  await expect(page.getByRole('heading', { name: /exposure report/ })).toBeVisible({
    timeout: 180_000,
  });

  // With no keys configured, the report must say so rather than implying a
  // clean result.
  await expect(page.getByText(/This scan was partly completed/)).toBeVisible();
  await expect(page.getByText(/Checked \d+ of \d+ sources/)).toBeVisible();

  // Broker entries must never be presented as detections.
  await expect(page.getByText('This is not a detection.')).toBeVisible();
  await expect(page.getByRole('link', { name: /Open the official DROP platform/ })).toBeVisible();

  // Nothing about the report may contain a password.
  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body).not.toMatch(/\bpassword is\b|\bpassword:\s*\S/);
});

test('the scan endpoint refuses an unverified address', async ({ request }) => {
  const response = await request.post('/api/scan', {
    data: { email: 'someone-else@example.invalid', name: 'Someone Else' },
  });

  expect(response.status()).toBe(403);
  expect(await response.json()).toMatchObject({ error: expect.stringMatching(/verify/i) });
});

test('the sources page states what is not set up', async ({ page }) => {
  await page.goto('/about/sources');

  await expect(page.getByRole('heading', { name: /What we check/ })).toBeVisible();
  await expect(page.getByText('HIBP_API_KEY')).toBeVisible();
  await expect(page.getByText(/What we deliberately do not use/)).toBeVisible();
});

/**
 * Reads the most recent development verification code from the dev server log.
 * Set E2E_DEV_LOG to the file the dev server writes to.
 */
async function readDevCode(): Promise<string> {
  const path = process.env.E2E_DEV_LOG;
  if (!path) {
    throw new Error('Set E2E_DEV_LOG to the dev server log file so the code can be read.');
  }

  const { readFileSync } = await import('node:fs');
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const matches = readFileSync(path, 'utf8').match(/\[dev\] verification code: (\d{6})/g);
    if (matches?.length) {
      const last = matches[matches.length - 1]!;
      return last.slice(-6);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('No verification code appeared in the dev log.');
}
