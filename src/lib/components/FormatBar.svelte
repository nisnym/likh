<script lang="ts">
	import type { FormatAction } from '$lib/core/markdown/format';
	import type { Template } from '$lib/core/templates/template';

	interface Props {
		onFormat: (action: FormatAction) => void;
		onTemplate: (template: Template) => void;
		templates: Template[];
		/** True until the editor has finished loading. */
		disabled?: boolean;
	}

	let { onFormat, onTemplate, templates, disabled = false }: Props = $props();

	// The shortcut hints are the only place in the app that has to name a
	// modifier key, and naming the wrong one is worse than naming none.
	const mod =
		typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl+';

	const ACTIONS: { id: FormatAction; label: string; keys: string; glyph?: string }[] = [
		{ id: 'bold', label: 'Bold', keys: `${mod}B`, glyph: 'B' },
		{ id: 'italic', label: 'Italic', keys: `${mod}I`, glyph: 'I' },
		{ id: 'heading', label: 'Heading', keys: `${mod}⇧H`, glyph: 'H' },
		{ id: 'quote', label: 'Quote', keys: `${mod}⇧'`, glyph: '“' },
		{ id: 'bullet', label: 'Bulleted list', keys: `${mod}⇧8` },
		{ id: 'ordered', label: 'Numbered list', keys: `${mod}⇧7` },
		{ id: 'code', label: 'Code', keys: `${mod}E`, glyph: '</>' },
		{ id: 'link', label: 'Link', keys: `${mod}⇧K` }
	];

	let menuOpen = $state(false);

	function pick(template: Template) {
		menuOpen = false;
		onTemplate(template);
	}
</script>

{#snippet icon(id: FormatAction, glyph: string | undefined)}
	{#if glyph}
		<span
			class="glyph"
			class:bold={id === 'bold'}
			class:italic={id === 'italic'}
			class:mono={id === 'code'}
			class:quote={id === 'quote'}
			aria-hidden="true">{glyph}</span
		>
	{:else if id === 'bullet'}
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<circle cx="2.5" cy="4" r="1.2" fill="currentColor" />
			<circle cx="2.5" cy="8" r="1.2" fill="currentColor" />
			<circle cx="2.5" cy="12" r="1.2" fill="currentColor" />
			<path
				d="M6 4h8M6 8h8M6 12h8"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
			/>
		</svg>
	{:else if id === 'ordered'}
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<text x="0" y="5.6" font-size="5.5" fill="currentColor">1</text>
			<text x="0" y="10" font-size="5.5" fill="currentColor">2</text>
			<text x="0" y="14.4" font-size="5.5" fill="currentColor">3</text>
			<path
				d="M6 4h8M6 8h8M6 12h8"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
			/>
		</svg>
	{:else}
		<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
			<path
				d="M6.6 9.4a2.6 2.6 0 0 0 3.9.3l2-2a2.6 2.6 0 0 0-3.7-3.7l-1 1"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
			/>
			<path
				d="M9.4 6.6a2.6 2.6 0 0 0-3.9-.3l-2 2a2.6 2.6 0 0 0 3.7 3.7l1-1"
				fill="none"
				stroke="currentColor"
				stroke-width="1.4"
				stroke-linecap="round"
			/>
		</svg>
	{/if}
{/snippet}

<div class="formatbar">
	<div class="actions" role="toolbar" aria-label="Formatting" aria-orientation="horizontal">
		{#each ACTIONS as action (action.id)}
			<button
				type="button"
				aria-label={action.label}
				title="{action.label} · {action.keys}"
				{disabled}
				onclick={() => onFormat(action.id)}
			>
				{@render icon(action.id, action.glyph)}
			</button>
		{/each}
	</div>

	{#if templates.length > 0}
		<div class="templates">
			<button
				type="button"
				class="pill"
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				{disabled}
				onclick={() => (menuOpen = !menuOpen)}
			>
				Template
			</button>

			{#if menuOpen}
				<button
					type="button"
					class="scrim"
					aria-label="Close template list"
					onclick={() => (menuOpen = false)}
				></button>
				<ul class="menu" role="menu">
					{#each templates as template (template.id)}
						<li role="none">
							<button type="button" role="menuitem" onclick={() => pick(template)}>
								{template.name}
							</button>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>

<svelte:window
	onkeydown={(event) => {
		if (menuOpen && event.key === 'Escape') menuOpen = false;
	}}
/>

<style>
	.formatbar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		max-width: var(--measure);
		width: 100%;
		margin-inline: auto;
		padding: var(--space-1) var(--space-6);
	}

	/*
	 * Unlike the header and the status bar, this does not fade while you write.
	 * It is a tool rather than furniture, and on a phone — where there are no
	 * shortcuts and no hover to bring it back — it is the only way in.
	 */
	.actions {
		display: flex;
		gap: var(--space-1);
		min-width: 0;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.actions::-webkit-scrollbar {
		display: none;
	}

	.actions button,
	.pill {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		height: 30px;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.actions button {
		width: 30px;
	}

	.actions button:hover:not(:disabled),
	.pill:hover:not(:disabled) {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.actions button:disabled,
	.pill:disabled {
		opacity: 0.35;
		cursor: default;
	}

	.glyph {
		font-family: var(--font-serif);
		font-size: 15px;
		line-height: 1;
	}

	.glyph.bold {
		font-weight: 700;
	}

	.glyph.italic {
		font-style: italic;
	}

	.glyph.mono {
		font-family: var(--font-mono);
		font-size: 11px;
	}

	.glyph.quote {
		/* A quotation mark hangs high in its box; nudge it onto the optical centre. */
		font-size: 22px;
		line-height: 0;
		transform: translateY(0.18em);
	}

	.templates {
		position: relative;
		flex: 0 0 auto;
	}

	.pill {
		padding: 0 var(--space-3);
		font-size: var(--text-xs);
	}

	.scrim {
		position: fixed;
		inset: 0;
		z-index: 30;
		cursor: default;
	}

	.menu {
		position: absolute;
		right: 0;
		bottom: calc(100% + var(--space-1));
		z-index: 31;
		min-width: 11rem;
		max-height: 15rem;
		overflow-y: auto;
		margin: 0;
		padding: var(--space-1);
		list-style: none;
		background: var(--bg-raised);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		box-shadow: var(--shadow-lg);
	}

	.menu button {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius-sm);
		text-align: left;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.menu button:hover {
		background: var(--bg-sunken);
	}

	@media (max-width: 44rem) {
		.formatbar {
			padding-inline: var(--space-4);
		}

		/* Touch targets need room the mouse does not. */
		.actions button {
			width: 38px;
			height: 38px;
		}

		.pill {
			height: 38px;
		}
	}
</style>
