import { expect, test, type Page } from '@playwright/test';

/** The editor is lazy-loaded; wait for the real surface, not the placeholder. */
async function editor(page: Page) {
	const surface = page.locator('.cm-content');
	await expect(surface).toBeVisible();
	return surface;
}

/** Yesterday is closed, so text reaches it through the note composer. */
async function addNote(page: Page, text: string) {
	await page.getByRole('button', { name: 'Add a note' }).click();
	await page.getByLabel('Note to add to this day').fill(text);
	await page.getByRole('button', { name: 'Save note' }).click();
}

function todayKey(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

test('writes an entry and keeps it across a reload', async ({ page }) => {
	await page.goto('/');

	const surface = await editor(page);
	await surface.click();
	await page.keyboard.type('Shipped the sync layer today.');

	await expect(page.locator('.statusbar')).toContainText('5 words');

	// The debounce is 400ms; give it room, then prove it reached IndexedDB.
	await expect(page.locator('.statusbar')).toContainText('Saved locally');
	await page.reload();

	await expect(await editor(page)).toContainText('Shipped the sync layer today.');
});

test('clicking the margin beside the text still puts you in the entry', async ({ page }) => {
	// The writing column is narrower than the editor, so most of what looks like
	// the page is scroller rather than text. Clicking there has to reach the
	// entry, or half the surface is dead.
	await page.goto('/');
	const surface = await editor(page);
	await surface.click();
	await page.keyboard.insertText('a line');

	const box = (await page.locator('.cm-scroller').boundingBox())!;
	await page.mouse.click(box.x + 12, box.y + box.height / 2);
	await page.keyboard.insertText(' and more');

	await expect(surface).toContainText('a line and more');
});

test('hides markdown syntax away from the cursor', async ({ page }) => {
	await page.goto('/');

	const surface = await editor(page);
	await surface.click();
	await page.keyboard.type('# A heading');
	// `insertText` rather than pressing Enter: under touch emulation Playwright's
	// synthesised Enter never reaches the editor, while `insertText` follows the
	// same `beforeinput` path a real soft keyboard uses. Verified to produce a
	// line break in both projects.
	await page.keyboard.insertText('\n');
	await page.keyboard.type('plain text');

	// The cursor now sits on line two, so line one's `#` is not painted — while
	// the character itself is still in the document and still gets saved.
	const heading = page.locator('.cm-line.likh-h1');
	await expect(heading).toHaveCount(1);
	await expect(heading).toHaveText('A heading');

	// Click into the heading and the markup comes back, so it can be edited.
	await heading.click();
	await expect(heading).toHaveText('# A heading');
});

test('navigates between days and keeps entries apart', async ({ page }) => {
	await page.goto('/');

	await (await editor(page)).click();
	await page.keyboard.type('today');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.getByLabel('Previous day').click();
	await expect(page).not.toHaveURL(/\/$/);
	await expect(await editor(page)).not.toContainText('today');

	await page.getByRole('button', { name: 'Today' }).click();
	await expect(page).toHaveURL(/\/$/);
	await expect(await editor(page)).toContainText('today');
});

test('marks written days in the calendar', async ({ page }) => {
	await page.goto('/');

	await (await editor(page)).click();
	await page.keyboard.type('something');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.getByLabel('Toggle calendar').click();

	const today = page.locator('.day.today');
	await expect(today).toHaveClass(/written/);
	await expect(today).toHaveAttribute('aria-label', new RegExp(String(new Date().getFullYear())));
});

test('a past day cannot be rewritten, only added to', async ({ page }) => {
	await page.goto('/');
	await (await editor(page)).click();
	await page.keyboard.type('what I thought at the time');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.getByLabel('Previous day').click();
	await (await editor(page)).click();
	await page.keyboard.type('this must not land');
	await expect(await editor(page)).not.toContainText('this must not land');

	// The way in is a note, and it says when it was written.
	await addNote(page, 'I remember it differently now.');

	const surface = await editor(page);
	await expect(surface).toContainText('I remember it differently now.');
	await expect(surface).toContainText(String(new Date().getFullYear()));

	// Today is untouched by any of it, and still writable.
	await page.getByRole('button', { name: 'Today' }).click();
	await expect(await editor(page)).toContainText('what I thought at the time');
});

test('an added note survives a reload, appended to what was there', async ({ page }) => {
	await page.goto('/');
	await (await editor(page)).click();
	await page.keyboard.type('the original entry');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	// Yesterday, written yesterday — then revisited.
	await page.getByLabel('Previous day').click();
	await addNote(page, 'first thought');
	await addNote(page, 'second thought');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.reload();
	const surface = await editor(page);
	const text = (await surface.textContent()) ?? '';

	expect(text.indexOf('first thought')).toBeLessThan(text.indexOf('second thought'));
});

test('works with no network at all', async ({ page, context }) => {
	// likh is offline-first, not offline-tolerant: a cold start with the network
	// down must still open and save.
	await page.goto('/');
	await editor(page);

	// Wait for the service worker to take control, or the reload below would be
	// testing the HTTP cache rather than the offline story.
	await page.waitForFunction(() => navigator.serviceWorker?.controller !== null);

	await context.setOffline(true);
	await page.reload();

	const surface = await editor(page);
	await surface.click();
	await page.keyboard.type('written on a train');

	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	// Proves the page came from the service worker and not the network.
	expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
});

test('URL carries the day', async ({ page }) => {
	await page.goto('/2026-03-14');

	// Weekday and month wording follow the browser locale, so assert on the
	// parts that don't move.
	const heading = page.locator('header h1');
	await expect(heading).toContainText('14');
	await expect(heading).toContainText(/March|Mar/);
	expect(todayKey()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('searches across entries', async ({ page }) => {
	await page.goto('/');

	await (await editor(page)).click();
	await page.keyboard.type('the merge strategy for offline edits');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.getByLabel('Previous day').click();
	await addNote(page, 'bought coffee beans');
	await expect(page.locator('.statusbar')).toContainText('Saved locally');

	await page.getByLabel('Search entries').click();
	await page.getByLabel('Search your journal').fill('merge');

	const hits = page.locator('.hit');
	await expect(hits).toHaveCount(1);
	await expect(hits.first()).toContainText('merge strategy');

	// Choosing a result navigates to that day.
	await hits.first().click();
	await expect(await editor(page)).toContainText('the merge strategy for offline edits');
});
