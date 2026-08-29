import { beforeEach, describe, expect, it } from 'vitest';
import { GitHubClient } from './client';
import { GitHubError, NetworkError } from './errors';
import { FakeGitHub } from './fake';
import { initializeRepo } from './init';
import { CONFIG_PATH, README_PATH } from '../repo/paths';
import type { Transport } from './transport';

const REPO = { owner: 'testuser', name: 'journal', branch: 'main' };

let fake: FakeGitHub;
let client: GitHubClient;

beforeEach(() => {
	fake = new FakeGitHub();
	fake.addRepo('testuser/journal');
	client = new GitHubClient(fake.transport());
});

describe('identity', () => {
	it('reads the signed-in user', async () => {
		await expect(client.getUser()).resolves.toEqual({
			login: 'testuser',
			name: 'Test User',
			avatarUrl: null
		});
	});

	it('lists writable repositories', async () => {
		fake.addRepo('testuser/notes');
		fake.addRepo('someorg/readonly', { canPush: false });

		const repos = await client.listRepos();

		expect(repos.map((repo) => repo.fullName).sort()).toEqual([
			'testuser/journal',
			'testuser/notes'
		]);
	});

	it('lists repositories in personal-token mode too', async () => {
		const pat = new GitHubClient(fake.transport('pat'));

		expect((await pat.listRepos()).map((repo) => repo.fullName)).toEqual(['testuser/journal']);
	});
});

describe('refs', () => {
	it('returns null for a branch that does not exist', async () => {
		await expect(client.getRef(REPO)).resolves.toBeNull();
	});

	it('reads the head once there is one', async () => {
		const sha = await fake.commit('testuser/journal', 'main', { 'a.md': 'hello' });

		await expect(client.getRef(REPO)).resolves.toBe(sha);
	});

	it('refuses a non-fast-forward update', async () => {
		await fake.commit('testuser/journal', 'main', { 'a.md': 'one' });
		const stale = await client.getRef(REPO);

		// Another device pushes while we were writing.
		await fake.commit('testuser/journal', 'main', { 'a.md': 'two' });

		const tree = await client.createTree(REPO, null, [
			{ path: 'a.md', mode: '100644', type: 'blob', content: 'three' }
		]);
		const commit = await client.createCommit(REPO, 'mine', tree, [stale!]);

		await expect(client.updateRef(REPO, commit)).rejects.toSatisfy(
			(error: GitHubError) => error.isRefConflict
		);
	});
});

describe('objects', () => {
	it('round-trips a blob', async () => {
		const bytes = new TextEncoder().encode('journal entry');
		const sha = await client.createBlob(REPO, bytes);

		await expect(client.getBlob(REPO, sha)).resolves.toEqual(bytes);
	});

	it('gives a blob the SHA real git would', async () => {
		// The fake hashes with the real algorithm, so this pins the client to
		// something the sync engine can also compute locally.
		const sha = await client.createBlob(REPO, new TextEncoder().encode('hello\n'));

		expect(sha).toBe('ce013625030ba8dba906f756967f9e9ca394464a');
	});

	it('writes many files in a single tree', async () => {
		const tree = await client.createTree(REPO, null, [
			{ path: 'journal/2026/August/27.md', mode: '100644', type: 'blob', content: 'one' },
			{ path: 'journal/2026/August/28.md', mode: '100644', type: 'blob', content: 'two' }
		]);
		const commit = await client.createCommit(REPO, 'two days', tree, []);
		await client.createRef(REPO, commit);

		const result = await client.getTree(REPO, tree);

		expect(result.entries.map((entry) => entry.path)).toEqual([
			'journal/2026/August/27.md',
			'journal/2026/August/28.md'
		]);
		expect(result.truncated).toBe(false);
	});

	it('carries unchanged files forward through base_tree', async () => {
		await fake.commit('testuser/journal', 'main', { 'keep.md': 'untouched', 'edit.md': 'before' });
		const head = await client.getRef(REPO);
		const base = (await client.getCommit(REPO, head!)).treeSha;

		const tree = await client.createTree(REPO, base, [
			{ path: 'edit.md', mode: '100644', type: 'blob', content: 'after' }
		]);
		const commit = await client.createCommit(REPO, 'edit one file', tree, [head!]);
		await client.updateRef(REPO, commit);

		expect(await fake.readFile('testuser/journal', 'main', 'keep.md')).toBe('untouched');
		expect(await fake.readFile('testuser/journal', 'main', 'edit.md')).toBe('after');
	});
});

describe('errors', () => {
	it('classifies a missing repository', async () => {
		await expect(client.getRepo('testuser', 'nope')).rejects.toSatisfy(
			(error: unknown) => error instanceof GitHubError && error.isNotFound
		);
	});

	it('recognises exhausted rate limits', () => {
		const limited = new GitHubError(403, 'rate limited', {
			remaining: 0,
			reset: 1,
			retryAfterMs: null
		});
		const forbidden = new GitHubError(403, 'no access', {
			remaining: 4999,
			reset: 1,
			retryAfterMs: null
		});

		expect(limited.isRateLimited).toBe(true);
		expect(forbidden.isRateLimited).toBe(false);
		expect(forbidden.isForbidden).toBe(true);
	});

	it('reports a dropped connection as a network failure, not a verdict', async () => {
		const offline: Transport = {
			mode: 'bff',
			request: () => Promise.reject(new NetworkError('offline', null))
		};

		await expect(new GitHubClient(offline).getUser()).rejects.toBeInstanceOf(NetworkError);
	});

	it('surfaces the message GitHub sent', async () => {
		fake.failNext(422, 1, 'Reference already exists');

		await expect(client.getUser()).rejects.toThrow('Reference already exists');
	});
});

describe('initializeRepo', () => {
	it('creates the first commit in an empty repository', async () => {
		const result = await initializeRepo(client, REPO, { timezone: 'Asia/Kolkata' });

		expect(result.createdBranch).toBe(true);
		expect(result.written.sort()).toEqual([CONFIG_PATH, README_PATH].sort());

		const config = await fake.readFile('testuser/journal', 'main', CONFIG_PATH);
		expect(JSON.parse(config!)).toMatchObject({ version: 1, journalDir: 'journal' });
		expect(await fake.readFile('testuser/journal', 'main', README_PATH)).toContain('likh');
	});

	it('is a no-op the second time', async () => {
		await initializeRepo(client, REPO);
		const before = await client.getRef(REPO);

		const again = await initializeRepo(client, REPO);

		expect(again.written).toEqual([]);
		// No empty commit: the head must not have moved.
		expect(again.headSha).toBe(before);
		await expect(client.getRef(REPO)).resolves.toBe(before);
	});

	it('never overwrites a README the user already wrote', async () => {
		await fake.commit('testuser/journal', 'main', { [README_PATH]: '# My own words\n' });

		const result = await initializeRepo(client, REPO);

		expect(result.written).toEqual([CONFIG_PATH]);
		expect(await fake.readFile('testuser/journal', 'main', README_PATH)).toBe('# My own words\n');
	});

	it('adds to an existing repository without disturbing it', async () => {
		await fake.commit('testuser/journal', 'main', { 'src/main.ts': 'export {}\n' });

		const result = await initializeRepo(client, REPO);

		expect(result.createdBranch).toBe(false);
		expect(await fake.readFile('testuser/journal', 'main', 'src/main.ts')).toBe('export {}\n');
		expect(await fake.readFile('testuser/journal', 'main', CONFIG_PATH)).toBeTruthy();
	});
});
