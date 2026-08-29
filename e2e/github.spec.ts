import { expect, test, type Page } from '@playwright/test';
import { FakeGitHub } from '../src/lib/core/github/fake';

/**
 * The personal-token path, end to end in a real browser.
 *
 * `api.github.com` is intercepted and answered by the same in-memory fake the
 * unit tests use, so this exercises the actual UI, the actual client, and the
 * actual repo initialization — everything except GitHub itself. The hosted
 * OAuth path can't be covered here because it needs real GitHub credentials.
 */
async function interceptGitHub(page: Page, fake: FakeGitHub) {
	await page.route('https://api.github.com/**', async (route) => {
		const request = route.request();

		// Real GitHub answers preflights; the Authorization header triggers one.
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: cors() });
			return;
		}

		const url = new URL(request.url());
		const response = await fake.transport('pat').request(url.pathname + url.search, {
			method: request.method(),
			body: request.postData() ?? undefined
		});

		await route.fulfill({
			status: response.status,
			headers: { ...Object.fromEntries(response.headers), ...cors() },
			body: await response.text()
		});
	});
}

function cors(): Record<string, string> {
	return {
		'access-control-allow-origin': '*',
		'access-control-allow-headers': '*',
		'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
		'access-control-expose-headers': '*'
	};
}

test('connects with a token, picks a repo, and lands the first commit', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(page, fake);

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();

	await expect(page.getByText('Connected as')).toBeVisible();
	await expect(page.getByText('nishant/journal')).toBeVisible();

	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();

	// Choosing a repo returns you to writing.
	await expect(page).toHaveURL(/\/$/);
	await expect(page.locator('.cm-content')).toBeVisible();

	// And the repository is now a journal.
	const config = await fake.readFile('nishant/journal', 'main', '.likh/config.json');
	expect(JSON.parse(config!)).toMatchObject({ version: 1, journalDir: 'journal' });

	const readme = await fake.readFile('nishant/journal', 'main', 'README.md');
	expect(readme).toContain('One markdown file per day');
});

test('remembers the repository across a reload', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(page, fake);

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();
	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);

	await page.reload();
	await page.getByLabel('Syncing').click();

	await expect(page.getByText(/committing to/i)).toBeVisible();
	await expect(page.getByText('nishant/journal')).toBeVisible();
});

test('shows only repositories that can be written to', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	fake.addRepo('someorg/docs', { canPush: false });
	await interceptGitHub(page, fake);

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();

	await expect(page.getByText('nishant/journal')).toBeVisible();
	// A repo likh could not commit to would be a dead end, so it isn't offered.
	await expect(page.getByText('someorg/docs')).toHaveCount(0);
});

test('rejects a token GitHub does not accept, without storing it', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(page, fake);
	fake.failNext(401, 1, 'Bad credentials');

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('not-a-real-token');
	await page.getByRole('button', { name: /use this token/i }).click();

	await expect(page.getByRole('alert')).toContainText(/bad credentials/i);
	// Still disconnected: a token that failed verification is never stored.
	await expect(page.getByText('Connected as')).toHaveCount(0);
});

test('disconnecting clears the repository', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(page, fake);

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();
	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);

	await page.getByLabel('Syncing').click();
	await page.getByRole('button', { name: /disconnect/i }).click();

	await expect(page.getByText(/stored on this device only/i)).toBeVisible();
});

test('initializing twice makes no second commit', async ({ page }) => {
	const fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo('nishant/journal');
	await interceptGitHub(page, fake);

	await page.goto('/connect');
	await page.getByRole('button', { name: /personal access token/i }).click();
	await page.getByLabel(/fine-grained token/i).fill('github_pat_test');
	await page.getByRole('button', { name: /use this token/i }).click();
	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);

	const repo = fake.repos.get('nishant/journal')!;
	const first = repo.refs.get('main');

	// Choosing the same repo again must not add an empty commit on top.
	await page.goto('/connect');
	await page
		.getByRole('button', { name: /use this/i })
		.first()
		.click();
	await expect(page).toHaveURL(/\/$/);

	expect(repo.refs.get('main')).toBe(first);
});
