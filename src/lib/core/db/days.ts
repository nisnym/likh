import type { DayKey } from '../date/day';
import { hasConflictMarkers } from '../markdown/conflict';
import { normalizeBody } from '../markdown/frontmatter';
import { dayToText, isEmptyDay } from '../repo/day-file';
import { db } from './schema';
import type { DayRecord } from './types';

export function emptyDay(date: DayKey): DayRecord {
	return {
		date,
		body: '',
		tags: [],
		extra: [],
		baseText: null,
		baseBlobSha: null,
		dirty: 0,
		conflicted: 0,
		updatedAt: 0
	};
}

/**
 * Always resolves to a record. A day the user has never opened is
 * indistinguishable from an empty one, and returning `undefined` would push
 * that distinction into every caller for no benefit.
 */
export async function getDay(date: DayKey): Promise<DayRecord> {
	return (await (await db()).get('days', date)) ?? emptyDay(date);
}

export interface DayEdit {
	body?: string;
	tags?: string[];
}

/**
 * Write an edit and recompute sync state from it.
 *
 * `dirty` is *derived* — the serialized day is compared against `baseText` —
 * rather than simply set. That means undoing an edit back to the synced text
 * clears the flag, and likh never pushes a commit whose tree is unchanged.
 */
export async function saveDay(date: DayKey, edit: DayEdit): Promise<DayRecord> {
	const database = await db();
	const transaction = database.transaction('days', 'readwrite');
	const store = transaction.objectStore('days');

	const current = (await store.get(date)) ?? emptyDay(date);
	const next: DayRecord = {
		...current,
		body: edit.body === undefined ? current.body : normalizeBody(edit.body),
		tags: edit.tags ?? current.tags
	};

	const unchanged = next.body === current.body && sameTags(next.tags, current.tags);
	if (unchanged && current.updatedAt !== 0) {
		await transaction.done;
		return current;
	}

	next.dirty = dayToText(next) === next.baseText ? 0 : 1;
	next.conflicted = hasConflictMarkers(next.body) ? 1 : 0;
	next.updatedAt = Date.now();

	// Don't persist a day that was never written in and holds nothing — opening
	// the calendar would otherwise litter the store with blank records.
	if (isEmptyDay(next) && next.baseText === null) {
		await store.delete(date);
		await transaction.done;
		return { ...next, updatedAt: 0 };
	}

	await store.put(next);
	await transaction.done;

	return next;
}

/**
 * Record that a day now matches the remote. Called only after a successful push
 * or pull — this is what establishes the merge base for the next three-way merge.
 */
export async function markSynced(
	date: DayKey,
	remoteText: string,
	blobSha: string | null
): Promise<void> {
	const database = await db();
	const transaction = database.transaction('days', 'readwrite');
	const store = transaction.objectStore('days');

	const current = await store.get(date);
	if (!current) {
		await transaction.done;
		return;
	}

	const next: DayRecord = { ...current, baseText: remoteText, baseBlobSha: blobSha };
	next.dirty = dayToText(next) === remoteText ? 0 : 1;

	await store.put(next);
	await transaction.done;
}

export async function putDay(record: DayRecord): Promise<void> {
	await (await db()).put('days', record);
}

export async function deleteDay(date: DayKey): Promise<void> {
	await (await db()).delete('days', date);
}

export async function listDirtyDays(): Promise<DayRecord[]> {
	return (await db()).getAllFromIndex('days', 'by-dirty', 1);
}

export async function countDirtyDays(): Promise<number> {
	return (await db()).countFromIndex('days', 'by-dirty', 1);
}

export async function listConflictedDays(): Promise<DayRecord[]> {
	const all = await (await db()).getAll('days');

	return all.filter((day) => day.conflicted === 1);
}

export async function listAllDays(): Promise<DayRecord[]> {
	return (await db()).getAll('days');
}

/** Every day key that has content, ascending — the calendar's heatmap source. */
export async function listWrittenKeys(): Promise<DayKey[]> {
	const all = await (await db()).getAll('days');

	return all.filter((day) => !isEmptyDay(day)).map((day) => day.date);
}

function sameTags(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((tag, i) => tag === b[i]);
}
