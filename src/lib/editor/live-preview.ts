import { syntaxTree } from '@codemirror/language';
import type { Extension, Range, Text } from '@codemirror/state';
import {
	Decoration,
	EditorView,
	ViewPlugin,
	type DecorationSet,
	type ViewUpdate
} from '@codemirror/view';

/**
 * Obsidian-style live preview.
 *
 * Markdown markup is *hidden*, never removed: the document in the editor is
 * byte-for-byte what gets written to the repo, and every decoration here is
 * view-only. That is the whole reason likh uses CodeMirror rather than a
 * WYSIWYG editor — a rich-text model would re-serialize the file on every save
 * and turn the git history into noise.
 *
 * Markup reappears on any line the selection touches, so the character you are
 * about to edit is always visible.
 */

const HEADING_LEVEL: Record<string, number> = {
	ATXHeading1: 1,
	ATXHeading2: 2,
	ATXHeading3: 3,
	ATXHeading4: 4,
	ATXHeading5: 5,
	ATXHeading6: 6,
	SetextHeading1: 1,
	SetextHeading2: 2
};

/** Markup nodes that vanish when the cursor is elsewhere. */
const HIDEABLE_MARKS = new Set([
	'HeaderMark',
	'EmphasisMark',
	'StrikethroughMark',
	'QuoteMark',
	'LinkMark',
	'URL',
	'LinkTitle'
]);

const hidden = Decoration.replace({});

const CONFLICT_OURS = /^<{7}(?: |$)/;
const CONFLICT_SPLIT = /^={7}$/;
const CONFLICT_THEIRS = /^>{7}(?: |$)/;

interface ConflictLines {
	/** Line numbers holding a marker. */
	markers: Map<number, 'ours' | 'split' | 'theirs'>;
	/** Every line inside a conflict region, markers included. */
	inside: Set<number>;
}

/**
 * Find conflict regions before anything else looks at the document.
 *
 * Conflict markers are not markdown, but markdown does not know that: a line of
 * `=======` turns the paragraph above it into a Setext heading, and `>>>>>>>`
 * reads as a blockquote. Left alone, the scariest moment in the app looks like
 * the editor has broken. So these lines are found first and excluded from
 * ordinary styling, and the text inside a region is shown exactly as it is.
 */
function findConflictLines(doc: Text): ConflictLines {
	const markers = new Map<number, 'ours' | 'split' | 'theirs'>();
	const inside = new Set<number>();

	let open = -1;
	let sawSplit = false;

	for (let number = 1; number <= doc.lines; number++) {
		const text = doc.line(number).text;

		if (CONFLICT_OURS.test(text)) {
			open = number;
			sawSplit = false;
		} else if (CONFLICT_SPLIT.test(text) && open !== -1) {
			sawSplit = true;
		} else if (CONFLICT_THEIRS.test(text) && open !== -1 && sawSplit) {
			for (let line = open; line <= number; line++) inside.add(line);
			markers.set(open, 'ours');
			markers.set(number, 'theirs');
			// The split is whichever `=======` sits between them.
			for (let line = open + 1; line < number; line++) {
				if (CONFLICT_SPLIT.test(doc.line(line).text)) markers.set(line, 'split');
			}
			open = -1;
			sawSplit = false;
		}
	}

	return { markers, inside };
}

interface Collected {
	lineClasses: Map<number, Set<string>>;
	hides: Array<{ from: number; to: number }>;
}

function addLineClass(collected: Collected, line: number, className: string): void {
	let classes = collected.lineClasses.get(line);
	if (!classes) {
		classes = new Set();
		collected.lineClasses.set(line, classes);
	}
	classes.add(className);
}

/** Line numbers the selection touches — markup on these stays visible. */
function activeLines(view: EditorView): Set<number> {
	const lines = new Set<number>();
	const doc = view.state.doc;

	for (const range of view.state.selection.ranges) {
		const first = doc.lineAt(range.from).number;
		const last = doc.lineAt(range.to).number;
		for (let line = first; line <= last; line++) lines.add(line);
	}

	return lines;
}

/**
 * The block containing the cursor, for focus mode. Walks up to the outermost
 * block so a multi-line paragraph or quote dims and undims as one unit.
 */
function focusedLines(view: EditorView): Set<number> {
	const doc = view.state.doc;
	const head = view.state.selection.main.head;
	const lines = new Set<number>();

	let node = syntaxTree(view.state).resolveInner(head, 1);
	let from = head;
	let to = head;

	while (node.parent) {
		if (node.name === 'Document') break;
		from = node.from;
		to = node.to;
		node = node.parent;
	}

	const first = doc.lineAt(Math.max(0, Math.min(from, doc.length))).number;
	const last = doc.lineAt(Math.max(0, Math.min(to, doc.length))).number;
	for (let line = first; line <= last; line++) lines.add(line);

	return lines;
}

