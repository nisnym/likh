<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import Calendar from '$lib/components/Calendar.svelte';
	import ConflictBar from '$lib/components/ConflictBar.svelte';
	import FormatBar from '$lib/components/FormatBar.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SearchPanel from '$lib/components/SearchPanel.svelte';
	import SyncIndicator from '$lib/components/SyncIndicator.svelte';
	import WritingStats from '$lib/components/WritingStats.svelte';
	import SettingsSheet, { type SettingsTab } from '$lib/components/SettingsSheet.svelte';
	import { search } from '$lib/search/client.svelte';
	import {
		addDays,
		formatFixed,
		formatLong,
		formatRelative,
		isPast,
		todayKey,
		type DayKey
	} from '$lib/core/date/day';
	import type { FormatAction } from '$lib/core/markdown/format';
	import { fillTemplate, placeTemplate, type Template } from '$lib/core/templates/template';
	import { journal } from '$lib/stores/journal.svelte';
	import { settings } from '$lib/stores/settings.svelte';
	import { sync } from '$lib/stores/sync.svelte';
	import { templates } from '$lib/stores/templates.svelte';

	/**
	 * CodeMirror is ~180KB gzipped — more than the rest of the app put together —
	 * so it is fetched after the shell paints rather than blocking it. Until it
	 * arrives the entry is rendered in the same typography, so the swap is a
	 * change of behaviour rather than a visible jump.
	 */
	let Editor = $state<typeof import('$lib/editor/Editor.svelte').default | null>(null);

	/**
	 * The mounted editor, for the things only it can do — formatting and template
	 * insertion both need the caret. Typed structurally rather than as the
	 * component, because the component itself only exists after the dynamic
	 * import resolves.
	 */
	interface EditorHandle {
		applyFormat(action: FormatAction): void;
		insertTemplate(filled: { text: string; cursor: number }): void;
	}

	let editor = $state<EditorHandle>();

	onMount(async () => {
		Editor = (await import('$lib/editor/Editor.svelte')).default;
	});

	let sidebarOpen = $state(false);

	/**
	 * Settings, as three menus rather than one.
	 *
	 * Writing, theme and syncing are separate things you go looking for at
	 * separate moments, and one gear icon makes all three equally hard to find.
	 * They share a sheet, with tabs, because switching between them should not
	 * cost a trip back to the header — which the sheet's scrim covers anyway.
	 */
	let settingsTab = $state<SettingsTab | null>(null);

	const MENUS: { tab: SettingsTab; icon: 'writing' | 'theme' | 'sync'; label: string }[] = [
		{ tab: 'writing', icon: 'writing', label: 'Writing settings' },
		{ tab: 'theme', icon: 'theme', label: 'Theme' },
		{ tab: 'sync', icon: 'sync', label: 'Syncing' }
	];
	let chromeVisible = $state(true);
	let chromeTimer: ReturnType<typeof setTimeout> | undefined;

	const date = $derived((page.params.date as DayKey | undefined) ?? todayKey());
	const isToday = $derived(date === todayKey());
	/** Past days are records: readable, and extendable only by a dated note. */
	const closed = $derived(isPast(date));
	const blank = $derived(journal.record.body.trim() === '');

	/** The template offered on a day nobody has written in yet, if one is set. */
	const daily = $derived(templates.byId(settings.current.dailyTemplateId));

	/**
	 * Put a template into the day.
	 *
	 * Always something the writer asked for, never automatic: a day that was
	 * opened and left alone has to stay absent from the repository, rather than
	 * committing an empty scaffold under a date nothing happened on.
	 */
	function useTemplate(template: Template) {
		const filled = fillTemplate(template.body, { day: date });

		if (editor) {
			editor.insertTemplate(filled);
			return;
		}

		// The editor is still loading. Append rather than lose the press.
		const body = journal.record.body;
		journal.edit(body + placeTemplate(body, body.length, filled).insert);
	}

	$effect(() => {
		void journal.open(date);
	});

	// --- Notes on a closed day ------------------------------------------

	let composing = $state(false);
	let noteText = $state('');
	let noteBox = $state<HTMLTextAreaElement>();

	// Changing day abandons an unsent note rather than carrying it to the next
	// one, where it would be filed against a day it was not written about.
	$effect(() => {
		void date;
		composing = false;
		noteText = '';
	});

	async function startNote() {
		composing = true;
		await tick();
		noteBox?.focus();
	}

	async function addNote() {
		if (noteText.trim() === '') return;

		await journal.addNote(noteText);
		composing = false;
		noteText = '';
	}

	async function saveAndSync() {
		// The flush must land before the sync starts, or the sync commits the
		// previous text and leaves this edit for a second, needless commit.
		await journal.flush();
		await sync.syncNow();
	}

	function open(next: DayKey) {
		void journal.flush();
		sidebarOpen = false;
		void goto(next === todayKey() ? '/' : `/${next}`, { keepFocus: true, noScroll: true });
	}

	/**
	 * The chrome gets out of the way while you write and comes back the moment
	 * you reach for it. Typing hides it; any pointer or keyboard intent shows it.
	 */
	function wakeChrome() {
		chromeVisible = true;
		clearTimeout(chromeTimer);
	}

	function sleepChrome() {
		clearTimeout(chromeTimer);
		chromeTimer = setTimeout(() => (chromeVisible = false), 2000);
	}

	function onKeydown(event: KeyboardEvent) {
		const mod = event.metaKey || event.ctrlKey;

		if (mod && event.key === '[') {
			event.preventDefault();
			open(addDays(date, -1));
		} else if (mod && event.key === ']') {
			event.preventDefault();
			open(addDays(date, 1));
		} else if (mod && event.key === '\\') {
			event.preventDefault();
			sidebarOpen = !sidebarOpen;
		} else if (mod && event.key.toLowerCase() === 's') {
			// The browser's "save page" is meaningless here; saving means committing.
			event.preventDefault();
			void saveAndSync();
		} else if (mod && event.key.toLowerCase() === 'k') {
			event.preventDefault();
			search.show();
		} else if (event.key === 'Escape' && sidebarOpen) {
			sidebarOpen = false;
		} else if (!mod && event.key.length === 1) {
			// Ordinary typing: fade the furniture.
			sleepChrome();
		}
	}
