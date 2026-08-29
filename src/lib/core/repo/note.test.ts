import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../markdown/frontmatter';
import { appendNote, noteHeading } from './note';

describe('noteHeading', () => {
	it('dates the note in English, whatever the browser', () => {
		expect(noteHeading('2026-08-29')).toBe('**Added 29 August 2026**');
		expect(noteHeading('2026-01-05')).toBe('**Added 5 January 2026**');
	});
});

describe('appendNote', () => {
	it('adds the note under a rule, after what was already there', () => {
		expect(appendNote('Went for a walk.', 'It rained later.', '2026-08-29')).toBe(
			'Went for a walk.\n\n---\n\n**Added 29 August 2026**\n\nIt rained later.'
		);
	});

	it('leaves a blank line above the rule', () => {
		// Without it `---` is a Setext underline and the line above becomes a
		// heading, which silently restyles the entry it was meant to close.
		const body = appendNote('Went for a walk.', 'Later.', '2026-08-29');
		expect(body).toContain('walk.\n\n---');
	});

	it('skips the rule when the day was never written in', () => {
		expect(appendNote('', 'I never wrote this day up.', '2026-08-29')).toBe(
			'**Added 29 August 2026**\n\nI never wrote this day up.'
		);
	});

	it('stacks, so a day can be revisited more than once', () => {
		const once = appendNote('First.', 'Second.', '2026-08-29');
		const twice = appendNote(once, 'Third.', '2026-09-02');

		expect(twice.match(/^---$/gm)).toHaveLength(2);
		expect(twice.endsWith('**Added 2 September 2026**\n\nThird.')).toBe(true);
		expect(twice).toContain('First.');
	});

	it('refuses to dirty a day with an empty note', () => {
		expect(appendNote('Written.', '   \n\n ', '2026-08-29')).toBe('Written.');
		expect(appendNote('', '', '2026-08-29')).toBe('');
	});

	it('never touches what was already written', () => {
		const original = '# A day\n\nSome prose, with a --- inside it.\n\n> and a quote';
		expect(appendNote(original, 'A note.', '2026-08-29').startsWith(original)).toBe(true);
	});

	it('survives a round trip through the file format', () => {
		// The rule and the heading have to come back as body text, not as
		// frontmatter or a second document.
		const body = appendNote('Went for a walk.', 'It rained later.', '2026-08-29');
		const text = serialize({
			frontmatter: { date: '2025-03-14', tags: [], extra: [] },
			body
		});

		expect(parse(text, '2025-03-14').body).toBe(body);
		expect(serialize(parse(text, '2025-03-14'))).toBe(text);
	});
});
