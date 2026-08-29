import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normalizeBody, parse, serialize, type DayDocument } from './frontmatter';

const DATE = '2026-08-28';

describe('parse', () => {
	it('reads date, tags and body', () => {
		const doc = parse(
			[
				'---',
				'date: 2026-08-28',
				'tags: [work, ideas]',
				'---',
				'',
				'Shipped the sync layer.',
				''
			].join('\n'),
			DATE
		);

		expect(doc.frontmatter.date).toBe('2026-08-28');
		expect(doc.frontmatter.tags).toEqual(['work', 'ideas']);
		expect(doc.body).toBe('Shipped the sync layer.');
	});

	it('treats a file with no frontmatter as all body', () => {
		const doc = parse('Just some prose.\n', DATE);

		expect(doc.frontmatter).toEqual({ date: DATE, tags: [], extra: [] });
		expect(doc.body).toBe('Just some prose.');
	});

	it('treats an unterminated fence as body, not frontmatter', () => {
		const doc = parse('---\ndate: 2026-01-01\nstill going', DATE);

		expect(doc.frontmatter.date).toBe(DATE);
		expect(doc.body).toBe('---\ndate: 2026-01-01\nstill going');
	});

	it('preserves frontmatter fields it does not recognise', () => {
		const doc = parse('---\ndate: 2026-08-28\nmood: 7\nweather: rain\n---\n\nHello\n', DATE);

		expect(doc.frontmatter.extra).toEqual(['mood: 7', 'weather: rain']);
		expect(serialize(doc)).toContain('mood: 7');
	});

	it('reads block-style tag lists', () => {
		const doc = parse('---\ndate: 2026-08-28\ntags:\n  - work\n  - ideas\n---\n\nHi\n', DATE);

		expect(doc.frontmatter.tags).toEqual(['work', 'ideas']);
	});

	it('reads a bare scalar tag', () => {
		expect(parse('---\ndate: 2026-08-28\ntags: work\n---\n', DATE).frontmatter.tags).toEqual([
			'work'
		]);
	});

	it('keeps commas inside quoted tags', () => {
		const doc = parse('---\ndate: 2026-08-28\ntags: ["reading, fiction", work]\n---\n', DATE);

		expect(doc.frontmatter.tags).toEqual(['reading, fiction', 'work']);
	});

	it('normalises CRLF', () => {
		const doc = parse('---\r\ndate: 2026-08-28\r\n---\r\n\r\nline one\r\nline two\r\n', DATE);

		expect(doc.body).toBe('line one\nline two');
	});

	it('falls back to the given date when the file has none', () => {
		expect(parse('---\nmood: 7\n---\n\nHi\n', DATE).frontmatter.date).toBe(DATE);
	});

	it('keeps a body that is only a horizontal rule', () => {
		expect(parse('---\ndate: 2026-08-28\n---\n\n---\n', DATE).body).toBe('---');
	});
});

describe('serialize', () => {
	const base = (over: Partial<DayDocument> = {}): DayDocument => ({
		frontmatter: { date: DATE, tags: [], extra: [] },
		body: 'Hello',
		...over
	});

	it('omits tags entirely when there are none', () => {
		expect(serialize(base())).toBe('---\ndate: 2026-08-28\n---\n\nHello\n');
	});

	it('ends with exactly one newline', () => {
		const text = serialize(base({ body: 'Hello\n\n\n\n' }));

		expect(text.endsWith('Hello\n')).toBe(true);
		expect(text.endsWith('Hello\n\n')).toBe(false);
	});

	it('writes no body section for an empty day', () => {
		expect(serialize(base({ body: '' }))).toBe('---\ndate: 2026-08-28\n---\n');
	});

	it('never writes an updated timestamp', () => {
		// A per-save timestamp would make every commit from every device conflict.
		expect(serialize(base())).not.toMatch(/updated/);
	});

	it('quotes only tags that need it', () => {
		const text = serialize(
			base({ frontmatter: { date: DATE, tags: ['work', 'a, b'], extra: [] } })
		);

		expect(text).toContain('tags: [work, "a, b"]');
	});
});

describe('normalizeBody', () => {
	it('strips trailing blank lines but leaves interior ones', () => {
		expect(normalizeBody('a\n\nb\n \n\n')).toBe('a\n\nb');
	});

	it('leaves leading whitespace alone', () => {
		expect(normalizeBody('\n\n  indented')).toBe('\n\n  indented');
	});
});

// Generators mirror what the app and a hand-editing human can actually produce.
const arbDate = fc
	.date({ min: new Date('2000-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
	.map((d) => d.toISOString().slice(0, 10));

const arbTag = fc
	.string({ minLength: 1, maxLength: 20 })
	.map((s) => s.replace(/[\r\n]/g, ' ').trim())
	.filter((s) => s.length > 0);

const arbExtra = fc
	.tuple(
		fc.stringMatching(/^[A-Za-z][A-Za-z0-9_-]{0,12}$/).filter((k) => k !== 'date' && k !== 'tags'),
		fc.string({ maxLength: 20 }).map((v) => v.replace(/[\r\n]/g, ' ').trimEnd())
	)
	.map(([key, value]) => `${key}: ${value}`.trimEnd());

const arbDoc: fc.Arbitrary<DayDocument> = fc.record({
	frontmatter: fc.record({
		date: arbDate,
		tags: fc.uniqueArray(arbTag, { maxLength: 6 }),
		extra: fc.array(arbExtra, { maxLength: 4 })
	}),
	body: fc.string({ maxLength: 400 }).map((s) => normalizeBody(s.replace(/\r/g, '')))
});

describe('round-trip properties', () => {
	it('is idempotent: re-serializing an unchanged day is byte-identical', () => {
		// This is the property the sync engine depends on. If it fails, saving a
		// day nobody edited would still produce a diff, and likh would commit
		// noise forever.
		fc.assert(
			fc.property(arbDoc, (doc) => {
				const once = serialize(doc);
				const twice = serialize(parse(once, doc.frontmatter.date));

				expect(twice).toBe(once);
			}),
			{ numRuns: 500 }
		);
	});

	it('is lossless: nothing in a document survives a round-trip changed', () => {
		fc.assert(
			fc.property(arbDoc, (doc) => {
				expect(parse(serialize(doc), doc.frontmatter.date)).toEqual(doc);
			}),
			{ numRuns: 500 }
		);
	});

	it('is idempotent for arbitrary text a human might have written', () => {
		fc.assert(
			fc.property(fc.string({ maxLength: 300 }), (text) => {
				const once = serialize(parse(text, DATE));
				const twice = serialize(parse(once, DATE));

				expect(twice).toBe(once);
			}),
			{ numRuns: 500 }
		);
	});
});
