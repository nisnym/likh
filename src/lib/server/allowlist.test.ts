import { describe, expect, it } from 'vitest';
import { isAllowed } from './allowlist';

describe('isAllowed', () => {
	it('permits every endpoint likh actually uses', () => {
		const allowed: Array<[string, string]> = [
			['GET', '/user'],
			['GET', '/user/installations'],
			['GET', '/user/installations/12345/repositories'],
			['GET', '/user/repos'],
			['GET', '/repos/nishant/journal'],
			['GET', '/repos/nishant/journal/git/ref/heads/main'],
			['GET', '/repos/nishant/journal/git/ref/heads/feature/nested-name'],
			['GET', '/repos/nishant/journal/git/commits/a1b2c3d4'],
			['GET', '/repos/nishant/journal/git/trees/a1b2c3d4'],
			['GET', '/repos/nishant/journal/git/blobs/a1b2c3d4'],
			['POST', '/repos/nishant/journal/git/blobs'],
			['POST', '/repos/nishant/journal/git/trees'],
			['POST', '/repos/nishant/journal/git/commits'],
			['POST', '/repos/nishant/journal/git/refs'],
			['PATCH', '/repos/nishant/journal/git/refs/heads/main']
		];

		for (const [method, path] of allowed) {
			expect(isAllowed(method, path), `${method} ${path}`).toBe(true);
		}
	});

	it('refuses endpoints outside the journal workflow', () => {
		const denied: Array<[string, string]> = [
			// Reading every repo, or anything about other people.
			['GET', '/users/someone/repos'],
			['GET', '/user/emails'],
			['GET', '/user/keys'],
			// Destructive or out-of-scope writes.
			['DELETE', '/repos/nishant/journal'],
			['POST', '/user/repos'],
			['PUT', '/repos/nishant/journal/contents/x.md'],
			['POST', '/repos/nishant/journal/issues'],
			['DELETE', '/repos/nishant/journal/git/refs/heads/main'],
			['POST', '/repos/nishant/journal/hooks'],
			['GET', '/repos/nishant/journal/collaborators']
		];

		for (const [method, path] of denied) {
			expect(isAllowed(method, path), `${method} ${path}`).toBe(false);
		}
	});

	it('refuses path traversal and smuggled separators', () => {
		expect(isAllowed('GET', '/repos/a/b/../../user/keys')).toBe(false);
		expect(isAllowed('GET', '/user/../user/emails')).toBe(false);
		expect(isAllowed('GET', '/repos/a%2f..%2fb/git/trees/abcd')).toBe(false);
		expect(isAllowed('GET', '/repos/a\\b/git/trees/abcd')).toBe(false);
	});

	it('refuses a path that is not rooted', () => {
		expect(isAllowed('GET', 'user')).toBe(false);
		expect(isAllowed('GET', 'https://evil.example/user')).toBe(false);
	});

	it('does not let a method sneak past on an allowed path', () => {
		expect(isAllowed('DELETE', '/user')).toBe(false);
		expect(isAllowed('PATCH', '/repos/nishant/journal/git/trees')).toBe(false);
		expect(isAllowed('POST', '/repos/nishant/journal/git/refs/heads/main')).toBe(false);
	});

	it('matches methods case-insensitively', () => {
		expect(isAllowed('get', '/user')).toBe(true);
	});

	it('does not treat a sha pattern as a wildcard', () => {
		// Uppercase or over-long SHAs are not something the client produces.
		expect(isAllowed('GET', '/repos/a/b/git/trees/NOTAHEXSHA')).toBe(false);
		expect(isAllowed('GET', '/repos/a/b/git/trees/main')).toBe(false);
	});
});
