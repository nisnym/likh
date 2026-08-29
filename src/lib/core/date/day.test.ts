import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
	addDays,
	dayOfWeek,
	daysBetween,
	endOfMonth,
	formatFixed,
	formatRelative,
	isPast,
	isDayKey,
	startOfMonth,
	toDayKey,
	todayKey
} from './day';

describe('isDayKey', () => {
	it('accepts real dates', () => {
		expect(isDayKey('2026-08-28')).toBe(true);
		expect(isDayKey('2024-02-29')).toBe(true); // leap year
	});

	it('rejects malformed and impossible dates', () => {
		expect(isDayKey('2026-8-28')).toBe(false);
		expect(isDayKey('2026-02-30')).toBe(false);
		expect(isDayKey('2023-02-29')).toBe(false); // not a leap year
		expect(isDayKey('2026-13-01')).toBe(false);
		expect(isDayKey('')).toBe(false);
		expect(isDayKey('today')).toBe(false);
	});
});

describe('toDayKey', () => {
	it('files a late-evening entry under the local day', () => {
		// The trap: `new Date(2026, 7, 28, 23, 30).toISOString().slice(0, 10)` is
		// '2026-08-29' anywhere east of UTC, which would file tonight's writing
		// under tomorrow. Day keys must come from local components only.
		expect(toDayKey(new Date(2026, 7, 28, 23, 30))).toBe('2026-08-28');
		expect(toDayKey(new Date(2026, 7, 28, 0, 1))).toBe('2026-08-28');
	});

	it('pads single-digit months and days', () => {
		expect(toDayKey(new Date(2026, 0, 5))).toBe('2026-01-05');
	});
});

describe('arithmetic', () => {
	it('crosses month and year boundaries', () => {
		expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
		expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
		expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
		expect(addDays('2023-02-28', 1)).toBe('2023-03-01');
	});

	it('measures whole days in both directions', () => {
		expect(daysBetween('2026-08-28', '2026-08-31')).toBe(3);
		expect(daysBetween('2026-08-31', '2026-08-28')).toBe(-3);
		expect(daysBetween('2026-08-28', '2026-08-28')).toBe(0);
		expect(daysBetween('2025-12-31', '2026-01-01')).toBe(1);
	});

	it('counts calendar days, not elapsed time', () => {
		// Pacific/Kiritimati has no 31 December 1994 — it jumped the date line.
		// Elapsed-millisecond arithmetic is off by one across that boundary;
		// civil-date arithmetic is not.
		expect(daysBetween('1994-12-30', '1995-01-01')).toBe(2);
		expect(addDays('1994-12-30', 2)).toBe('1995-01-01');
	});

	it('survives DST transitions', () => {
		// US spring-forward (2026-03-08) and fall-back (2026-11-01). Using local
		// noon rather than midnight is what keeps these exact.
		expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
		expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
		expect(addDays('2026-03-08', 1)).toBe('2026-03-09');
	});

	it('finds month bounds', () => {
		expect(startOfMonth('2026-08-28')).toBe('2026-08-01');
		expect(endOfMonth('2026-08-28')).toBe('2026-08-31');
		expect(endOfMonth('2026-02-10')).toBe('2026-02-28');
		expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
	});

	it('reports the weekday', () => {
		// 2026-08-28 is a Friday.
		expect(dayOfWeek('2026-08-28')).toBe(5);
		expect(dayOfWeek('2026-08-30')).toBe(0);
	});
});

describe('formatRelative', () => {
	it('names the days around today', () => {
		expect(formatRelative('2026-08-28', '2026-08-28')).toBe('Today');
		expect(formatRelative('2026-08-27', '2026-08-28')).toBe('Yesterday');
		expect(formatRelative('2026-08-29', '2026-08-28')).toBe('Tomorrow');
	});

	it('drops the year for dates in the current year and keeps it otherwise', () => {
		expect(formatRelative('2026-01-05', '2026-08-28', 'en-GB')).not.toMatch(/2026/);
		expect(formatRelative('2019-01-05', '2026-08-28', 'en-GB')).toMatch(/2019/);
	});
});

describe('properties', () => {
	// Keys are generated from civil-date components rather than from `Date`, so
	// the generator itself is timezone-independent.
	const arbKey = fc
		.tuple(
			fc.integer({ min: 1970, max: 2100 }),
			fc.integer({ min: 1, max: 12 }),
			fc.integer({ min: 1, max: 31 })
		)
		.map(
			([year, month, day]) =>
				`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
		)
		.filter(isDayKey);

	it('round-trips a key through its Date representation', () => {
		fc.assert(
			fc.property(arbKey, (key) => {
				expect(addDays(key, 0)).toBe(key);
			})
		);
	});

	it('always produces a valid key', () => {
		fc.assert(
			fc.property(arbKey, fc.integer({ min: -4000, max: 4000 }), (key, days) => {
				expect(isDayKey(addDays(key, days))).toBe(true);
			})
		);
	});

	it('addDays and daysBetween are inverses', () => {
		fc.assert(
			fc.property(arbKey, fc.integer({ min: -4000, max: 4000 }), (key, days) => {
				expect(daysBetween(key, addDays(key, days))).toBe(days);
			})
		);
	});

	it('reads the local civil day for any instant', () => {
		fc.assert(
			fc.property(
				fc.date({ min: new Date(1971, 0, 1), max: new Date(2099, 0, 1), noInvalidDate: true }),
				(instant) => {
					// The key must name the day the writer was living in, whatever
					// the UTC clock said at that moment.
					const key = toDayKey(instant);

					expect(isDayKey(key)).toBe(true);
					expect(Number(key.slice(0, 4))).toBe(instant.getFullYear());
					expect(Number(key.slice(5, 7))).toBe(instant.getMonth() + 1);
					expect(Number(key.slice(8))).toBe(instant.getDate());
				}
			)
		);
	});

	it('todayKey is a valid key', () => {
		expect(isDayKey(todayKey())).toBe(true);
	});
});

describe('formatFixed', () => {
	it('reads the same on every device', () => {
		// Locale-independent on purpose: this string is committed to the repo.
		expect(formatFixed('2026-08-29')).toBe('29 August 2026');
		expect(formatFixed('2026-01-05')).toBe('5 January 2026');
		expect(formatFixed('2024-02-29')).toBe('29 February 2024');
	});
});

describe('isPast', () => {
	it('closes a day only once it is over', () => {
		expect(isPast('2026-08-28', '2026-08-29')).toBe(true);
		expect(isPast('2026-08-29', '2026-08-29')).toBe(false);
		expect(isPast('2026-08-30', '2026-08-29')).toBe(false);
	});

	it('holds across a year boundary', () => {
		expect(isPast('2025-12-31', '2026-01-01')).toBe(true);
		expect(isPast('2026-01-01', '2025-12-31')).toBe(false);
	});
});
