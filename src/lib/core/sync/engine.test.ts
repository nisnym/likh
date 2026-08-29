import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { getDay, listAllDays, saveDay } from '../db/days';
import { getMeta, setMeta } from '../db/kv';
import { resetDb } from '../db/schema';
import type { RepoRef } from '../db/types';
import { GitHubClient } from '../github/client';
import { GitHubError } from '../github/errors';
import { FakeGitHub } from '../github/fake';
import { initializeRepo } from '../github/init';
import { hasConflictMarkers } from '../markdown/conflict';
import { dayToText } from '../repo/day-file';
import { dayPath } from '../repo/paths';
import { commitMessage, pull, push, retryDelayFor, sync, TruncatedTreeError } from './engine';

const REPO: RepoRef = { owner: 'nishant', name: 'journal', branch: 'main' };
const FULL = 'nishant/journal';

let fake: FakeGitHub;
let deps: { client: GitHubClient; repo: RepoRef };

beforeEach(async () => {
	await resetDb();
	fake = new FakeGitHub({ login: 'nishant' });
	fake.addRepo(FULL);
	deps = { client: new GitHubClient(fake.transport()), repo: REPO };
	await setMeta({ repo: REPO });
});

/** What another device would have committed for a given day. */
function remoteDay(date: string, body: string, tags: string[] = []): Record<string, string> {
	return { [dayPath(date)]: dayToText({ date, body, tags, extra: [] }) };
}

async function headOf(): Promise<string | undefined> {
	return fake.repos.get(FULL)!.refs.get('main');
}

describe('first sync', () => {
	it('creates the branch in an empty repository', async () => {
		await saveDay('2026-08-28', { body: 'first entry' });

		const report = await sync(deps);

		expect(report.pushed).toBe(1);
		expect(report.commitSha).toBeTruthy();
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).toContain('first entry');
	});

	it('commits several offline days as one commit', async () => {
		for (const [date, body] of [
			['2026-08-26', 'monday'],
			['2026-08-27', 'tuesday'],
			['2026-08-28', 'wednesday']
		]) {
			await saveDay(date, { body });
		}

		const report = await sync(deps);

		expect(report.pushed).toBe(3);
		// One commit, not three: the whole point of coalescing.
		const repo = fake.repos.get(FULL)!;
		expect(repo.commits.size).toBe(1);
		expect(repo.commits.get(report.commitSha!)!.message).toBe(
			'journal: 3 entries (2026-08-26..2026-08-28)'
		);
	});

	it('leaves nothing dirty afterwards', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		await sync(deps);

		const day = await getDay('2026-08-28');

		expect(day.dirty).toBe(0);
		expect(day.baseText).toBe(dayToText(day));
		expect(day.baseBlobSha).toMatch(/^[0-9a-f]{40}$/);
	});
});

describe('idempotence', () => {
	it('makes no second commit when nothing changed', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		await sync(deps);
		const first = await headOf();

		const again = await sync(deps);

		expect(again.pushed).toBe(0);
		expect(again.commitSha).toBeNull();
		expect(await headOf()).toBe(first);
	});

	it('makes no commit when an edit is undone before syncing', async () => {
		await saveDay('2026-08-28', { body: 'original' });
		await sync(deps);
		const first = await headOf();

		await saveDay('2026-08-28', { body: 'changed' });
		await saveDay('2026-08-28', { body: 'original' });
		const report = await sync(deps);

		expect(report.pushed).toBe(0);
		expect(await headOf()).toBe(first);
	});
});

describe('pulling', () => {
	it('brings a new device fully up to date', async () => {
		await fake.commit(FULL, 'main', {
			...remoteDay('2026-08-27', 'tuesday'),
			...remoteDay('2026-08-28', 'wednesday')
		});

		const report = await pull(deps);

		expect(report.pulled).toBe(2);
		expect((await getDay('2026-08-27')).body).toBe('tuesday');
		expect((await getDay('2026-08-28')).body).toBe('wednesday');
		// Pulled days are not dirty — nothing to push straight back.
		expect((await getDay('2026-08-28')).dirty).toBe(0);
	});

	it('fast-forwards a clean local day', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'from elsewhere'));
		await pull(deps);

		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'edited elsewhere'));
		await pull(deps);

		expect((await getDay('2026-08-28')).body).toBe('edited elsewhere');
	});

	it('does not refetch blobs it already holds', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'entry'));
		await pull(deps);

		// A second, unrelated commit moves the head but not this day.
		await fake.commit(FULL, 'main', remoteDay('2026-08-27', 'other day'));
		const before = fake.calls.filter((call) => call.path.includes('/git/blobs/')).length;
		await pull(deps);
		const after = fake.calls.filter((call) => call.path.includes('/git/blobs/')).length;

		// Exactly one blob fetched: the day that actually changed.
		expect(after - before).toBe(1);
	});

	it('does nothing when the head has not moved', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'entry'));
		await pull(deps);

		const before = fake.calls.length;
		const report = await pull(deps);

		expect(report.pulled).toBe(0);
		// One request — reading the ref — and then it stops.
		expect(fake.calls.length - before).toBe(1);
	});

	it('refuses to work from a truncated tree', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'entry'));
		fake.truncateTrees = true;

		// A truncated tree looks exactly like one where files were deleted, so
		// acting on it could delete entries that are perfectly fine.
		await expect(pull(deps)).rejects.toBeInstanceOf(TruncatedTreeError);
	});
});

