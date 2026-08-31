import { describe, expect, it } from 'vitest';
import { addDays, type DayKey } from '../date/day';
import {
	INTENSITY_STEPS,
	countWords,
	currentStreak,
	intensity,
	longestStreak,
	summarize,
	type WordCounts
} from './writing';

const TODAY = '2026-08-30';

/** A journal holding the given days, each with a plausible number of words. */
function journal(days: DayKey[], words = 100): WordCounts {
	return new Map(days.map((day) => [day, words]));
}

/** `run('2026-08-30', 3)` — that day and the two before it. */
function run(end: DayKey, length: number): DayKey[] {
	return Array.from({ length }, (_, i) => addDays(end, -i));
}

describe('countWords', () => {
	it('counts words in ordinary prose', () => {
		expect(countWords('Shipped the sync layer today.')).toBe(5);
	});

	it('is zero for nothing, and for whitespace', () => {
		expect(countWords('')).toBe(0);
		expect(countWords('  \n\n\t ')).toBe(0);
	});

	it('does not count markdown furniture as writing', () => {
		// `#`, `-` and `>` are how the text is shaped, not part of it. Counting
		// them would make a bulleted list score higher than the same sentences.
		expect(countWords('# A heading')).toBe(2);
		expect(countWords('- one\n- two')).toBe(2);
		expect(countWords('> quoted line')).toBe(2);
		expect(countWords('---')).toBe(0);
	});

	it('keeps punctuation attached to the word it belongs to', () => {
		expect(countWords("don't — really, don't")).toBe(3);
	});

	it('counts scripts other than Latin', () => {
		expect(countWords('लिख का अर्थ है लिखना')).toBe(5);
		expect(countWords('2026 was a year')).toBe(4);
	});
});

describe('currentStreak', () => {
	it('counts back from today', () => {
		const streak = currentStreak(journal(run(TODAY, 4)), TODAY);

		expect(streak.length).toBe(4);
		expect(streak.start).toBe('2026-08-27');
		expect(streak.end).toBe(TODAY);
	});

	it('survives a today that has not been written yet', () => {
		// The day is not over, so it has not been missed. A streak that collapsed
		// at midnight and came back after breakfast would be a lie both times.
		const streak = currentStreak(journal(run(addDays(TODAY, -1), 3)), TODAY);

		expect(streak.length).toBe(3);
		expect(streak.end).toBe('2026-08-29');
	});

	it('ends once yesterday goes unwritten too', () => {
		expect(currentStreak(journal(run(addDays(TODAY, -2), 5)), TODAY).length).toBe(0);
	});

	it('is zero for an empty journal', () => {
		expect(currentStreak(new Map(), TODAY)).toEqual({ length: 0, start: null, end: null });
	});

	it('stops at the gap rather than counting every written day', () => {
		const counts = journal([...run(TODAY, 2), ...run('2026-08-20', 6)]);

		expect(currentStreak(counts, TODAY).length).toBe(2);
	});

	it('counts across a month and a year boundary', () => {
		const counts = journal(run('2027-01-02', 5));

		expect(currentStreak(counts, '2027-01-02').start).toBe('2026-12-29');
	});
});

describe('longestStreak', () => {
	it('finds the longest run anywhere in the journal', () => {
		const counts = journal([...run(TODAY, 2), ...run('2026-05-10', 9), ...run('2026-02-01', 4)]);
		const streak = longestStreak(counts);

		expect(streak.length).toBe(9);
		expect(streak.start).toBe('2026-05-02');
		expect(streak.end).toBe('2026-05-10');
	});

	it('is a single day when nothing is consecutive', () => {
		expect(longestStreak(journal(['2026-01-01', '2026-03-04', '2026-07-19'])).length).toBe(1);
	});

	it('is zero for an empty journal', () => {
		expect(longestStreak(new Map())).toEqual({ length: 0, start: null, end: null });
	});

	it('keeps the earliest of two equal runs', () => {
		const counts = journal([...run('2026-03-03', 3), ...run('2026-09-09', 3)]);

		expect(longestStreak(counts).end).toBe('2026-03-03');
	});
});

describe('summarize', () => {
	it('separates this year from the whole journal', () => {
		const counts = new Map([
			['2026-08-30', 300],
			['2026-08-29', 200],
			['2025-11-04', 500]
		]);

		expect(summarize(counts, TODAY)).toMatchObject({
			days: 3,
			words: 1000,
			daysThisYear: 2,
			wordsThisYear: 500
		});
	});

	it('reports both runs', () => {
		const counts = journal([...run(TODAY, 2), ...run('2026-04-10', 7)]);
		const stats = summarize(counts, TODAY);

		expect(stats.current.length).toBe(2);
		expect(stats.longest.length).toBe(7);
	});

	it('is all zeroes for a journal nobody has written in', () => {
		expect(summarize(new Map(), TODAY)).toMatchObject({
			days: 0,
			words: 0,
			daysThisYear: 0,
			wordsThisYear: 0
		});
	});
});

describe('intensity', () => {
	it('is 0 only for a day with nothing on it', () => {
		expect(intensity(0)).toBe(0);
		expect(intensity(1)).toBe(1);
	});

	it('steps up at each threshold and stops at 4', () => {
		const [first, second, third] = INTENSITY_STEPS;

		expect(intensity(first - 1)).toBe(1);
		expect(intensity(first)).toBe(2);
		expect(intensity(second)).toBe(3);
		expect(intensity(third)).toBe(4);
		expect(intensity(third * 100)).toBe(4);
	});

	it('rises with the steps, so the scale never doubles back', () => {
		let previous = 0;
		for (let words = 0; words < 2000; words += 7) {
			const level = intensity(words);
			expect(level).toBeGreaterThanOrEqual(previous);
			previous = level;
		}
	});
});