function build(view: EditorView): DecorationSet {
	const doc = view.state.doc;
	const active = activeLines(view);
	const focused = focusedLines(view);
	const collected: Collected = { lineClasses: new Map(), hides: [] };
	const conflicts = findConflictLines(doc);
	const tree = syntaxTree(view.state);

	for (const { from, to } of view.visibleRanges) {
		tree.iterate({
			from,
			to,
			enter: (node) => {
				// Nothing inside a conflict region gets markdown treatment.
				if (conflicts.inside.has(doc.lineAt(node.from).number)) return;

				const level = HEADING_LEVEL[node.name];
				if (level) {
					// A Setext heading is defined by the line *under* it, which may be
					// the `=======` of a conflict. That is a separator, not a heading.
					if (conflicts.markers.has(doc.lineAt(Math.min(node.to, doc.length)).number)) return;
					addLineClass(collected, doc.lineAt(node.from).number, `likh-h${level}`);
					return;
				}

				switch (node.name) {
					case 'Blockquote':
					case 'BulletList':
					case 'OrderedList':
					case 'FencedCode':
					case 'CodeBlock': {
						const className =
							node.name === 'Blockquote'
								? 'likh-quote'
								: node.name === 'FencedCode' || node.name === 'CodeBlock'
									? 'likh-code-block'
									: 'likh-list';
						const first = doc.lineAt(node.from).number;
						const last = doc.lineAt(Math.min(node.to, doc.length)).number;
						for (let line = first; line <= last; line++) addLineClass(collected, line, className);
						return;
					}

					case 'HorizontalRule': {
						const line = doc.lineAt(node.from);
						if (!active.has(line.number)) {
							addLineClass(collected, line.number, 'likh-hr');
							if (line.to > line.from) collected.hides.push({ from: line.from, to: line.to });
						}
						return;
					}
				}

				if (!HIDEABLE_MARKS.has(node.name)) return;

				const line = doc.lineAt(node.from);
				if (active.has(line.number)) return;
				// A mark spanning lines would leave the replacement straddling a line
				// break, which CodeMirror renders as a gap. Leave those visible.
				if (node.to > line.to) return;

				let end = node.to;
				// `# ` and `> ` swallow the space after them, or the text would sit
				// one character to the right of everything else.
				if (
					(node.name === 'HeaderMark' || node.name === 'QuoteMark') &&
					end < line.to &&
					doc.sliceString(end, end + 1) === ' '
				) {
					end += 1;
				}

				if (end > node.from) collected.hides.push({ from: node.from, to: end });
			}
		});
	}

	for (const [line, kind] of conflicts.markers) {
		addLineClass(collected, line, 'likh-conflict-marker');
		addLineClass(collected, line, `likh-conflict-${kind}`);
	}
	for (const line of conflicts.inside) {
		if (!conflicts.markers.has(line)) addLineClass(collected, line, 'likh-conflict-body');
	}

	const ranges: Range<Decoration>[] = [];

	for (const [line, classes] of collected.lineClasses) {
		if (focused.has(line)) classes.add('likh-active-block');
		ranges.push(Decoration.line({ class: [...classes].join(' ') }).range(doc.line(line).from));
	}

	// Lines with no other decoration still need the focus-mode class.
	for (const line of focused) {
		if (!collected.lineClasses.has(line) && line <= doc.lines) {
			ranges.push(Decoration.line({ class: 'likh-active-block' }).range(doc.line(line).from));
		}
	}

	for (const { from, to } of collected.hides) {
		ranges.push(hidden.range(from, to));
	}

	// `true` sorts the set; line decorations must precede marks at the same offset.
	return Decoration.set(ranges, true);
}

export const livePreview: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;

		constructor(view: EditorView) {
			this.decorations = build(view);
		}

		update(update: ViewUpdate) {
			// Selection changes matter as much as edits here: moving the cursor onto
			// a line is what reveals its markup.
			if (
				update.docChanged ||
				update.viewportChanged ||
				update.selectionSet ||
				update.focusChanged
			) {
				this.decorations = build(update.view);
			}
		}
	},
	{
		decorations: (plugin) => plugin.decorations
		// Deliberately *not* registered as atomic ranges. Hidden markup should be
		// steppable: the cursor entering a line is exactly what reveals it, and
		// making the ranges atomic would make arrow keys skip past the character
		// the writer is trying to reach.
	}
);