describe('merging', () => {
	it('merges edits to different parts of the same day', async () => {
		await saveDay('2026-08-28', { body: 'morning\nafternoon\nevening' });
		await sync(deps);

		// Another device edits the last line.
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'morning\nafternoon\nEVENING'));
		// This device edits the first.
		await saveDay('2026-08-28', { body: 'MORNING\nafternoon\nevening' });

		const report = await sync(deps);

		expect(report.merged).toBe(1);
		expect(report.conflicts).toEqual([]);
		expect((await getDay('2026-08-28')).body).toBe('MORNING\nafternoon\nEVENING');
		// And the merged text is what the repo now holds.
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).toContain(
			'MORNING\nafternoon\nEVENING'
		);
	});

	it('keeps both versions when the same line was edited twice', async () => {
		await saveDay('2026-08-28', { body: 'one\ntwo\nthree' });
		await sync(deps);

		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'one\nTHEIRS\nthree'));
		await saveDay('2026-08-28', { body: 'one\nMINE\nthree' });

		const report = await sync(deps);

		expect(report.conflicts).toEqual(['2026-08-28']);
		const day = await getDay('2026-08-28');
		expect(day.conflicted).toBe(1);
		expect(hasConflictMarkers(day.body)).toBe(true);
		expect(day.body).toContain('MINE');
		expect(day.body).toContain('THEIRS');
	});

	it('never pushes conflict markers to the repository', async () => {
		await saveDay('2026-08-28', { body: 'one\ntwo' });
		await sync(deps);

		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'one\nTHEIRS'));
		await saveDay('2026-08-28', { body: 'one\nMINE' });
		const report = await sync(deps);

		expect(report.skipped).toEqual(['2026-08-28']);
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).not.toContain('<<<<<<<');
	});

	it('pushes other days even while one is conflicted', async () => {
		await saveDay('2026-08-28', { body: 'one' });
		await sync(deps);

		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'THEIRS'));
		await saveDay('2026-08-28', { body: 'MINE' });
		await saveDay('2026-08-27', { body: 'unrelated day' });

		const report = await sync(deps);

		expect(report.skipped).toEqual(['2026-08-28']);
		expect(report.pushed).toBe(1);
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-27'))).toContain('unrelated day');
	});

	it('pushes a day once its conflict is resolved', async () => {
		await saveDay('2026-08-28', { body: 'one' });
		await sync(deps);
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'THEIRS'));
		await saveDay('2026-08-28', { body: 'MINE' });
		await sync(deps);

		await saveDay('2026-08-28', { body: 'resolved by hand' });
		const report = await sync(deps);

		expect(report.skipped).toEqual([]);
		expect(report.pushed).toBe(1);
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).toContain('resolved by hand');
	});
});

describe('racing another device', () => {
	it('rejects a push built on a stale ref', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		await sync(deps);

		// Another device pushes; this one does not know yet.
		await fake.commit(FULL, 'main', remoteDay('2026-08-26', 'from elsewhere'));
		await saveDay('2026-08-27', { body: 'written here' });

		await expect(push(deps)).rejects.toSatisfy(
			(error: unknown) => error instanceof GitHubError && error.isRefConflict
		);
	});

	it('recovers by pulling and retrying', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		await sync(deps);

		await fake.commit(FULL, 'main', remoteDay('2026-08-26', 'from elsewhere'));
		await saveDay('2026-08-27', { body: 'written here' });

		const report = await sync(deps);

		expect(report.pushed).toBe(1);
		// Both devices' work survives.
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-26'))).toContain('from elsewhere');
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-27'))).toContain('written here');
	});
});

