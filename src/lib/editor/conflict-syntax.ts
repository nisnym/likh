import type { MarkdownConfig } from '@lezer/markdown';

/**
 * Teach the markdown parser that conflict markers are not markdown.
 *
 * Without this, a merge conflict makes the editor look broken rather than
 * merely difficult: `=======` turns the entire paragraph above it into a Setext
 * heading, and `>>>>>>>` opens a deeply nested blockquote. Styling alone cannot
 * undo that, because the damage happens in the parse.
 *
 * The trade-off: a line of exactly seven `=` is read as a conflict separator
 * rather than a Setext underline. Seven is what git writes, `#` headings are
 * the common form in a journal, and a mis-rendered heading is a far smaller
 * problem than a mangled conflict.
 */

const MARKER = /^(?:<{7}(?: |$)|={7}$|>{7}(?: |$))/;

export const conflictMarkers: MarkdownConfig = {
	defineNodes: [{ name: 'ConflictMarker' }],
	parseBlock: [
		{
			name: 'ConflictMarker',
			// Ahead of every built-in parser, so `>>>>>>>` cannot be claimed as a
			// blockquote first.
			before: 'LinkReference',

			parse(cx, line) {
				if (!MARKER.test(line.text.slice(line.pos))) return false;

				cx.addElement(
					cx.elt('ConflictMarker', cx.lineStart + line.pos, cx.lineStart + line.text.length)
				);
				cx.nextLine();

				return true;
			},

			// A marker has to be able to interrupt the paragraph above it, or the
			// whole conflict gets swallowed into it.
			endLeaf(_cx, line) {
				return MARKER.test(line.text.slice(line.pos));
			}
		}
	]
};
