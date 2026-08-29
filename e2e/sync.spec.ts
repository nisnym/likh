import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { FakeGitHub } from '../src/lib/core/github/fake';
import { dayPath } from '../src/lib/core/repo/paths';

/**
 * Syncing, driven through the real UI.
 *
 * `api.github.com` is answered by the in-memory fake, so two browser contexts
 * can share one "remote" and actually race each other.
 */

function todayKey(): string {
	const now = new Date();
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

interface Remote {
	/**
	 * Cut the connection to GitHub.
	 *
	 * `BrowserContext.setOffline` does not help here: an intercepted route is
	 * fulfilled inside Playwright and never touches the network, so the fake
	 * would keep answering. The interception has to refuse on its own.
	 */
	setOffline(offline: boolean): void;
}

async function interceptGitHub(context: BrowserContext, fake: FakeGitHub): Promise<Remote> {
	let offline = false;

	await context.route('https://api.github.com/**', async (route) => {
		if (offline) return route.abort('internetdisconnected');

		const request = route.request();
		const cors = {
			'access-control-allow-origin': '*',
			'access-control-allow-headers': '*',
			'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS'
		};
		if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });

		const url = new URL(request.url());
		const response = await fake.transport('pat').request(url.pathname + url.search, {
			method: request.method(),
			body: request.postData() ?? undefined
		});
		await route.fulfill({
			status: response.status,
			headers: { ...Object.fromEntries(response.headers), ...cors },
			body: await response.text()
		});
	});

	return {
		setOffline(next) {
			offline = next;
		}
	};
}

async function connect(page: Page) {
	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();
	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('.cm-content')).toBeVisible();
}

/** Append to the end of a given line, the way someone editing would. */
async function editLine(page: Page, line: number, text: string) {
	await page.locator('.cm-line').nth(line).click();
	await page.keyboard.press('End');
	await page.keyboard.insertText(text);
}

async function syncNow(page: Page) {
	await page.keyboard.press('ControlOrMeta+s');
}

async function expectSynced(page: Page) {
	await expect(page.locator('.indicator')).toContainText('Synced', { timeout: 15_000 });
}

/**
 * Wait until the app has counted the edit as work to do.
 *
 * `keyboard.press` returns once the key is dispatched; the save and the count
 * behind it are async. Without this, `expectSynced` can match the "Synced" left
 * over from the sync that ran when the repository was adopted, and whatever the
 * test asserts next reads a repository the edit has not reached yet.
 */
async function expectPending(page: Page) {
	await expect(page.locator('.indicator')).toContainText('to sync', { timeout: 15_000 });
}

test('commits what you write to the repository', async ({ page, context }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(context, fake);

	await connect(page);
	await page.locator('.cm-content').click();
	await page.keyboard.insertText('Shipped the sync layer today.');

	await expectPending(page);
	await syncNow(page);
	await expectSynced(page);

	const committed = await fake.readFile('nishant/journal', 'main', dayPath(todayKey()));
	expect(committed).toContain('Shipped the sync layer today.');
	expect(committed).toContain(`date: ${todayKey()}`);
});

test('commits nothing until you press sync', async ({ page, context }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(context, fake);

	await connect(page);
	await page.locator('.cm-content').click();
	await page.keyboard.insertText('not ready to publish this one yet');

	// The moment auto-sync would have read as permission: the network coming
	// back. Plus a stretch of not typing, which is the other one.
	await context.setOffline(true);
	await context.setOffline(false);
	await page.waitForTimeout(2_000);

	// The work is accounted for, and none of it has left the device.
	await expect(page.locator('.indicator')).toContainText('to sync');
	expect(await fake.readFile('nishant/journal', 'main', dayPath(todayKey()))).toBeNull();

	await syncNow(page);
	await expectSynced(page);
	expect(await fake.readFile('nishant/journal', 'main', dayPath(todayKey()))).toContain(
		'not ready to publish this one yet'
	);
});

test('queues work while offline and commits it on reconnect', async ({ page, context }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	const remote = await interceptGitHub(context, fake);

	await connect(page);
	remote.setOffline(true);
	await context.setOffline(true);

	await page.locator('.cm-content').click();
	await page.keyboard.insertText('written on a train');
	await expectPending(page);
	await syncNow(page);

	// Nothing reached the remote, and the app says so rather than pretending.
	await expect(page.locator('.indicator')).toContainText(/Offline|to sync/, { timeout: 15_000 });
	expect(await fake.readFile('nishant/journal', 'main', dayPath(todayKey()))).toBeNull();

	remote.setOffline(false);
	await context.setOffline(false);
	await syncNow(page);
	await expectSynced(page);

	expect(await fake.readFile('nishant/journal', 'main', dayPath(todayKey()))).toContain(
		'written on a train'
	);
});

