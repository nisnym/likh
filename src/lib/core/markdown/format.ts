/**
 * Markdown formatting, as text edits.
 *
 * Deliberately framework-free and expressed over a plain string plus a
 * selection, rather than over a CodeMirror state. That keeps every rule here
 * unit-testable in node — the fiddly parts are all about *where the selection
 * ends up*, which is exactly what breaks silently when it is only tested by
 * clicking around — and leaves the editor layer with nothing to do but dispatch
 * the result.
 *
 * The markers are chosen to match what the live-preview plugin and the
 * frontmatter serializer already understand, so anything a button writes is
 * text the writer could have typed, and reads correctly on github.com.
 */

export type FormatAction =
	'bold' | 'italic' | 'code' | 'heading' | 'quote' | 'bullet' | 'ordered' | 'link';

/** One replacement, plus where the selection lands in the resulting document. */
export interface FormatEdit {
	from: number;
	to: number;
	insert: string;
	selection: { from: number; to: number };
}

const MARKS = { bold: '**', italic: '*', code: '`' } as const;

/** Letters, digits and the punctuation that lives inside a word. */
const WORD = /[\p{L}\p{N}_'’-]/u;

/** `indent`, an optional block marker, then the rest of the line. */
const LINE = /^([ \t]*)(#{1,6} +|> ?|[-*+] +|\d+\. +)?(.*)$/;

const URL_LIKE = /^(?:https?:\/\/|mailto:|www\.)\S*$/;

type BlockKind = 'heading' | 'quote' | 'bullet' | 'ordered';

interface SplitLine {
	indent: string;
	kind: BlockKind | null;
	/** Heading level, when `kind` is `heading`. */
	level: number;
	text: string;
}

function splitLine(line: string): SplitLine {
	const [, indent = '', marker, text = ''] = LINE.exec(line) ?? [];

	if (!marker) return { indent, kind: null, level: 0, text };
	if (marker.startsWith('#')) {
		return { indent, kind: 'heading', level: marker.trimEnd().length, text };
	}
	if (marker.startsWith('>')) return { indent, kind: 'quote', level: 0, text };
	if (/^\d/.test(marker)) return { indent, kind: 'ordered', level: 0, text };

	return { indent, kind: 'bullet', level: 0, text };
}

/** The whole lines touched by a selection. */
function lineBlock(doc: string, from: number, to: number): { start: number; end: number } {
	const start = from === 0 ? 0 : doc.lastIndexOf('\n', from - 1) + 1;

	// A selection that ends exactly at the start of a line does not include it —
	// dragging down to the next line's first column is not a request to format it.
	const searchFrom = to > from && doc[to - 1] === '\n' ? to - 1 : to;
	const newline = doc.indexOf('\n', searchFrom);

	return { start, end: newline === -1 ? doc.length : newline };
}

/** The word the caret sits in or against, for a mark applied without a selection. */
function wordAt(doc: string, pos: number): { from: number; to: number } {
	let from = pos;
	let to = pos;

	while (from > 0 && WORD.test(doc[from - 1])) from--;
	while (to < doc.length && WORD.test(doc[to])) to++;

	return { from, to };
}

function toggleMark(doc: string, from: number, to: number, mark: string): FormatEdit {
	if (from === to) {
		const word = wordAt(doc, from);
		if (word.from !== word.to) ({ from, to } = word);
	}

	const selected = doc.slice(from, to);
	const width = mark.length;

	// `*` needs care: the `*` either side of an italic run is also the inner `*`
	// of a bold one, and stripping it would quietly turn **bold** into *italic*.
	const single = mark === '*';

	const outside =
		from >= width &&
		doc.slice(from - width, from) === mark &&
		doc.slice(to, to + width) === mark &&
		!(single && (doc.slice(from - 2, from - 1) === '*' || doc.slice(to + 1, to + 2) === '*'));

	if (outside) {
		return {
			from: from - width,
			to: to + width,
			insert: selected,
			selection: { from: from - width, to: to - width }
		};
	}

	const inside =
		selected.length >= width * 2 &&
		selected.startsWith(mark) &&
		selected.endsWith(mark) &&
		!(single && selected.startsWith('**'));

	if (inside) {
		const stripped = selected.slice(width, -width);
		return { from, to, insert: stripped, selection: { from, to: from + stripped.length } };
	}

	return {
		from,
		to,
		insert: `${mark}${selected}${mark}`,
		// The markers are never part of the selection: pressing bold twice has to
		// return the document to exactly what it was.
		selection: { from: from + width, to: from + width + selected.length }
	};
}

function markerFor(kind: BlockKind, level: number, ordinal: number): string {
	if (kind === 'heading') return `${'#'.repeat(level)} `;
	if (kind === 'quote') return '> ';
	if (kind === 'ordered') return `${ordinal}. `;

	return '- ';
}

/**
 * Add, change or remove a whole-line marker across the selected lines.
 *
 * A line carries at most one block marker: asking for a bullet on a quoted line
 * replaces the `>` rather than producing `- > text`, which renders as a list
 * containing a quote and is never what the button meant.
 */
function toggleBlock(
	doc: string,
	from: number,
	to: number,
	kind: BlockKind,
	level = 0
): FormatEdit {
	const { start, end } = lineBlock(doc, from, to);
	const oldLines = doc.slice(start, end).split('\n');
	const split = oldLines.map(splitLine);

	// Blank lines are passengers: a selection that spans a paragraph break should
	// not grow an empty bullet in the gap. Unless *every* line is blank, in which
	// case the writer is asking for the marker on the empty line they are on.
	const written = split.filter((line) => line.text.trim() !== '');
	const targets = written.length > 0 ? written : split;

	const has = (line: SplitLine) =>
		line.kind === kind && (kind !== 'heading' || line.level === level);
	const removing = targets.every(has);

	let ordinal = 0;
	const newLines = split.map((line) => {
		if (!targets.includes(line)) return `${line.indent}${line.text}`;
		if (removing) return `${line.indent}${line.text}`;

		ordinal++;
		return `${line.indent}${markerFor(kind, level, ordinal)}${line.text}`;
	});

	const insert = newLines.join('\n');

	if (from !== to) {
		return { from: start, to: end, insert, selection: { from: start, to: start + insert.length } };
	}

	// A caret keeps its place in the text, shifted by whatever happened to the
	// marker on its own line. Clamping covers a caret that was inside a marker
	// that has just been removed.
	const index = doc.slice(start, from).split('\n').length - 1;
	const before = (lines: string[]) =>
		lines.slice(0, index).reduce((sum, line) => sum + line.length + 1, 0);
	const column = from - start - before(oldLines);
	const shifted = Math.max(
		0,
		Math.min(newLines[index].length, column + newLines[index].length - oldLines[index].length)
	);
	const caret = start + before(newLines) + shifted;

	return { from: start, to: end, insert, selection: { from: caret, to: caret } };
}

/** none → H1 → H2 → H3 → none, judged from the first written line. */
function cycleHeading(doc: string, from: number, to: number): FormatEdit {
	const { start, end } = lineBlock(doc, from, to);
	const lines = doc.slice(start, end).split('\n').map(splitLine);
	const first = lines.find((line) => line.text.trim() !== '') ?? lines[0];

	const current = first.kind === 'heading' ? first.level : 0;
	const next = current === 0 ? 1 : current >= 3 ? 0 : current + 1;

	// Removing means toggling the level that is already there off.
	return toggleBlock(doc, from, to, 'heading', next === 0 ? current : next);
}

function insertLink(doc: string, from: number, to: number): FormatEdit {
	const selected = doc.slice(from, to);

	// A pasted URL becomes the destination and the caret goes where the words go.
	if (URL_LIKE.test(selected)) {
		const insert = `[](${selected})`;
		return { from, to, insert, selection: { from: from + 1, to: from + 1 } };
	}

	const text = selected === '' ? 'text' : selected;
	const insert = `[${text}](url)`;
	// Whichever half is still a placeholder is what gets selected, so the next
	// keystroke replaces it.
	const placeholder = selected === '' ? { from: from + 1, to: from + 1 + text.length } : null;

	return {
		from,
		to,
		insert,
		selection: placeholder ?? { from: from + text.length + 3, to: from + text.length + 6 }
	};
}

/**
 * The edit an action makes to `doc` over the selection `[from, to)`.
 *
 * Always returns an edit — every action here is meaningful on an empty document
 * — so the caller never has to decide whether something happened.
 */
export function formatEdit(
	action: FormatAction,
	doc: string,
	from: number,
	to: number
): FormatEdit {
	if (from > to) [from, to] = [to, from];

	switch (action) {
		case 'bold':
		case 'italic':
		case 'code':
			return toggleMark(doc, from, to, MARKS[action]);
		case 'heading':
			return cycleHeading(doc, from, to);
		case 'quote':
			return toggleBlock(doc, from, to, 'quote');
		case 'bullet':
			return toggleBlock(doc, from, to, 'bullet');
		case 'ordered':
			return toggleBlock(doc, from, to, 'ordered');
		case 'link':
			return insertLink(doc, from, to);
	}
}

/** The document `edit` produces. Convenience for tests and for plain textareas. */
export function applyEdit(doc: string, edit: FormatEdit): string {
	return doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
}
