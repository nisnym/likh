import { EditorView } from '@codemirror/view';
import type { Extension } from '@codemirror/state';

/**
 * Typewriter scrolling: keep the line being written near the vertical middle of
 * the surface instead of letting it crawl toward the bottom edge.
 *
 * Only reacts to edits and cursor moves the user made — reacting to every
 * update would fight the scrollbar when someone is reading back through a long
 * entry.
 */
export const typewriterScroll: Extension = EditorView.updateListener.of((update) => {
	if (!update.docChanged && !update.selectionSet) return;
	if (!update.view.hasFocus) return;

	const head = update.state.selection.main.head;
	update.view.dispatch({ effects: EditorView.scrollIntoView(head, { y: 'center' }) });
});