test('picks up an entry another device wrote', async ({ page, context }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(context, fake);

	await connect(page);
	await expectSynced(page);

	// Another device commits into today while this one is open.
	await fake.commit('nishant/journal', 'main', {
		[dayPath(todayKey())]: `---\ndate: ${todayKey()}\n---\n\nfrom the other device\n`
	});

	await syncNow(page);

	await expect(page.locator('.cm-content')).toContainText('from the other device', {
		timeout: 15_000
	});
});

test('two devices editing the same day both keep their words', async ({ browser }, testInfo) => {
	// The merge is the subject here, not the viewport.
	test.skip(testInfo.project.name !== 'desktop', 'desktop only');

	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');

	const laptop = await browser.newContext();
	const phone = await browser.newContext();
	const laptopRemote = await interceptGitHub(laptop, fake);
	const phoneRemote = await interceptGitHub(phone, fake);

	const a = await laptop.newPage();
	const b = await phone.newPage();

	// The laptop writes the day and syncs it.
	await connect(a);
	await a.locator('.cm-content').click();
	await a.keyboard.insertText('morning notes');
	await a.keyboard.insertText('\nafternoon notes');
	await a.keyboard.insertText('\nevening notes');
	await expectPending(a);
	await syncNow(a);
	await expectSynced(a);

	// The phone picks it up.
	await connect(b);
	await expect(b.locator('.cm-content')).toContainText('afternoon notes', { timeout: 15_000 });

	// Both go offline and edit different parts of the same day.
	laptopRemote.setOffline(true);
	phoneRemote.setOffline(true);

	await editLine(a, 0, ' — from the laptop');
	await editLine(b, 2, ' — from the phone');

	// The laptop reconnects first and wins the race to the remote.
	laptopRemote.setOffline(false);
	await expectPending(a);
	await syncNow(a);
	await expectSynced(a);

	// The phone then reconnects and has to merge.
	phoneRemote.setOffline(false);
	await expectPending(b);
	await syncNow(b);
	await expectSynced(b);

	// Neither device lost a word.
	const merged = await fake.readFile('nishant/journal', 'main', dayPath(todayKey()));
	expect(merged).toContain('from the laptop');
	expect(merged).toContain('from the phone');
	expect(merged).not.toContain('<<<<<<<');

	// And the laptop converges on the same text once it syncs again.
	await syncNow(a);
	await expect(a.locator('.cm-content')).toContainText('from the phone', { timeout: 15_000 });
	await expect(b.locator('.cm-content')).toContainText('from the laptop', { timeout: 15_000 });

	await laptop.close();
	await phone.close();
});

test('surfaces a real conflict instead of choosing for you', async ({ browser }, testInfo) => {
	test.skip(testInfo.project.name !== 'desktop', 'desktop only');

	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');

	const laptop = await browser.newContext();
	const phone = await browser.newContext();
	const laptopRemote = await interceptGitHub(laptop, fake);
	const phoneRemote = await interceptGitHub(phone, fake);

	const a = await laptop.newPage();
	const b = await phone.newPage();

	await connect(a);
	await a.locator('.cm-content').click();
	await a.keyboard.insertText('one');
	await a.keyboard.insertText('\ntwo');
	await expectPending(a);
	await syncNow(a);
	await expectSynced(a);

	await connect(b);
	await expect(b.locator('.cm-content')).toContainText('two', { timeout: 15_000 });

	// Both edit the same line.
	laptopRemote.setOffline(true);
	phoneRemote.setOffline(true);
	await editLine(a, 1, ' LAPTOP');
	await editLine(b, 1, ' PHONE');

	laptopRemote.setOffline(false);
	await expectPending(a);
	await syncNow(a);
	await expectSynced(a);

	phoneRemote.setOffline(false);
	await expectPending(b);
	await syncNow(b);

	// The phone is told, and both versions are in front of it.
	await expect(b.locator('.indicator')).toContainText('conflict', { timeout: 15_000 });
	await expect(b.locator('.cm-content')).toContainText('LAPTOP');
	await expect(b.locator('.cm-content')).toContainText('PHONE');

	// The region reads as machinery, not as mangled markdown: markers are marked
	// up as markers, and nothing has been turned into a heading or a blockquote
	// by `=======` and `>>>>>>>`.
	await expect(b.locator('.cm-line.likh-conflict-marker')).toHaveCount(3);
	await expect(b.locator('.cm-line.likh-h1')).toHaveCount(0);
	await expect(b.locator('.cm-line.likh-quote')).toHaveCount(0);

	// Nothing half-merged reached the repository.
	expect(await fake.readFile('nishant/journal', 'main', dayPath(todayKey()))).not.toContain(
		'<<<<<<<'
	);

	// Resolving it commits the choice.
	await b.getByRole('button', { name: /keep this device/i }).click();
	await expectPending(b);
	await syncNow(b);
	await expectSynced(b);

	const resolved = await fake.readFile('nishant/journal', 'main', dayPath(todayKey()));
	expect(resolved).toContain('PHONE');
	expect(resolved).not.toContain('<<<<<<<');

	await laptop.close();
	await phone.close();
});