</script>

<svelte:head>
	<title>{formatLong(date, settings.current.locale)} · likh</title>
</svelte:head>

<svelte:window onkeydown={onKeydown} onpointermove={wakeChrome} />

<div class="shell" class:sidebar-open={sidebarOpen}>
	<aside class="sidebar" aria-label="Navigation" inert={!sidebarOpen || undefined}>
		<div class="sidebar-inner">
			<Calendar
				selected={date}
				written={journal.written}
				onSelect={open}
				locale={settings.current.locale}
			/>

			<WritingStats written={journal.written} locale={settings.current.locale} />
		</div>
	</aside>

	{#if sidebarOpen}
		<button
			type="button"
			class="scrim"
			aria-label="Close navigation"
			onclick={() => (sidebarOpen = false)}
		></button>
	{/if}

	<main class="main">
		<header class="topbar" class:dim={!chromeVisible}>
			<button
				type="button"
				class="icon"
				aria-label="Toggle calendar"
				aria-expanded={sidebarOpen}
				onclick={() => (sidebarOpen = !sidebarOpen)}
			>
				<Icon name="calendar" />
			</button>

			<div class="date">
				<h1>{formatRelative(date, todayKey(), settings.current.locale)}</h1>
				{#if !isToday}
					<button type="button" class="jump" onclick={() => open(todayKey())}>Today</button>
				{/if}
			</div>

			<div class="tools">
				<button
					type="button"
					class="icon"
					aria-label="Search entries"
					onclick={() => search.show()}
				>
					<Icon name="search" />
				</button>
				<button
					type="button"
					class="icon"
					aria-label="Previous day"
					onclick={() => open(addDays(date, -1))}
				>
					<Icon name="previous" />
				</button>
				<button
					type="button"
					class="icon"
					aria-label="Next day"
					disabled={isToday}
					onclick={() => open(addDays(date, 1))}
				>
					<Icon name="next" />
				</button>

				<span class="divider" aria-hidden="true"></span>

				{#each MENUS as menu (menu.tab)}
					<button
						type="button"
						class="icon"
						class:active={settingsTab === menu.tab}
						aria-label={menu.label}
						aria-expanded={settingsTab === menu.tab}
						onclick={() => (settingsTab = menu.tab)}
					>
						<Icon name={menu.icon} />
					</button>
				{/each}
			</div>
		</header>

		<div class="surface">
			{#if journal.record.conflicted === 1}
				<div class="rail">
					<ConflictBar
						body={journal.record.body}
						editable={!closed}
						onResolve={(body) => {
							journal.edit(body);
							void journal.flush();
						}}
					/>
				</div>
			{/if}

			{#if Editor}
				{#key date}
					<Editor
						bind:this={editor}
						value={journal.record.body}
						onChange={(body) => journal.edit(body)}
						placeholder={closed
							? 'Nothing was written on this day.'
							: isToday
								? 'What happened today?'
								: 'What are you expecting?'}
						spellcheck={settings.current.spellcheck}
						focusMode={settings.current.focusMode}
						typewriter={settings.current.typewriter}
						readonly={closed}
						autofocus={!closed}
					/>
				{/key}
			{:else}
				<pre class="loading-surface rail" aria-busy="true">{journal.record.body}</pre>
			{/if}

			{#if closed}
				<section class="afterword rail">
					{#if composing}
						<textarea
							bind:this={noteBox}
							bind:value={noteText}
							class="note-input"
							rows="6"
							aria-label="Note to add to this day"
							placeholder="What do you know now that you didn't then?"
							onkeydown={(event) => {
								if (event.key === 'Escape') composing = false;
								if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void addNote();
							}}></textarea>
						<div class="note-actions">
							<p class="note-hint">
								Added to the end, under <em>Added {formatFixed(todayKey())}</em>.
							</p>
							<button type="button" class="quiet" onclick={() => (composing = false)}>
								Cancel
							</button>
							<button
								type="button"
								class="primary"
								disabled={noteText.trim() === ''}
								onclick={() => void addNote()}
							>
								Save note
							</button>
						</div>
					{:else}
						<p class="note-hint">
							This day is closed. What you wrote then stays as written — you can add a note to it,
							dated today.
						</p>
						<button type="button" onclick={() => void startNote()}>Add a note</button>
					{/if}
				</section>
			{/if}
		</div>

		{#if !closed}
			{#if blank && daily}
				<div class="offer">
					<button type="button" onclick={() => useTemplate(daily)}>
						Start with “{daily.name}”
					</button>
				</div>
			{/if}

			<FormatBar
				templates={templates.all}
				disabled={!Editor}
				onFormat={(action) => editor?.applyFormat(action)}
				onTemplate={useTemplate}
			/>
		{/if}

		<footer class="statusbar" class:dim={!chromeVisible}>
			<span class="count">
				{journal.wordCount}
				{journal.wordCount === 1 ? 'word' : 'words'}
			</span>
			{#if journal.unsaved}
				<span class="state" aria-live="polite">Saving…</span>
			{:else}
				<SyncIndicator onSyncNow={() => void saveAndSync()} />
			{/if}
		</footer>
	</main>
</div>

<SearchPanel onSelect={open} locale={settings.current.locale} />
<SettingsSheet
	tab={settingsTab}
	onTab={(next) => (settingsTab = next)}
	onClose={() => (settingsTab = null)}
/>

<style>
	.shell {
		display: flex;
		height: 100%;
		overflow: hidden;
	}

	/* --- Sidebar ------------------------------------------------------ */

	.sidebar {
		flex: 0 0 auto;
		width: 0;
		overflow: hidden;
		border-right: 1px solid transparent;
		background: var(--bg-sunken);
		transition:
			width var(--dur) var(--ease),
			border-color var(--dur) var(--ease);
	}

	.sidebar-open .sidebar {
		width: 17rem;
		border-right-color: var(--rule);
	}

	/* Scrolls on its own once the calendar and the year's numbers outrun a short
	   window; `contain` keeps that scroll from carrying on into the entry. */
	.sidebar-inner {
		width: 17rem;
		height: 100%;
		overflow-y: auto;
		overscroll-behavior: contain;
		padding: var(--space-6) var(--space-4);
	}

	.scrim {
		display: none;
	}

	/* --- Main --------------------------------------------------------- */

	.main {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-width: 0;
	}

	.topbar,
	.statusbar {
		flex: 0 0 auto;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		transition: opacity var(--dur-slow) var(--ease);
	}

	/* The furniture fades while you write, and returns on any pointer move.
	   `:focus-within` keeps it up whenever it is being used with a keyboard. */
	.topbar.dim,
	.statusbar.dim {
		opacity: 0;
	}

	.topbar:hover,
	.topbar:focus-within,
	.statusbar:hover,
	.statusbar:focus-within {
		opacity: 1;
	}

	.topbar {
		/* Three columns rather than `space-between`: the side groups hold different
		   numbers of buttons, so only equal-width columns put the date on the
		   actual centre line of the page. */
		display: grid;
		grid-template-columns: 1fr auto 1fr;
		padding: var(--space-3) var(--space-4);
	}

	.date {
		display: flex;
		align-items: baseline;
		justify-content: center;
		gap: var(--space-3);
		min-width: 0;
	}

	h1 {
		font-family: var(--font-serif);
		font-size: var(--text-lg);
		font-weight: 400;
		letter-spacing: -0.01em;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.jump {
		color: var(--accent);
		font-family: var(--font-sans);
		font-size: var(--text-sm);
	}

	.jump:hover {
		text-decoration: underline;
	}

	.tools {
		display: flex;
		justify-content: flex-end;
		gap: var(--space-1);
	}

	.icon {
		display: grid;
		place-items: center;
		width: 30px;
		height: 30px;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.icon:hover:not(:disabled) {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.icon:disabled {
		opacity: 0.3;
		cursor: default;
	}

	/* The open menu keeps its icon lit, so the sheet has a visible source. */
	.icon.active {
		background: var(--bg-sunken);
		color: var(--accent);
	}

	.divider {
		align-self: center;
		width: 1px;
		height: 16px;
		margin-inline: var(--space-1);
		background: var(--rule);
	}

	.surface {
		display: flex;
		flex: 1;
		flex-direction: column;
		min-height: 0;
	}

	.surface :global(.editor) {
		flex: 1;
		min-height: 0;
	}

	/*
	 * The writing column is set on the editor's own content, not on a wrapper
	 * around it — see the editor theme. A wrapper would make the scroller as
	 * narrow as the text, which puts the scrollbar in the middle of the page
	 * beside the words. Everything that is *not* the editor lines up with the
	 * text through this instead.
	 */
	.rail {
		flex: 0 0 auto;
		width: 100%;
		max-width: var(--measure);
		margin-inline: auto;
		padding-inline: var(--space-6);
	}

	/* Matches the editor's metrics so the handover is invisible. */
	.loading-surface {
		margin: 0;
		padding-block-start: var(--space-2);
		font-family: var(--font-serif);
		font-size: var(--editor-size);
		line-height: var(--leading-body);
		white-space: pre-wrap;
		overflow-wrap: break-word;
	}

	/* --- The afterword on a closed day -------------------------------- */

	.afterword {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
		margin-top: var(--space-4);
		padding: var(--space-4) 0 var(--space-6);
		border-top: 1px solid var(--rule);
	}

	.note-hint {
		flex: 1 1 12rem;
		margin: 0;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: var(--leading-tight);
	}

	.note-hint em {
		font-style: normal;
		color: var(--ink-muted);
	}

	.afterword button {
		color: var(--accent);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.afterword button:disabled {
		color: var(--ink-faint);
		text-decoration: none;
		cursor: default;
	}

	.afterword .quiet {
		color: var(--ink-faint);
	}

	.note-input {
		flex: 1 1 100%;
		width: 100%;
		padding: var(--space-3);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--ink);
		font-family: var(--font-serif);
		font-size: var(--text-sm);
		line-height: var(--leading-body);
		resize: vertical;
	}

	.note-input:focus-visible {
		border-color: var(--accent);
	}

	.note-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-3);
		width: 100%;
	}

	/* The one-tap offer on an empty day. Sits with the toolbar rather than in the
	   writing area, so it never looks like text that is already there. */
	.offer {
		flex: 0 0 auto;
		width: 100%;
		max-width: var(--measure);
		margin-inline: auto;
		padding: 0 var(--space-6);
	}

	.offer button {
		color: var(--accent);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.statusbar {
		justify-content: space-between;
		padding: var(--space-2) var(--space-6);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		font-variant-numeric: tabular-nums;
	}

	/* --- Narrow screens ----------------------------------------------- */

	@media (max-width: 44rem) {
		.sidebar {
			position: fixed;
			inset-block: 0;
			left: 0;
			z-index: 20;
			width: 17rem;
			transform: translateX(-100%);
			box-shadow: var(--shadow-lg);
			transition: transform var(--dur) var(--ease);
		}

		.sidebar-open .sidebar {
			transform: none;
		}

		.scrim {
			display: block;
			position: fixed;
			inset: 0;
			z-index: 10;
			background: oklch(0% 0 0 / 0.28);
			cursor: default;
		}

		.rail,
		.offer {
			padding-inline: var(--space-4);
		}

		/*
		 * Seven icons and a date do not fit on a phone in three equal columns, so
		 * the date stops being centred on the page and is centred in what is left.
		 */
		.topbar {
			grid-template-columns: auto 1fr auto;
			padding-inline: var(--space-2);
		}

		.tools {
			gap: 0;
		}

		.divider {
			margin-inline: 2px;
		}

		/* Touch targets need room the mouse does not. */
		.icon {
			width: 38px;
			height: 38px;
		}
	}
</style>
