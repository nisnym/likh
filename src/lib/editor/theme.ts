import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/**
 * The writing surface.
 *
 * Every colour is a `var(--…)` from the design tokens, so light and dark come
 * from the same stylesheet the rest of the app uses and there is no second
 * palette to keep in sync.
 */
const base = EditorView.theme({
	'&': {
		color: 'var(--ink)',
		backgroundColor: 'transparent',
		fontFamily: 'var(--font-serif)',
		fontSize: 'var(--editor-size)',
		height: '100%'
	},

	/*
	 * The scroller runs the full width of the window and the writing column is
	 * set on `.cm-content` inside it. Constraining the scroller instead would put
	 * its scrollbar down the middle of the page, a hand's width from the text.
	 */
	'.cm-scroller': {
		fontFamily: 'inherit',
		lineHeight: 'var(--leading-body)',
		/*
		 * Room below the last line, so writing at the bottom of a long entry does
		 * not happen against the edge of the screen. Kept well under half a screen:
		 * padding is content as far as the scroller is concerned, and 40vh of it
		 * put a scrollbar beside a six-line entry that had nothing to scroll.
		 */
		padding: 'var(--space-2) 0 20vh',
		overflowX: 'hidden',
		// Firefox. Quiet enough to ignore while writing, present enough to reach
		// for; the hover rule below darkens it when someone does.
		scrollbarWidth: 'thin',
		scrollbarColor: 'var(--rule) transparent'
	},

	'.cm-scroller:hover, .cm-scroller:focus-within': {
		scrollbarColor: 'var(--rule-strong) transparent'
	},

	// WebKit and Blink, which ignore `scrollbar-width` on most versions and
	// otherwise draw the platform scrollbar at full weight.
	'.cm-scroller::-webkit-scrollbar': { width: '11px', height: '11px' },
	'.cm-scroller::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
	'.cm-scroller::-webkit-scrollbar-thumb': {
		// The transparent border plus `background-clip` is what makes a 5px thumb
		// out of an 11px track: padding on a scrollbar thumb has no other spelling.
		// `background-color`, not the `background` shorthand: the shorthand resets
		// `background-clip`, and a custom property inside it serialises to nothing
		// the thumb can use.
		backgroundColor: 'var(--rule)',
		border: '3px solid transparent',
		backgroundClip: 'content-box',
		borderRadius: '11px'
	},
	'.cm-scroller:hover::-webkit-scrollbar-thumb': {
		backgroundColor: 'var(--rule-strong)'
	},
	'.cm-scroller::-webkit-scrollbar-corner': { backgroundColor: 'transparent' },

	'.cm-content': {
		// The writing column. `border-box` is set globally, so this matches the
		// measure everything else on the page lines up with.
		maxWidth: 'var(--measure)',
		width: '100%',
		marginInline: 'auto',
		padding: '0 var(--space-6)',
		caretColor: 'var(--accent)',
		// `overflow-wrap` rather than `word-break` so long URLs wrap without
		// hyphenating ordinary prose mid-word.
		overflowWrap: 'break-word'
	},

	'.cm-line': {
		padding: '0'
	},

	'&.cm-focused': { outline: 'none' },

	'.cm-cursor, .cm-dropCursor': {
		borderLeftColor: 'var(--accent)',
		borderLeftWidth: '2px'
	},

	'&.cm-focused .cm-selectionBackground, .cm-selectionBackground, ::selection': {
		backgroundColor: 'var(--accent-soft)'
	},

	'.cm-placeholder': {
		color: 'var(--ink-faint)',
		fontStyle: 'italic'
	},

	'.cm-selectionMatch': { backgroundColor: 'transparent' },

	'.cm-searchMatch': {
		backgroundColor: 'var(--accent-soft)',
		borderRadius: 'var(--radius-sm)'
	},
	'.cm-searchMatch.cm-searchMatch-selected': {
		outline: '1px solid var(--accent)'
	}
});

/**
 * Block-level shape. These classes are attached by the live-preview plugin
 * rather than by the highlighter, because they style whole lines.
 */
/*
 * Never use `margin` on `.cm-line`.
 *
 * CodeMirror measures line geometry from the element's box, and a margin sits
 * outside it — so a margin shifts where a line is painted without shifting
 * where CodeMirror thinks it is. The symptom is that clicking a heading places
 * the caret on the following line. Padding is inside the box and measures
 * correctly, so vertical rhythm here is always padding.
 */
