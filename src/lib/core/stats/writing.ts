/**
 * What the journal knows about itself.
 *
 * Counting lives here, framework-free, over a map of day key to word count, so
 * the status bar, the calendar's shading and the sidebar all agree on what a
 * word is and where a run of days breaks.
 *
 * The tone matters as much as the arithmetic. These numbers are here so a
 * writer can see their own year, not to press them into writing one: nothing
 * below computes a target, a share of one, or anything that can be failed.
 */

import { addDays, daysBetween, todayKey, type DayKey } from '../date/day';

/** Day key to words written on it. A day holding nothing is absent, not zero. */
export type WordCounts = ReadonlyMap<DayKey, number>;

/** A run of non-space characters counts as a word only if it contains one of these. */
const WORDLIKE = /[\p{L}\p{N}]/u;

/**
 * Words in a piece of writing.
 *
 * A run of non-space characters counts only when it holds a letter or a digit,
 * which drops markdown's furniture — `#`, `-`, `>`, `---`, `|` — without
 * parsing anything, and leaves `don't` and `2026` alone. Unicode-aware,
 * because the app is called लिख.
 */
export function countWords(text: string): number {
	const runs = text.match(/\S+/gu);
	if (!runs) return 0;

	let words = 0;
	for (const run of runs) if (WORDLIKE.test(run)) words++;

	return words;
}

export interface Streak {
	/** Consecutive days written. Zero when there is no run to speak of. */
	length: number;
	/** The ends of the run, inclusive; null only when `length` is 0. */
	start: DayKey | null;
	end: DayKey | null;
}

const NO_STREAK: Streak = { length: 0, start: null, end: null };

/**
 * The run of days ending now.
 *
 * A day still in progress has not been missed, so when today is unwritten the
 * run is counted through yesterday instead. Opening the app in the morning
 * should not show a streak that collapsed overnight for the sole reason that
 * the day is young; it ends for real once yesterday goes unwritten too.
 */
export function currentStreak(counts: WordCounts, today: DayKey = todayKey()): Streak {
	const yesterday = addDays(today, -1);
	const end = counts.has(today) ? today : counts.has(yesterday) ? yesterday : null;
	if (end === null) return NO_STREAK;

	let start = end;
	while (counts.has(addDays(start, -1))) start = addDays(start, -1);

	return { length: daysBetween(start, end) + 1, start, end };
}

/** The longest run anywhere in the journal. A tie keeps the earliest. */
export function longestStreak(counts: WordCounts): Streak {
	const days = [...counts.keys()].sort();
	if (days.length === 0) return NO_STREAK;

	let best: Streak = { length: 1, start: days[0], end: days[0] };
	let start = days[0];

	for (let i = 1; i < days.length; i++) {
		if (daysBetween(days[i - 1], days[i]) !== 1) start = days[i];

		const length = daysBetween(start, days[i]) + 1;
		if (length > best.length) best = { length, start, end: days[i] };
	}

	return best;
}

export interface WritingStats {
	/** Days holding writing, and words in them, across the whole journal. */
	days: number;
	words: number;
	/** The same two, over the calendar year `today` falls in. */
	daysThisYear: number;
	wordsThisYear: number;
	current: Streak;
	longest: Streak;
}

export function summarize(counts: WordCounts, today: DayKey = todayKey()): WritingStats {
	const year = today.slice(0, 4);

	let words = 0;
	let daysThisYear = 0;
	let wordsThisYear = 0;

	for (const [day, count] of counts) {
		words += count;

		if (day.slice(0, 4) === year) {
			daysThisYear++;
			wordsThisYear += count;
		}
	}

	return {
		days: counts.size,
		words,
		daysThisYear,
		wordsThisYear,
		current: currentStreak(counts, today),
		longest: longestStreak(counts)
	};
}

/**
 * Word counts at which the calendar's mark steps up.
 *
 * Absolute on purpose, rather than relative to the writer's own average. A
 * scale that moved would re-shade years of finished days every time a long
 * entry was written, so the same Tuesday would look different depending on
 * what happened after it. Fixed steps mean the past stops changing.
 */
export const INTENSITY_STEPS = [120, 350, 800] as const;

/** 0 for a day with nothing on it, then 1 to 4 as the entry gets longer. */
export function intensity(words: number): 0 | 1 | 2 | 3 | 4 {
	if (words <= 0) return 0;

	let level = 1;
	for (const step of INTENSITY_STEPS) if (words >= step) level++;

	return level as 1 | 2 | 3 | 4;
}
