/**
 * The mapping between day keys and paths in the user's repo.
 *
 * This is a published contract: someone can clone their journal and rely on the
 * layout without likh. `YYYY/Month/DD.md` reads as a calendar when you browse
 * it on github.com — the year and month are already in the folders, so the file
 * only has to carry the day.
 */

import { isDayKey, MONTH_NAMES, type DayKey } from '../date/day';

export const JOURNAL_DIR = 'journal';
export const ATTACHMENTS_DIR = 'attachments';
export const CONFIG_PATH = '.likh/config.json';
export const README_PATH = 'README.md';

/** `2026-04-30` → `2026/April/30` — the segment shape both trees share. */
function calendarDir(key: DayKey): string {
	return `${key.slice(0, 4)}/${MONTH_NAMES[Number(key.slice(5, 7)) - 1]}`;
}

/** `2026-04-30` → `journal/2026/April/30.md` */
export function dayPath(key: DayKey): string {
	if (!isDayKey(key)) throw new RangeError(`Not a day key: ${key}`);

	return `${JOURNAL_DIR}/${calendarDir(key)}/${key.slice(8)}.md`;
}

/** The inverse of `dayPath`. Returns null for any path that isn't a day file. */
export function dayFromPath(path: string): DayKey | null {
	const match = new RegExp(`^${JOURNAL_DIR}/(\\d{4})/([A-Za-z]+)/(\\d{2})\\.md$`).exec(path);
	if (!match) return null;

	const [, year, month, day] = match;
	// Case-sensitive: `april/` is a different path to git, and accepting both
	// would let one day occupy two files.
	const index = (MONTH_NAMES as readonly string[]).indexOf(month);
	if (index === -1) return null;

	const key = `${year}-${String(index + 1).padStart(2, '0')}-${day}`;

	// Rejects `journal/2026/April/31.md` and `journal/2026/February/30.md`.
	return isDayKey(key) ? key : null;
}

export function isAttachmentPath(path: string): boolean {
	return path.startsWith(`${ATTACHMENTS_DIR}/`);
}

/**
 * `attachments/2026/April/<slug>-<hash>.<ext>`
 *
 * Used from M4 onward; defined here with the rest of the layout because it is
 * part of the repo format contract rather than a detail of uploading. Mirrors
 * the journal tree so an image sits beside the month that references it.
 *
 * The hash keeps two images with the same name on the same day from colliding,
 * without needing to read the directory first — which matters offline.
 */
export function attachmentPath(key: DayKey, slug: string, hash: string, ext: string): string {
	if (!isDayKey(key)) throw new RangeError(`Not a day key: ${key}`);

	const safeSlug = slugify(slug) || 'image';
	const safeExt = ext.replace(/^\.+/, '').toLowerCase();

	return `${ATTACHMENTS_DIR}/${calendarDir(key)}/${safeSlug}-${hash.slice(0, 8)}.${safeExt}`;
}

/** Relative link from a day file to an attachment, for embedding in markdown. */
export function relativeFromDay(key: DayKey, target: string): string {
	const upToRoot = '../'.repeat(dayPath(key).split('/').length - 1);

	return upToRoot + target;
}

export function slugify(input: string): string {
	return input
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 48);
}
