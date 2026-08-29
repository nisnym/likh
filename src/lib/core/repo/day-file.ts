/**
 * The bridge between a `DayRecord` in IndexedDB and the bytes of a day file.
 *
 * Kept in `repo/` because it is the on-disk representation, and shared by the
 * db layer and the sync engine so both agree byte-for-byte on what a day looks
 * like — if they ever disagreed, every save would look like a change.
 */

import type { DayKey } from '../date/day';
import { normalizeBody, parse, serialize } from '../markdown/frontmatter';
import type { DayRecord } from '../db/types';

/** The exact file content for a day record. */
export function dayToText(record: Pick<DayRecord, 'date' | 'body' | 'tags' | 'extra'>): string {
	return serialize({
		frontmatter: { date: record.date, tags: record.tags, extra: record.extra },
		body: record.body
	});
}

/** The fields of a day record recovered from file content. */
export function textToDayFields(
	date: DayKey,
	text: string
): Pick<DayRecord, 'body' | 'tags' | 'extra'> {
	const doc = parse(text, date);

	return {
		body: normalizeBody(doc.body),
		tags: doc.frontmatter.tags,
		extra: doc.frontmatter.extra
	};
}

/** True when the day holds nothing worth committing. */
export function isEmptyDay(record: Pick<DayRecord, 'body' | 'tags' | 'extra'>): boolean {
	return record.body.trim() === '' && record.tags.length === 0 && record.extra.length === 0;
}
