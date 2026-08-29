import { expect, test } from '@playwright/test';

// These run against a deployment with no GitHub App configured — the state a
// contributor or self-hoster hits first — so they cover the fallbacks rather
// than the happy OAuth path, which needs real GitHub credentials.

test('offers a way to connect, and explains the local-only default', async ({ page }) => {
	await page.goto('/connect');

	await expect(
		page.getByRole('heading', { name: /where should your journal live/i })
	).toBeVisible();
	await expect(page.getByText(/one markdown file per day/i)).toBeVisible();

	// Nothing is chosen yet, so writing must remain reachable without syncing.
	await expect(page.getByRole('link', { name: /keep writing without syncing/i })).toBeVisible();
});

test('falls back to a personal access token when no app is configured', async ({ page }) => {
	await page.goto('/connect');

	await expect(page.getByText(/no github app configured/i)).toBeVisible();

	await page.getByRole('button', { name: /personal access token/i }).click();

	const field = page.getByLabel(/fine-grained token/i);
	await expect(field).toBeVisible();
	await expect(field).toHaveAttribute('type', 'password');

	// The trade-off has to be stated, not buried.
	await expect(page.getByText(/stored in this browser/i)).toBeVisible();

	// Submit stays disabled until something is typed.
	const submit = page.getByRole('button', { name: /use this token/i });
	await expect(submit).toBeDisabled();
	await field.fill('github_pat_example');
	await expect(submit).toBeEnabled();
});

test('settings offers to connect a repository', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	await page.getByLabel('Syncing').click();

	await expect(page.getByText(/stored on this device only/i)).toBeVisible();
	await page.getByRole('link', { name: /connect a repository/i }).click();

	await expect(page).toHaveURL(/\/connect$/);
});

test('the API proxy refuses anonymous callers', async ({ request }) => {
	const response = await request.get('/api/gh/user');

	// 401 when the app is configured, 503 when it is not — either way the
	// browser is told no, and no GitHub call was made on its behalf.
	expect([401, 503]).toContain(response.status());
	expect(response.headers()['cache-control']).toBe('no-store');
});

test('the session endpoint stays usable with no app configured', async ({ request }) => {
	// It must not 503: the client asks this on every boot, including offline.
	const response = await request.get('/auth/session');

	expect(response.status()).toBe(200);
	expect(await response.json()).toMatchObject({ connected: false, configured: false });
});
