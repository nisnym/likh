import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { applyEdit, formatEdit, type FormatAction } from './format';

/*
 * Selections are written inline so the tests read like the thing they describe:
 * `‸` is the caret, `‹…›` is a selection. The characters are chosen to be ones
 * markdown never uses, so `[link](url)` needs no escaping.
 */
const CARET = '‸';
const OPEN = '‹';
const CLOSE = '›';

function parse(marked: string): { doc: string; from: number; to: number } {
	if (marked.includes(CARET)) {
		const at = marked.indexOf(CARET);
		return { doc: marked.replace(CARET, ''), from: at, to: at };
	}

	const from = marked.indexOf(OPEN);
	const to = marked.indexOf(CLOSE) - 1;
	if (from === -1 || to < from) throw new Error(`No selection in: ${marked}`);

	return { doc: marked.replace(OPEN, '').replace(CLOSE, ''), from, to };
}

function show(doc: string, selection: { from: number; to: number }): string {
	if (selection.from === selection.to) {
		return doc.slice(0, selection.from) + CARET + doc.slice(selection.from);
	}

	return (
		doc.slice(0, selection.from) +
		OPEN +
		doc.slice(selection.from, selection.to) +
		CLOSE +
		doc.slice(selection.to)
	);
}

/** Run an action over a marked-up document and get the marked-up result. */
function run(action: FormatAction, marked: string): string {
	const { doc, from, to } = parse(marked);
	const edit = formatEdit(action, doc, from, to);

	return show(applyEdit(doc, edit), edit.selection);
}

describe('inline marks', () => {
	it('wraps a selection and leaves the markers outside it', () => {
		expect(run('bold', 'hello ‹world›')).toBe('hello **‹world›**');
		expect(run('italic', 'hello ‹world›')).toBe('hello *‹world›*');
		expect(run('code', 'run ‹pnpm test›')).toBe('run `‹pnpm test›`');
	});

	it('unwraps when the selection is already marked', () => {
		expect(run('bold', 'hello **‹world›**')).toBe('hello ‹world›');
		expect(run('bold', 'hello ‹**world**›')).toBe('hello ‹world›');
	});

	it('marks the word under the caret when nothing is selected', () => {
		expect(run('bold', 'hello wo‸rld')).toBe('hello **‹world›**');
		expect(run('italic', '‸word')).toBe('*‹word›*');
	});

	it('opens empty markers when there is no word to take', () => {
		expect(run('bold', '‸')).toBe('**‸**');
		expect(run('bold', 'a ‸ b')).toBe('a **‸** b');
	});

	it('does not mistake the inner asterisk of bold text for an italic marker', () => {
		// Stripping one `*` from each side here would silently demote the bold.
		expect(run('italic', '**‹word›**')).toBe('***‹word›***');
		expect(run('italic', '‹**word**›')).toBe('*‹**word**›*');
	});

	it('leaves the document unchanged when pressed twice', () => {
		fc.assert(
			fc.property(
				fc.stringMatching(/^[a-z .\n]{0,40}$/),
				fc.nat(60),
				fc.nat(60),
				fc.constantFrom<FormatAction>('bold', 'italic', 'code'),
				(doc, a, b, action) => {
					const from = Math.min(a, doc.length);
					const to = Math.min(Math.max(a, b), doc.length);

					const first = formatEdit(action, doc, from, to);
					const middle = applyEdit(doc, first);
					const second = formatEdit(action, middle, first.selection.from, first.selection.to);

					expect(applyEdit(middle, second)).toBe(doc);
				}
			)
		);
	});
});

describe('block markers', () => {
	it('marks every line the selection touches', () => {
		expect(run('bullet', '‹milk\neggs\nbread›')).toBe('‹- milk\n- eggs\n- bread›');
		expect(run('quote', '‹one\ntwo›')).toBe('‹> one\n> two›');
	});

	it('numbers an ordered list from one', () => {
		expect(run('ordered', '‹first\nsecond\nthird›')).toBe('‹1. first\n2. second\n3. third›');
	});

	it('removes the marker when every line already has it', () => {
		expect(run('bullet', '‹- milk\n- eggs›')).toBe('‹milk\neggs›');
		expect(run('ordered', '‹1. first\n2. second›')).toBe('‹first\nsecond›');
	});

	it('adds to the lines that are missing it rather than toggling off', () => {
		expect(run('bullet', '‹- milk\neggs›')).toBe('‹- milk\n- eggs›');
	});

	it('replaces a marker of another kind, never stacking two', () => {
		// `- > text` renders as a list containing a quote, which is not what the
		// button meant.
		expect(run('bullet', '‹> quoted›')).toBe('‹- quoted›');
		expect(run('quote', '‹- listed›')).toBe('‹> listed›');
	});

	it('steps over blank lines inside the selection', () => {
		expect(run('bullet', '‹milk\n\neggs›')).toBe('‹- milk\n\n- eggs›');
	});

	it('marks the empty line the caret is on', () => {
		expect(run('bullet', '‸')).toBe('- ‸');
	});

	it('keeps the caret where it was in the text', () => {
		expect(run('bullet', 'mi‸lk')).toBe('- mi‸lk');
		expect(run('bullet', '- mi‸lk')).toBe('mi‸lk');
		// Only the caret's own line, not the paragraph around it.
		expect(run('bullet', 'one\ntw‸o')).toBe('one\n- tw‸o');
	});

	it('does not take the next line when the selection ends at its first column', () => {
		expect(run('bullet', '‹milk\n›eggs')).toBe('‹- milk›\neggs');
	});

	it('preserves indentation', () => {
		expect(run('bullet', '‹  nested›')).toBe('‹  - nested›');
	});
});

describe('headings', () => {
	it('cycles none, H1, H2, H3, none', () => {
		expect(run('heading', 'Ti‸tle')).toBe('# Ti‸tle');
		expect(run('heading', '# Ti‸tle')).toBe('## Ti‸tle');
		expect(run('heading', '## Ti‸tle')).toBe('### Ti‸tle');
		expect(run('heading', '### Ti‸tle')).toBe('Ti‸tle');
	});

	it('reads the level from the first written line of the selection', () => {
		expect(run('heading', '‹# one\ntwo›')).toBe('‹## one\n## two›');
	});
});

describe('links', () => {
	it('wraps a selection and offers the destination for typing', () => {
		expect(run('link', 'see ‹the notes›')).toBe('see [the notes](‹url›)');
	});

	it('offers the text when nothing is selected', () => {
		expect(run('link', 'see ‸')).toBe('see [‹text›](url)');
	});

	it('takes a selected URL as the destination and waits for the words', () => {
		expect(run('link', '‹https://likh.dev›')).toBe('[‸](https://likh.dev)');
	});
});

describe('backwards selections', () => {
	it('are read the same as forwards ones', () => {
		const doc = 'hello world';
		const forwards = formatEdit('bold', doc, 6, 11);
		const backwards = formatEdit('bold', doc, 11, 6);

		expect(applyEdit(doc, backwards)).toBe(applyEdit(doc, forwards));
	});
});
