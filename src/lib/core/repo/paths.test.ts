import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { addDays, toDayKey } from '../date/day';
import {
	attachmentPath,
	isAttachmentPath,
	dayFromPath,
	dayPath,
	relativeFromDay,
	slugify
} from './paths';

describe('dayPath', () => {
	it('nests by year and named month', () => {
		expect(dayPath('2026-08-28')).toBe('journal/2026/August/28.md');
		expect(dayPath('2026-04-30')).toBe('journal/2026/April/30.md');
	});

	it('pads the day so a month sorts chronologically', () => {
		expect(dayPath('2026-01-05')).toBe('journal/2026/January/05.md');
	});

	it('refuses a key that is not a real date', () => {
		expect(() => dayPath('2026-02-30')).toThrow(RangeError);
	});
});

describe('dayFromPath', () => {
	it('inverts dayPath', () => {
		expect(dayFromPath('journal/2026/August/28.md')).toBe('2026-08-28');
	});

	it('ignores paths that are not day files', () => {
		expect(dayFromPath('README.md')).toBeNull();
		expect(dayFromPath('.likh/config.json')).toBeNull();
		expect(dayFromPath('journal/2026/August/notes.md')).toBeNull();
		expect(dayFromPath('journal/2026/28.md')).toBeNull();
		expect(dayFromPath('attachments/2026/August/x.webp')).toBeNull();
	});

	it('rejects a month name it did not write', () => {
		// Case and spelling are the whole key here: `august/` is a different
		// path to git, so accepting it would let one day occupy two files.
		expect(dayFromPath('journal/2026/august/28.md')).toBeNull();
		expect(dayFromPath('journal/2026/Aug/28.md')).toBeNull();
		expect(dayFromPath('journal/2026/Avril/28.md')).toBeNull();
	});

	it('rejects an unpadded day', () => {
		expect(dayFromPath('journal/2026/August/8.md')).toBeNull();
	});

	it('rejects a day the month does not have', () => {
		expect(dayFromPath('journal/2026/February/30.md')).toBeNull();
		expect(dayFromPath('journal/2026/April/31.md')).toBeNull();
	});
});

describe('isAttachmentPath', () => {
	it('recognises attachments and nothing else', () => {
		expect(isAttachmentPath('attachments/2026/August/x.webp')).toBe(true);
		expect(isAttachmentPath('journal/2026/August/28.md')).toBe(false);
		expect(isAttachmentPath('README.md')).toBe(false);
	});
});

describe('attachmentPath', () => {
	it('mirrors the journal layout and truncates the hash', () => {
		expect(attachmentPath('2026-08-28', 'Sunset over the bay', 'a1b2c3d4e5f6', 'webp')).toBe(
			'attachments/2026/August/sunset-over-the-bay-a1b2c3d4.webp'
		);
	});

	it('copes with a name that slugifies to nothing', () => {
		expect(attachmentPath('2026-08-28', '???', 'abcdef12', '.PNG')).toBe(
			'attachments/2026/August/image-abcdef12.png'
		);
	});
});

describe('relativeFromDay', () => {
	it('walks back up to the repo root', () => {
		expect(relativeFromDay('2026-08-28', 'attachments/2026/August/x.webp')).toBe(
			'../../../attachments/2026/August/x.webp'
		);
	});
});

describe('slugify', () => {
	it('folds accents and collapses punctuation', () => {
		expect(slugify('Café — Notes!')).toBe('cafe-notes');
		expect(slugify('  hello   world  ')).toBe('hello-world');
		expect(slugify('')).toBe('');
	});

	it('caps length so paths stay manageable', () => {
		expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48);
	});
});

describe('properties', () => {
	const arbKey = fc
		.date({ min: new Date(1970, 0, 2), max: new Date(2100, 0, 1), noInvalidDate: true })
		.map(toDayKey);

	it('dayPath and dayFromPath are inverses', () => {
		fc.assert(
			fc.property(arbKey, (key) => {
				expect(dayFromPath(dayPath(key))).toBe(key);
			})
		);
	});
});
