import { EditorSelection, type StateCommand } from '@codemirror/state';
import type { KeyBinding } from '@codemirror/view';
import { formatEdit, type FormatAction } from '$lib/core/markdown/format';
import { placeTemplate } from '$lib/core/templates/template';

/**
 * The editor's side of formatting: turn an edit into a transaction.
 *
 * Everything that decides *what* the edit is lives in `core/markdown/format`,
 * where it is tested against plain strings. This file only knows how to
 * dispatch — which is why there is so little of it.
 */
export function runFormat(action: FormatAction): StateCommand {
	return ({ state, dispatch }) => {
		// A closed day. The bar is hidden there, but the shortcuts are not.
		if (state.readOnly) return false;

		const range = state.selection.main;
		const edit = formatEdit(action, state.doc.toString(), range.from, range.to);

		dispatch(
			state.update({
				changes: { from: edit.from, to: edit.to, insert: edit.insert },
				selection: EditorSelection.range(edit.selection.from, edit.selection.to),
				scrollIntoView: true,
				// Marks it as typing for the undo history, so one ⌘Z takes the whole
				// thing back rather than unpicking it character by character.
				userEvent: 'input.format'
			})
		);

		return true;
	};
}

/** Drop filled template text in at the cursor, spaced off what is around it. */
export function insertTemplate(filled: { text: string; cursor: number }): StateCommand {
	return ({ state, dispatch }) => {
		if (state.readOnly) return false;

		const range = state.selection.main;
		const placed = placeTemplate(state.doc.toString(), range.from, filled);

		dispatch(
			state.update({
				changes: { from: range.from, to: range.to, insert: placed.insert },
				selection: EditorSelection.cursor(placed.cursor),
				scrollIntoView: true,
				userEvent: 'input.template'
			})
		);

		return true;
	};
}

/**
 * The shortcuts.
 *
 * ⌘K is the search palette elsewhere in the app, so linking takes ⌘⇧K rather
 * than quietly stealing a binding the header already advertises.
 */
export const formatKeymap: KeyBinding[] = [
	{ key: 'Mod-b', run: runFormat('bold') },
	{ key: 'Mod-i', run: runFormat('italic') },
	{ key: 'Mod-e', run: runFormat('code') },
	{ key: 'Mod-Shift-h', run: runFormat('heading') },
	{ key: 'Mod-Shift-k', run: runFormat('link') },
	{ key: 'Mod-Shift-8', run: runFormat('bullet') },
	{ key: 'Mod-Shift-7', run: runFormat('ordered') },
	{ key: "Mod-Shift-'", run: runFormat('quote') }
];
