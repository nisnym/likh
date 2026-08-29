<script lang="ts">
	import { onMount } from 'svelte';
	import { Compartment, EditorState } from '@codemirror/state';
	import { EditorView } from '@codemirror/view';
	import type { FormatAction } from '$lib/core/markdown/format';
	import { insertTemplate as insertTemplateCommand, runFormat } from './format';
	import { editorExtensions } from './setup';
	import { typewriterScroll } from './typewriter';

	interface Props {
		/** The entry body. Changing it from outside replaces the document. */
		value: string;
		onChange?: (value: string) => void;
		placeholder?: string;
		spellcheck?: boolean;
		focusMode?: boolean;
		typewriter?: boolean;
		autofocus?: boolean;
		/** A past day: readable, selectable, copyable — but not rewritable. */
		readonly?: boolean;
	}

	let {
		value,
		onChange,
		placeholder = 'Write something.',
		spellcheck = true,
		focusMode = false,
		typewriter = false,
		autofocus = false,
		readonly = false
	}: Props = $props();

	/**
	 * `readOnly` blocks the transactions; `editable` also drops
	 * `contenteditable`, which is what stops a mobile keyboard opening on a day
	 * that cannot take the text.
	 */
	const readonlyExtensions = (on: boolean) =>
		on ? [EditorState.readOnly.of(true), EditorView.editable.of(false)] : [];

	let host = $state<HTMLDivElement>();
	let view: EditorView | undefined;

	// Set while we push an external value into the editor, so the resulting
	// update doesn't echo straight back out through `onChange`.
	let applyingExternal = false;

	const typewriterCompartment = new Compartment();
	const spellcheckCompartment = new Compartment();
	const readonlyCompartment = new Compartment();

	export function focus(): void {
		view?.focus();
	}

	export function getView(): EditorView | undefined {
		return view;
	}

	/**
	 * Apply a formatting action, as the toolbar buttons do.
	 *
	 * Routed through the same `StateCommand` the keyboard shortcuts use, so a
	 * button press and ⌘B cannot drift apart. Focus returns to the text
	 * afterwards: clicking a button took it, and the next thing anyone wants to
	 * do is keep typing.
	 */
	export function applyFormat(action: FormatAction): void {
		if (!view) return;

		runFormat(action)(view);
		view.focus();
	}

	/** Drop filled template text in at the cursor. */
	export function insertTemplate(filled: { text: string; cursor: number }): void {
		if (!view) return;

		insertTemplateCommand(filled)(view);
		view.focus();
	}

	/**
	 * Construction happens in `onMount`, not in an effect.
	 *
	 * An effect would track every prop it reads — including `value` — and so
	 * would tear the editor down and rebuild it on every keystroke, resetting the
	 * cursor to the start of the document each time. Switching days is handled by
	 * a `{#key}` around this component instead.
	 */
	onMount(() => {
		const instance = new EditorView({
			parent: host,
			state: EditorState.create({
				doc: value,
				extensions: [
					...editorExtensions({ placeholder }),
					spellcheckCompartment.of(
						EditorView.contentAttributes.of({ spellcheck: String(spellcheck) })
					),
					typewriterCompartment.of(typewriter ? typewriterScroll : []),
					readonlyCompartment.of(readonlyExtensions(readonly)),
					EditorView.updateListener.of((update) => {
						if (!update.docChanged || applyingExternal) return;
						onChange?.(update.state.doc.toString());
					})
				]
			})
		});

		view = instance;
		// Land the cursor at the end of what's already written, so returning to a
		// day continues it rather than typing over the beginning.
		instance.dispatch({ selection: { anchor: instance.state.doc.length } });
		if (autofocus) instance.focus();

		return () => {
			instance.destroy();
			view = undefined;
		};
	});

	// Adopt a value replaced from outside (an incoming sync, a discarded edit).
	// Comparing first matters: dispatching on every keystroke would reset the
	// cursor and the undo history while someone is typing.
	$effect(() => {
		const next = value;
		if (!view || applyingExternal) return;
		if (view.state.doc.toString() === next) return;

		applyingExternal = true;
		try {
			view.dispatch({
				changes: { from: 0, to: view.state.doc.length, insert: next },
				selection: { anchor: next.length },
				scrollIntoView: true
			});
		} finally {
			applyingExternal = false;
		}
	});

	$effect(() => {
		const on = readonly;
		view?.dispatch({ effects: readonlyCompartment.reconfigure(readonlyExtensions(on)) });
	});

	$effect(() => {
		const on = typewriter;
		view?.dispatch({ effects: typewriterCompartment.reconfigure(on ? typewriterScroll : []) });
	});

	$effect(() => {
		const on = spellcheck;
		view?.dispatch({
			effects: spellcheckCompartment.reconfigure(
				EditorView.contentAttributes.of({ spellcheck: String(on) })
			)
		});
	});
</script>

<div bind:this={host} class="editor" class:likh-focus-mode={focusMode}></div>

<style>
	.editor {
		height: 100%;
	}

	.editor :global(.cm-editor) {
		height: 100%;
	}
</style>