const blocks = EditorView.theme({
	'.cm-line.likh-h1': {
		fontSize: '1.55em',
		fontWeight: '600',
		lineHeight: '1.25',
		letterSpacing: '-0.015em',
		paddingTop: '0.7em'
	},
	'.cm-line.likh-h2': {
		fontSize: '1.3em',
		fontWeight: '600',
		lineHeight: '1.3',
		letterSpacing: '-0.01em',
		paddingTop: '0.6em'
	},
	'.cm-line.likh-h3': { fontSize: '1.12em', fontWeight: '600', paddingTop: '0.55em' },
	'.cm-line.likh-h4, .cm-line.likh-h5, .cm-line.likh-h6': {
		fontWeight: '600',
		color: 'var(--ink-muted)',
		paddingTop: '0.5em'
	},

	'.cm-line.likh-quote': {
		paddingLeft: '1.1em',
		borderLeft: '2px solid var(--rule-strong)',
		color: 'var(--ink-muted)',
		fontStyle: 'italic'
	},

	'.cm-line.likh-list': { paddingLeft: '0.4em' },

	'.cm-line.likh-code-block': {
		fontFamily: 'var(--font-mono)',
		fontSize: '0.85em',
		backgroundColor: 'var(--bg-sunken)',
		lineHeight: '1.6'
	},

	'.cm-line.likh-hr': {
		// Drawn as a centred background rather than a border on a zero-height box,
		// so the line keeps a real, measurable height for CodeMirror.
		padding: '0.75em 0',
		backgroundImage: 'linear-gradient(var(--rule), var(--rule))',
		backgroundSize: '100% 1px',
		backgroundPosition: 'center',
		backgroundRepeat: 'no-repeat',
		color: 'transparent'
	},

	/*
	 * Conflict regions. Styled to read as machinery rather than prose — the
	 * markers are not something the writer typed, and the two sides need to be
	 * told apart at a glance.
	 */
	'.cm-line.likh-conflict-marker': {
		fontFamily: 'var(--font-mono)',
		fontSize: '0.75em',
		letterSpacing: '0.02em',
		color: 'var(--warn)',
		background: 'var(--bg-sunken)',
		paddingBlock: '0.15em'
	},
	'.cm-line.likh-conflict-body': {
		paddingLeft: '0.8em',
		borderLeft: '2px solid var(--warn)',
		background: 'var(--bg-sunken)'
	},

	/* Focus mode dims everything but the paragraph under the cursor. */
	'.likh-focus-mode .cm-line': {
		transition: 'opacity var(--dur) var(--ease)',
		opacity: '0.28'
	},
	'.likh-focus-mode .cm-line.likh-active-block': { opacity: '1' }
});

const highlight = HighlightStyle.define([
	{ tag: tags.strong, fontWeight: '650' },
	{ tag: tags.emphasis, fontStyle: 'italic' },
	{ tag: tags.strikethrough, textDecoration: 'line-through', color: 'var(--ink-faint)' },
	{
		tag: tags.monospace,
		fontFamily: 'var(--font-mono)',
		fontSize: '0.86em',
		background: 'var(--bg-sunken)',
		padding: '0.1em 0.3em',
		borderRadius: 'var(--radius-sm)'
	},
	{ tag: tags.link, color: 'var(--accent)', textDecoration: 'underline' },
	{ tag: tags.url, color: 'var(--ink-faint)' },
	{ tag: tags.heading, fontWeight: '600' },
	{ tag: tags.quote, color: 'var(--ink-muted)' },
	{ tag: tags.list, color: 'var(--ink)' },
	// The markup characters themselves, on the line you're editing.
	{ tag: tags.processingInstruction, color: 'var(--ink-faint)' },
	{ tag: tags.comment, color: 'var(--ink-faint)', fontStyle: 'italic' },
	{ tag: tags.keyword, color: 'var(--accent)' },
	{ tag: tags.string, color: 'var(--ink-muted)' }
]);

/** The gutter narrows on a phone, in step with the rest of the page. */
const narrow = EditorView.theme({
	'@media (max-width: 44rem)': {
		'.cm-content': { padding: '0 var(--space-4)' }
	}
});

export const likhTheme: Extension = [base, blocks, narrow, syntaxHighlighting(highlight)];
