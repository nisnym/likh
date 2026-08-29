import { expect, test, type Page } from '@playwright/test';

/**
 * Wait until a setting has reached IndexedDB, not merely the in-memory store.
 *
 * Settings are written the moment they change, but the write is a transaction
 * and a reload issued inside its commit window aborts it. A person choosing a
 * theme and then reloading has milliseconds of real time in between; a test has
 * none, so it has to wait for the thing it is about to assert survived.
 */
async function persisted(page: Page, field: string, value: string | number) {
	await expect
		.poll(() =>
			page.evaluate(
				(key) =>
					new Promise<unknown>((resolve) => {
						const open = indexedDB.open('likh');
						open.onerror = () => resolve(null);
						open.onsuccess = () => {
							const read = open.result.transaction('kv').objectStore('kv').get('settings');
							read.onerror = () => resolve(null);
							read.onsuccess = () =>
								resolve((read.result as Record<string, unknown>)?.[key] ?? null);
						};
					}),
				field
			)
		)
		.toBe(value);
}

test('opens on a light theme', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
});

test('a chosen theme survives a reload without a flash of the old one', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	await page.getByLabel('Theme').click();
	await page.getByRole('button', { name: 'Ember' }).click();
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
	await persisted(page, 'theme', 'ember');

	await page.reload();

	// Read before the app has had a chance to boot: this is the inline script in
	// `app.html` doing its job, which is the whole reason it exists.
	expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe('ember');
	await expect(page.locator('html')).toHaveAttribute('data-theme', 'ember');
});

test('the browser chrome follows the theme', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	const chrome = () =>
		page.evaluate(
			() => document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.content
		);

	const light = await chrome();
	await page.getByLabel('Theme').click();
	await page.getByRole('button', { name: 'Midnight' }).click();

	expect(await chrome()).not.toBe(light);
});

test('settings are three menus, not one', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	// Each icon opens its own menu directly, rather than a sheet you then have to
	// look through.
	await page.getByLabel('Writing settings').click();
	await expect(page.getByRole('tab', { name: 'Writing' })).toHaveAttribute('aria-selected', 'true');
	await expect(page.getByText('Line width')).toBeVisible();

	// Once open, the other two are one click away rather than a round trip.
	await page.getByRole('tab', { name: 'Theme' }).click();
	await expect(page.getByRole('button', { name: 'Sepia' })).toBeVisible();

	await page.getByRole('tab', { name: 'Syncing' }).click();
	await expect(page.getByText(/stored on this device only/i)).toBeVisible();

	await page.keyboard.press('Escape');
	await expect(page.getByRole('tab', { name: 'Syncing' })).toHaveCount(0);

	// And each icon opens its own menu, not a shared one you then search.
	await page.getByLabel('Theme').click();
	await expect(page.getByRole('tab', { name: 'Theme' })).toHaveAttribute('aria-selected', 'true');
});

test('the writing column and text size are settings', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('.cm-content')).toBeVisible();

	// Computed, not the inline style: what matters is the value in force, which
	// before the settings load comes from the stylesheet and after from `<html>`.
	const token = (name: string) => () =>
		page.evaluate(
			(property) => getComputedStyle(document.documentElement).getPropertyValue(property).trim(),
			name
		);
	const measure = token('--measure');
	const size = token('--editor-size');

	// The defaults in the stylesheet and in `DEFAULT_SETTINGS` are the same
	// values, so nothing shifts between the first paint and the settings landing.
	await expect.poll(measure).toBe('42rem');
	await expect.poll(size).toBe('19px');

	await page.getByLabel('Writing settings').click();
	await page.getByRole('button', { name: 'Wide' }).click();
	await page.getByLabel('25 pixels').click();

	await expect.poll(measure).toBe('52rem');
	await expect.poll(size).toBe('25px');

	// And they are in force before the app has booted, not a frame later.
	await persisted(page, 'lineWidth', 'wide');
	await persisted(page, 'fontSize', 25);
	await page.reload();
	expect(await measure()).toBe('52rem');
	expect(await size()).toBe('25px');
});
