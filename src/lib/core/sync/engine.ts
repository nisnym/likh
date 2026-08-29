import type { DayKey } from '../date/day';
import { deleteDay, getDay, listAllDays, listDirtyDays, markSynced, putDay } from '../db/days';
import { getMeta, setMeta } from '../db/kv';
import type { DayRecord, RepoRef } from '../db/types';
import { blobSha } from '../git/object-id';
import type { GitHubClient } from '../github/client';
import { GitHubError } from '../github/errors';
import type { NewTreeEntry } from '../github/types';
import { dayToText, textToDayFields } from '../repo/day-file';
import { dayFromPath, dayPath } from '../repo/paths';
import { mergeDay } from './merge';

/**
 * The sync engine.
 *
 * Pull, merge, push. The whole design rests on one invariant: `baseText` is the
 * exact bytes we last knew were on the remote, and it is written *only* after a
 * successful pull or push — never after a local edit. Everything else follows
 * from that, including the ability to tell an incoming change from an outgoing
 * one without asking the user.
 *
 * There is no operation log. The set of work is derived from the `dirty` flag,
 * which makes sync idempotent: an interrupted push simply replays, and cannot
 * produce a duplicate commit.
 */

const MAX_REF_RETRIES = 3;
const decoder = new TextDecoder();

/** The remote tree was too large for GitHub to return whole. */
export class TruncatedTreeError extends Error {
	constructor() {
		super(
			'This repository is too large for likh to read in one request. ' +
				'A truncated tree cannot be told apart from one where files were deleted.'
		);
		this.name = 'TruncatedTreeError';
	}
}

export interface SyncDeps {
	client: GitHubClient;
	repo: RepoRef;
	/** Shown in conflict markers, so you can tell which device wrote what. */
	deviceLabel?: string;
}

export interface PullReport {
	/** Days brought in or updated from the remote without a merge. */
	pulled: number;
	/** Days where local and remote edits had to be reconciled. */
	merged: number;
	/** Days now holding conflict markers. */
	conflicts: DayKey[];
	head: string | null;
}

export interface PushReport {
	pushed: number;
	/** Days held back because they still contain unresolved conflicts. */
	skipped: DayKey[];
	commitSha: string | null;
}

export type SyncReport = PullReport & PushReport;

export async function pull(deps: SyncDeps): Promise<PullReport> {
	const { client, repo } = deps;
	const meta = await getMeta();

	const head = await client.getRef(repo);
	// No branch yet: an empty repository. There is nothing to pull, and the
	// first push will create the ref.
	if (head === null) return { pulled: 0, merged: 0, conflicts: [], head: null };
	if (head === meta.headSha) return { pulled: 0, merged: 0, conflicts: [], head };

	const commit = await client.getCommit(repo, head);
	const tree = await client.getTree(repo, commit.treeSha, true);
	if (tree.truncated) throw new TruncatedTreeError();

	const remote = new Map<DayKey, string>();
	for (const entry of tree.entries) {
		if (entry.type !== 'blob') continue;
		const date = dayFromPath(entry.path);
		if (date) remote.set(date, entry.sha);
	}

	let pulled = 0;
	let merged = 0;
	const conflicts: DayKey[] = [];

	for (const [date, sha] of remote) {
		const local = await getDay(date);

		// We already hold this exact version. Costs nothing and skips the fetch,
		// which is what makes a routine poll cheap.
		if (local.baseBlobSha === sha) continue;

		const remoteText = decoder.decode(await client.getBlob(repo, sha));

		if (local.dirty === 0) {
			await putDay({
				...local,
				...textToDayFields(date, remoteText),
				baseText: remoteText,
				baseBlobSha: sha,
				dirty: 0,
				conflicted: 0
			});
			pulled++;
			continue;
		}

		const result = mergeDay({
			date,
			local,
			remoteText,
			localLabel: deps.deviceLabel
		});

		const next: DayRecord = {
			...local,
			body: result.body,
			tags: result.tags,
			extra: result.extra,
			baseText: remoteText,
			baseBlobSha: sha,
			conflicted: result.clean ? 0 : 1,
			updatedAt: Date.now()
		};
		// Derived, as everywhere: if the merge happened to land on exactly what
		// the remote holds, there is nothing left to push.
		next.dirty = dayToText(next) === remoteText ? 0 : 1;

		await putDay(next);
		merged++;
		if (!result.clean) conflicts.push(date);
	}

	pulled += await applyRemoteDeletions(remote);

	await setMeta({ headSha: head, headTreeSha: commit.treeSha, lastSyncAt: Date.now() });

	return { pulled, merged, conflicts, head };
}

