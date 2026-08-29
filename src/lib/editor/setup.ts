import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown, markdownKeymap, markdownLanguage } from '@codemirror/lang-markdown';
import { EditorState, type Extension } from '@codemirror/state';
import {
	EditorView,
	drawSelection,
	dropCursor,
	highlightSpecialChars,
	keymap,
	placeholder,
	type KeyBinding
} from '@codemirror/view';
import { conflictMarkers } from './conflict-syntax';
import { formatKeymap } from './format';
import { livePreview } from './live-preview';
import { likhTheme } from './theme';

export interface EditorOptions {
	placeholder?: string;
	extraKeys?: KeyBinding[];
}

/**
 * The extension set for the writing surface.
 *
 * Deliberately short. Line numbers, fold gutters, bracket auto-closing and
 * autocompletion all belong in a code editor and get in the way of prose, so
 * none of them are here.
 */
export function editorExtensions(options: EditorOptions = {}): Extension[] {
	return [
		history(),
		drawSelection(),
		dropCursor(),
		highlightSpecialChars(),
		EditorView.lineWrapping,

		markdown({ base: markdownLanguage, addKeymap: false, extensions: [conflictMarkers] }),
		livePreview,
		likhTheme,

		placeholder(options.placeholder ?? 'Write something.'),

		keymap.of([
			...(options.extraKeys ?? []),
			// Before `markdownKeymap` and `defaultKeymap`, so a formatting binding
			// wins over anything either of them happens to claim.
			...formatKeymap,
			// Continues lists and quotes on Enter — the one markdown affordance
			// worth having, since retyping `- ` every line is friction.
			...markdownKeymap,
			...defaultKeymap,
			...historyKeymap,
			indentWithTab
		]),

		// `spellcheck` is not set here — the Editor component owns it through a
		// compartment so it can be toggled without rebuilding the editor.
		EditorView.contentAttributes.of({
			autocorrect: 'on',
			autocapitalize: 'sentences',
			'aria-label': 'Journal entry'
		}),

		/*
		 * Keep the caret clear of the edges while typing.
		 *
		 * CodeMirror scrolls a new line *just* into view, which lands it flush
		 * against the toolbar below — fine to read, unpleasant to write on. A
		 * fraction of the viewport rather than a constant, so it holds on a phone
		 * and on a tall window alike.
		 */
		EditorView.scrollMargins.of((view) => ({
			top: 16,
			bottom: Math.round(view.dom.clientHeight * 0.18)
		})),

		EditorState.allowMultipleSelections.of(true)
	];
}
