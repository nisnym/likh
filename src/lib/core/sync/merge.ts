import { merge as diff3 } from 'node-diff3';
import type { DayKey } from '../date/day';
import type { DayRecord } from '../db/types';
import { normalizeBody } from '../markdown/frontmatter';
import { textToDayFields } from '../repo/day-file';

/**
 * Three-way merge for a day.
 *
 * The merge base is `DayRecord.baseText` — the exact bytes we last knew were on
 * the remote. Without it there is no way to tell "you edited this" from "they
 * edited this", and the only safe answer would be to keep both copies every
 * time. With it, two devices editing different paragraphs of the same day
 * resolve silently, which is the common case and the one worth getting right.
 *
 * When the two sides genuinely overlap, both texts are kept behind conflict
 * markers. Nothing is ever discarded to make a merge succeed.
 */

export const LOCAL_LABEL = 'this device';
export const REMOTE_LABEL = 'remote';

export interface DayMerge {
	body: string;
	tags: string[];
	extra: string[];
	/** False when the result contains conflict markers. */
	clean: boolean;
}

export interface MergeInput {
	date: DayKey;
	local: Pick<DayRecord, 'body' | 'tags' | 'extra' | 'baseText'>;
	remoteText: string;
	localLabel?: string;
	remoteLabel?: string;
}

export function mergeDay(input: MergeInput): DayMerge {
	const { date, local, remoteText } = input;

	// A null base means this day exists on both sides without either having seen
	// the other — someone wrote it on two devices while offline. An empty base
	// is the honest description of that: neither side's text is a modification
	// of the other's, so overlapping content conflicts, as it should.
	const base = local.baseText === null ? blank() : textToDayFields(date, local.baseText);
	const remote = textToDayFields(date, remoteText);

	const body = mergeBody(local.body, base.body, remote.body, input);

	return {
		body: body.text,
		tags: mergeTags(local.tags, base.tags, remote.tags),
		extra: sameStrings(local.extra, base.extra) ? remote.extra : local.extra,
		clean: !body.conflict
	};
}

function mergeBody(
	local: string,
	base: string,
	remote: string,
	input: MergeInput
): { text: string; conflict: boolean } {
	// Shortcuts, in order of how often they hit. Each avoids running diff3 on a
	// case where the answer is already known, which keeps merges predictable and
	// stops the algorithm inventing differences in whitespace-only edits.
	if (local === remote) return { text: local, conflict: false };
	if (local === base) return { text: remote, conflict: false };
	if (remote === base) return { text: local, conflict: false };

	const result = diff3(local, base, remote, {
		stringSeparator: '\n',
		label: { a: input.localLabel ?? LOCAL_LABEL, b: input.remoteLabel ?? REMOTE_LABEL }
	});

	return { text: normalizeBody(result.result.join('\n')), conflict: result.conflict };
}

/**
 * Tags are a set, so the union is the merge: it cannot conflict, and it cannot
 * lose a tag someone added on the other device. A tag removed on one side and
 * kept on the other survives — which is the safe direction for a label.
 */
function mergeTags(local: string[], base: string[], remote: string[]): string[] {
	if (sameStrings(local, base)) return remote;
	if (sameStrings(remote, base)) return local;

	const merged = [...local];
	for (const tag of remote) {
		if (!merged.includes(tag)) merged.push(tag);
	}

	return merged;
}

function blank() {
	return { body: '', tags: [] as string[], extra: [] as string[] };
}

function sameStrings(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((value, i) => value === b[i]);
}
