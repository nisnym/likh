import { describe, expect, it } from 'vitest';
import { CURSOR, fillTemplate, placeTemplate, readTemplates, starterTemplates } from './template';

const DAY = '2026-08-29'; // A Saturday.

describe('filling', () => {
	it('substitutes the date placeholders from the day being written', () => {
		const filled = fillTemplate('{{weekday}}, {{date}}', { day: DAY });

		expect(filled.text).toBe('Saturday, 29 August 2026');
	});

	it('uses fixed English names, not the browser locale', () => {
		// The filled text is committed, so it has to be byte-identical whatever
		// device it was written on — the same contract the folder names follow.
		const original = Intl.DateTimeFormat;
		try {
			// @ts-expect-error — deliberately breaking Intl to prove it is unused.
			Intl.DateTimeFormat = () => {
				throw new Error('Intl must not be involved in text we commit');
			};

			expect(fillTemplate('{{weekday}} {{date}}', { day: DAY }).text).toBe(
				'Saturday 29 August 2026'
			);
		} finally {
			Intl.DateTimeFormat = original;
		}
	});

	it('reads the clock for the time', () => {
		const now = new Date(2026, 7, 29, 9, 5);

		expect(fillTemplate('{{time}}', { day: DAY, now }).text).toBe('09:05');
	});

	it('leaves placeholders it does not know alone', () => {
		expect(fillTemplate('weight: {{weight}}', { day: DAY }).text).toBe('weight: {{weight}}');
	});

	it('reports where the caret goes and removes the marker', () => {
		const filled = fillTemplate(`## Today\n\n${CURSOR}\n\n## Tomorrow`, { day: DAY });

		expect(filled.text).toBe('## Today\n\n\n\n## Tomorrow');
		expect(filled.text.slice(0, filled.cursor)).toBe('## Today\n\n');
	});

	it('puts the caret at the end when the template does not say', () => {
		const filled = fillTemplate('## Today', { day: DAY });

		expect(filled.cursor).toBe(filled.text.length);
	});
});

describe('placing', () => {
	const filled = { text: '## Today', cursor: 8 };

	it('adds nothing to an empty day', () => {
		expect(placeTemplate('', 0, filled).insert).toBe('## Today');
	});

	it('opens a blank line after existing writing', () => {
		expect(placeTemplate('already here', 12, filled).insert).toBe('\n\n## Today');
	});

	it('does not stack blank lines that are already there', () => {
		expect(placeTemplate('already here\n\n', 14, filled).insert).toBe('## Today');
		expect(placeTemplate('already here\n', 13, filled).insert).toBe('\n## Today');
	});

	it('separates itself from what follows', () => {
		expect(placeTemplate('after this', 0, filled).insert).toBe('## Today\n\n');
	});

	it('reports the caret in the coordinates of the new document', () => {
		const placed = placeTemplate('already here', 12, filled);
		const document = 'already here' + placed.insert;

		expect(document.slice(0, placed.cursor)).toBe('already here\n\n## Today');
	});
});

describe('reading stored templates', () => {
	it('tells "never set" apart from "deleted them all"', () => {
		expect(readTemplates(undefined)).toBeNull();
		expect(readTemplates([])).toEqual([]);
	});

	it('drops entries with no id and repairs the rest', () => {
		expect(
			readTemplates([{ name: 'no id' }, { id: 'a' }, { id: 'b', name: '  ', body: 5 }])
		).toEqual([
			{ id: 'a', name: 'Untitled', body: '' },
			{ id: 'b', name: 'Untitled', body: '' }
		]);
	});
});

describe('the starters', () => {
	it('each get their own id', () => {
		const ids = starterTemplates().map((template) => template.id);

		expect(new Set(ids).size).toBe(ids.length);
	});

	it('fill without leaving a placeholder behind', () => {
		for (const template of starterTemplates()) {
			expect(fillTemplate(template.body, { day: DAY }).text).not.toContain('{{');
		}
	});
});
