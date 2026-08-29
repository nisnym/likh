import { expect, test, type Page } from '@playwright/test';

/** The editor is lazy-loaded; wait for the real surface, not the placeholder. */
async function editor(page: Page) {
	const surface = page.locator('.cm-content');
	await expect(surface).toBeVisible();
	return surface;
}

async function write(page: Page, text: string) {
	const surface = await editor(page);
	await surface.click();
	await page.keyboard.insertText(text);
	return surface;
}

test('the toolbar marks the word the caret is in', async ({ page }) => {
	await page.goto('/');
	const surface = await write(page, 'hello world');

	await page.getByRole('button', { name: 'Bold' }).click();
	await expect(surface).toContainText('hello **world**');

	// Pressing it again takes the markers back off, leaving what was there.
	await page.getByRole('button', { name: 'Bold' }).click();
	await expect(surface).toHaveText('hello world');
});

test('the keyboard shortcut and the button do the same thing', async ({ page }) => {
	await page.goto('/');
	const surface = await write(page, 'hello world');

	await page.keyboard.press('ControlOrMeta+i');
	await expect(surface).toContainText('hello *world*');
});

test('every shortcut the toolbar advertises actually fires', async ({ page }) => {
	await page.goto('/');
	const surface = await write(page, 'a line');

	// Shift plus a digit is the one shape worth checking: the browser reports the
	// shifted character, and a keymap that matched only the digit would leave the
	// tooltip promising something that never happens.
	await page.keyboard.press('ControlOrMeta+Shift+8');
	await expect(page.locator('.cm-line.likh-list')).toHaveCount(1);

	await page.keyboard.press('ControlOrMeta+Shift+h');
	await expect(page.locator('.cm-line.likh-h1')).toHaveCount(1);

	await page.keyboard.press('ControlOrMeta+Shift+k');
	await expect(surface).toContainText('](url)');
});

test('the toolbar turns a line into a heading and a list', async ({ page }) => {
	await page.goto('/');
	await write(page, 'a line');

	await page.getByRole('button', { name: 'Heading' }).click();
	await expect(page.locator('.cm-line.likh-h1')).toHaveCount(1);

	// Heading cycles rather than toggling, so a second press deepens it.
	await page.getByRole('button', { name: 'Heading' }).click();
	await expect(page.locator('.cm-line.likh-h2')).toHaveCount(1);

	await page.getByRole('button', { name: 'Bulleted list' }).click();
	await expect(page.locator('.cm-line.likh-list')).toHaveCount(1);
	// One block marker per line: the heading was replaced, not stacked on.
	await expect(page.locator('.cm-line.likh-h2')).toHaveCount(0);
});

test('formatting is saved like anything else typed', async ({ page }) => {
	await page.goto('/');
	await write(page, 'remember this');

	await page.getByRole('button', { name: 'Bold' }).click();
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.reload();
	await expect(await editor(page)).toContainText('remember **this**');
});

test('a closed day offers no toolbar at all', async ({ page }) => {
	await page.goto('/');
	await editor(page);

	await page.getByLabel('Previous day').click();
	await expect(page.getByRole('button', { name: 'Add a note' })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Bold' })).toHaveCount(0);
});

test('a template goes in where the caret is, and stays', async ({ page }) => {
	await page.goto('/');
	await write(page, 'before the template');

	await page.getByRole('button', { name: 'Template', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Daily' }).click();

	const surface = await editor(page);
	await expect(surface).toContainText('What happened');
	await expect(surface).toContainText('before the template');
	// No placeholder survives into the entry.
	await expect(surface).not.toContainText('{{');

	await expect(page.locator('.statusbar')).toContainText('Saved locally');
	await page.reload();
	await expect(await editor(page)).toContainText('What happened');
});

test('an empty day offers the chosen template, and never writes it uninvited', async ({ page }) => {
	await page.goto('/');
	await editor(page);

	await page.getByLabel('Writing settings').click();
	await page.getByLabel('Offer on an empty day').selectOption({ label: 'Daily' });
	// Escape rather than the scrim: the scrim covers the viewport but the sheet
	// sits on top of its centre, which is where a click would land.
	await page.keyboard.press('Escape');

	// Offered — and until it is taken, the day is still empty.
	const offer = page.getByRole('button', { name: /Start with/ });
	await expect(offer).toBeVisible();
	await expect(page.locator('.statusbar')).toContainText('0 words');

	await offer.click();
	await expect(await editor(page)).toContainText('What happened');
	await expect(offer).toHaveCount(0);
});
