/**
 * Day keys.
 *
 * A journal day is a *civil* date — the day you experienced. Two rules keep
 * that unambiguous everywhere in the world:
 *
 *  1. Deciding *which* day "now" is uses **local** components. Using
 *     `toISOString()` would file an entry written at 11pm in Delhi under
 *     tomorrow's date.
 *  2. All arithmetic on a key that already exists uses **UTC** components. A
 *     civil date has no timezone, and doing the maths in local time breaks in
 *     zones that skip a calendar day — Kiritimati has no 31 December 1994, so
 *     elapsed-milliseconds arithmetic there is off by one across that boundary.
 *
 * `fromDayKey` therefore returns a UTC-midnight instant standing for the civil
 * date, and every formatter passes `timeZone: 'UTC'` to read it back unshifted.
 */

/** `YYYY-MM-DD` in the writer's local calendar. */
export type DayKey = string;

const DAY_MS = 86_400_000;

/**
 * Month names, in English, always.
 *
 * A fixed table rather than `Intl`, because these reach the repository: they
 * name the folder a day is filed in, and they date the notes added to a day
 * after the fact. A French browser writing `Avril/` beside a Chrome `April/`
 * would file the same month under two paths; a note headed "29 août 2026" next
 * to one headed "29 August 2026" makes one journal read like two. Anything
 * shown on screen is localised (`formatLong` and friends); anything committed
 * is not.
 */
export const MONTH_NAMES = [
	'January',
	'February',
	'March',
	'April',
	'May',
	'June',
	'July',
	'August',
	'September',
	'October',
	'November',
	'December'
] as const;
/** Weekday names, in English, always — for the same reason as `MONTH_NAMES`. */
export const DAY_NAMES = [
	'Sunday',
	'Monday',
	'Tuesday',
	'Wednesday',
	'Thursday',
	'Friday',
	'Saturday'
] as const;

const KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parts(key: DayKey): [number, number, number] {
	const match = KEY_PATTERN.exec(key);
	if (!match) throw new RangeError(`Not a day key: ${key}`);

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isDayKey(value: string): value is DayKey {
	const match = KEY_PATTERN.exec(value);
	if (!match) return false;

	const [, year, month, day] = match;
	const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

	// Rejects 2026-02-30 and friends, which the pattern alone would accept.
	return (
		date.getUTCFullYear() === Number(year) &&
		date.getUTCMonth() === Number(month) - 1 &&
		date.getUTCDate() === Number(day)
	);
}

/** Read the civil date an instant falls on, in the writer's local zone. */
export function toDayKey(date: Date): DayKey {
	const year = String(date.getFullYear()).padStart(4, '0');
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');

	return `${year}-${month}-${day}`;
}

function fromUtc(date: Date): DayKey {
	const year = String(date.getUTCFullYear()).padStart(4, '0');
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	const day = String(date.getUTCDate()).padStart(2, '0');

	return `${year}-${month}-${day}`;
}

/** UTC midnight standing for this civil date. Format it with `timeZone: 'UTC'`. */
export function fromDayKey(key: DayKey): Date {
	const [year, month, day] = parts(key);

	return new Date(Date.UTC(year, month - 1, day));
}

export function todayKey(now: Date = new Date()): DayKey {
	return toDayKey(now);
}

/** `2026-08-29` → `29 August 2026`. Locale-independent, for text we commit. */
export function formatFixed(key: DayKey): string {
	const [year, month, day] = parts(key);

	return `${day} ${MONTH_NAMES[month - 1]} ${year}`;
}

/** `2026-08-29` → `Saturday`. Locale-independent, for text we commit. */
export function weekdayFixed(key: DayKey): string {
	return DAY_NAMES[dayOfWeek(key)];
}

export function addDays(key: DayKey, days: number): DayKey {
	return fromUtc(new Date(fromDayKey(key).getTime() + days * DAY_MS));
}

/** Whole calendar days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: DayKey, to: DayKey): number {
	return Math.round((fromDayKey(to).getTime() - fromDayKey(from).getTime()) / DAY_MS);
}

export function startOfMonth(key: DayKey): DayKey {
	return `${key.slice(0, 7)}-01`;
}

export function endOfMonth(key: DayKey): DayKey {
	const [year, month] = parts(key);

	// Day 0 of the next month is the last day of this one.
	return fromUtc(new Date(Date.UTC(year, month, 0)));
}

/** Number of days in the key's month. */
export function daysInMonth(key: DayKey): number {
	return Number(endOfMonth(key).slice(8));
}

/**
 * True once the day is over.
 *
 * What makes an entry read-only: a past day is a record of what you thought at
 * the time, and rewriting it later quietly destroys the only thing a journal is
 * for. Today and any day still ahead stay open.
 */
export function isPast(key: DayKey, today: DayKey = todayKey()): boolean {
	return daysBetween(today, key) < 0;
}

/** 0 = Sunday, matching `Date.prototype.getDay`. */
export function dayOfWeek(key: DayKey): number {
	return fromDayKey(key).getUTCDay();
}

const UTC = { timeZone: 'UTC' } as const;

export function formatLong(key: DayKey, locale?: string): string {
	return fromDayKey(key).toLocaleDateString(locale, {
		...UTC,
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		year: 'numeric'
	});
}

export function formatMonth(key: DayKey, locale?: string): string {
	return fromDayKey(key).toLocaleDateString(locale, { ...UTC, month: 'long', year: 'numeric' });
}

/** "Today" / "Yesterday" / a formatted date — for headers and lists. */
export function formatRelative(key: DayKey, today: DayKey = todayKey(), locale?: string): string {
	const delta = daysBetween(today, key);

	if (delta === 0) return 'Today';
	if (delta === -1) return 'Yesterday';
	if (delta === 1) return 'Tomorrow';

	const sameYear = key.slice(0, 4) === today.slice(0, 4);
	return fromDayKey(key).toLocaleDateString(locale, {
		...UTC,
		weekday: 'long',
		day: 'numeric',
		month: 'long',
		...(sameYear ? {} : { year: 'numeric' })
	});
}