describe('interrupted syncs', () => {
	it('leaves no half-applied state when the ref update fails', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		fake.failOn({ method: 'POST', path: /\/git\/refs$/ }, 500, 1, 'boom');

		await expect(sync(deps)).rejects.toThrow('boom');

		// The commit object may exist, but nothing points at it and the day is
		// still marked unsynced.
		expect(await headOf()).toBeUndefined();
		expect((await getDay('2026-08-28')).dirty).toBe(1);
	});

	it('replays to exactly one commit', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		fake.failOn({ method: 'POST', path: /\/git\/refs$/ }, 500, 1, 'boom');
		await expect(sync(deps)).rejects.toThrow('boom');

		const report = await sync(deps);

		expect(report.pushed).toBe(1);
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).toContain('entry');
		// The branch has one commit on it, not two.
		const head = await headOf();
		expect(fake.repos.get(FULL)!.commits.get(head!)!.parents).toEqual([]);
	});

	it('keeps a day dirty when the network drops mid-sync', async () => {
		await saveDay('2026-08-28', { body: 'entry' });
		fake.failNext(500, 1);

		await expect(sync(deps)).rejects.toThrow();

		expect((await getDay('2026-08-28')).dirty).toBe(1);
		expect((await getMeta()).headSha).toBeNull();
	});
});

describe('remote deletions', () => {
	it('removes a clean day deleted on the remote', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'entry'));
		await pull(deps);
		expect((await listAllDays()).length).toBe(1);

		await fake.deleteFile(FULL, 'main', dayPath('2026-08-28'));
		await pull(deps);

		expect(await listAllDays()).toEqual([]);
	});

	it('keeps a day with unpushed edits, and restores it', async () => {
		await fake.commit(FULL, 'main', remoteDay('2026-08-28', 'entry'));
		await pull(deps);

		await saveDay('2026-08-28', { body: 'edited here, not yet pushed' });
		await fake.deleteFile(FULL, 'main', dayPath('2026-08-28'));

		const report = await sync(deps);

		// Words this device has and nowhere else does must not vanish.
		expect((await getDay('2026-08-28')).body).toBe('edited here, not yet pushed');
		expect(report.pushed).toBe(1);
		expect(await fake.readFile(FULL, 'main', dayPath('2026-08-28'))).toContain(
			'edited here, not yet pushed'
		);
	});
});

describe('coexisting with the rest of the repo', () => {
	it('leaves unrelated files alone', async () => {
		await initializeRepo(deps.client, REPO);
		await fake.commit(FULL, 'main', { 'notes/todo.md': 'not a journal file\n' });

		await saveDay('2026-08-28', { body: 'entry' });
		await sync(deps);

		expect(await fake.readFile(FULL, 'main', 'notes/todo.md')).toBe('not a journal file\n');
		expect(await fake.readFile(FULL, 'main', 'README.md')).toContain('likh');
	});

	it('ignores non-journal files when pulling', async () => {
		await fake.commit(FULL, 'main', {
			'README.md': '# hello\n',
			'journal/2026/August/notes.md': 'not a day\n',
			...remoteDay('2026-08-28', 'a real day')
		});

		const report = await pull(deps);

		expect(report.pulled).toBe(1);
		expect((await listAllDays()).map((day) => day.date)).toEqual(['2026-08-28']);
	});
});

describe('commitMessage', () => {
	it('names a single day', () => {
		expect(commitMessage(['2026-08-28'])).toBe('journal: 2026-08-28');
	});

	it('summarises a range', () => {
		expect(commitMessage(['2026-08-28', '2026-08-26', '2026-08-27'])).toBe(
			'journal: 3 entries (2026-08-26..2026-08-28)'
		);
	});
});

describe('retryDelayFor', () => {
	it('uses Retry-After when the server sent one', () => {
		const error = new GitHubError(403, 'slow down', {
			remaining: 0,
			reset: null,
			retryAfterMs: 60_000
		});

		expect(retryDelayFor(error)).toBe(60_000);
	});

	it('waits for the rate-limit reset when that is all it has', () => {
		const reset = Math.floor(Date.now() / 1000) + 120;
		const error = new GitHubError(403, 'rate limited', { remaining: 0, reset, retryAfterMs: null });

		expect(retryDelayFor(error)).toBeGreaterThan(100_000);
	});

	it('leaves ordinary failures to exponential backoff', () => {
		expect(retryDelayFor(new Error('network'))).toBeNull();
		expect(
			retryDelayFor(
				new GitHubError(500, 'server error', { remaining: 4999, reset: null, retryAfterMs: null })
			)
		).toBeNull();
	});
});