/**
 * A day we know was on the remote and no longer is.
 *
 * A clean copy is deleted locally — the remote is the record, and the content
 * is still in git history if the deletion was a mistake. A copy with unpushed
 * edits is kept and detached from its base, so the next push restores it rather
 * than throwing away words this device has that nowhere else does.
 */
async function applyRemoteDeletions(remote: Map<DayKey, string>): Promise<number> {
	let deleted = 0;

	for (const day of await listAllDays()) {
		if (day.baseBlobSha === null) continue;
		if (remote.has(day.date)) continue;

		if (day.dirty === 1) {
			await putDay({ ...day, baseText: null, baseBlobSha: null, dirty: 1 });
		} else {
			await deleteDay(day.date);
			deleted++;
		}
	}

	return deleted;
}

export async function push(deps: SyncDeps): Promise<PushReport> {
	const { client, repo } = deps;

	const dirty = await listDirtyDays();
	// Pushing conflict markers into the repo would make the mess permanent and
	// visible to every other device. Hold those back; push everything else.
	const ready = dirty.filter((day) => day.conflicted === 0);
	const skipped = dirty.filter((day) => day.conflicted === 1).map((day) => day.date);

	if (ready.length === 0) return { pushed: 0, skipped, commitSha: null };

	const meta = await getMeta();
	const entries: NewTreeEntry[] = ready.map((day) => ({
		path: dayPath(day.date),
		mode: '100644',
		type: 'blob',
		content: dayToText(day)
	}));

	const treeSha = await client.createTree(repo, meta.headTreeSha, entries);
	const commitSha = await client.createCommit(
		repo,
		commitMessage(ready.map((day) => day.date)),
		treeSha,
		meta.headSha ? [meta.headSha] : []
	);

	if (meta.headSha) await client.updateRef(repo, commitSha);
	else await client.createRef(repo, commitSha);

	// Record the new merge base. The SHA is computed locally rather than
	// re-fetched: it is the same value git would produce, so a whole extra
	// round trip buys nothing.
	for (const day of ready) {
		const text = dayToText(day);
		await markSynced(day.date, text, await blobSha(text));
	}

	await setMeta({ headSha: commitSha, headTreeSha: treeSha, lastSyncAt: Date.now() });

	return { pushed: ready.length, skipped, commitSha };
}

/**
 * One round of syncing.
 *
 * Always pulls first: pushing onto a ref that has moved would be rejected
 * anyway, and merging before committing is what keeps the history linear and
 * readable. A rejection still happens if another device pushes in the gap, and
 * the answer to that is to pull and try again — never to force.
 */
export async function sync(deps: SyncDeps): Promise<SyncReport> {
	for (let attempt = 0; ; attempt++) {
		const pulled = await pull(deps);

		try {
			const pushed = await push(deps);
			return { ...pulled, ...pushed };
		} catch (error) {
			const raced = error instanceof GitHubError && error.isRefConflict;
			if (!raced || attempt >= MAX_REF_RETRIES) throw error;
			// Someone else pushed between our pull and our ref update. Go around.
		}
	}
}

export function commitMessage(dates: DayKey[]): string {
	if (dates.length === 1) return `journal: ${dates[0]}`;

	const sorted = [...dates].sort();
	const first = sorted[0];
	const last = sorted[sorted.length - 1];

	return `journal: ${sorted.length} entries (${first}..${last})`;
}

/** How long to wait after a rate-limit refusal, for the scheduler's backoff. */
export function retryDelayFor(error: unknown): number | null {
	if (!(error instanceof GitHubError)) return null;

	if (error.rateLimit.retryAfterMs !== null) return error.rateLimit.retryAfterMs;

	if (error.isRateLimited && error.rateLimit.reset !== null) {
		// `reset` is epoch seconds; a little padding avoids racing the boundary.
		const waitMs = error.rateLimit.reset * 1000 - Date.now() + 1_000;
		return waitMs > 0 ? waitMs : null;
	}

	return null;
}
