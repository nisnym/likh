<script lang="ts" module>
	/** Writing, theme and syncing: three menus, one sheet. */
	export type SettingsTab = 'writing' | 'theme' | 'sync';
</script>

<script lang="ts">
	import { tick } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';
	import {
		LINE_WIDTHS,
		LINE_WIDTH_LABELS,
		TEXT_SIZES,
		type LineWidth
	} from '$lib/core/theme/reading';
	import { SYSTEM_PAIR, THEMES } from '$lib/core/theme/themes';
	import { settings } from '$lib/stores/settings.svelte';
	import { connection } from '$lib/stores/connection.svelte';
	import { sync } from '$lib/stores/sync.svelte';
	import { templates } from '$lib/stores/templates.svelte';

	interface Props {
		/** Which menu is showing, or null when the sheet is closed. */
		tab: SettingsTab | null;
		onTab: (tab: SettingsTab) => void;
		onClose: () => void;
	}

	let { tab, onTab, onClose }: Props = $props();

	const TABS: { id: SettingsTab; icon: IconName; label: string }[] = [
		{ id: 'writing', icon: 'writing', label: 'Writing' },
		{ id: 'theme', icon: 'theme', label: 'Theme' },
		{ id: 'sync', icon: 'sync', label: 'Syncing' }
	];

	const widths = Object.keys(LINE_WIDTHS) as LineWidth[];

	/** The template whose editor is open. At most one, to keep the sheet short. */
	let editing = $state<string | null>(null);
	let nameBox = $state<HTMLInputElement>();

	async function addTemplate() {
		const template = await templates.add();
		editing = template.id;
		await tick();
		nameBox?.select();
	}

	async function removeTemplate(id: string) {
		if (settings.current.dailyTemplateId === id) await settings.update({ dailyTemplateId: null });
		await templates.remove(id);
		if (editing === id) editing = null;
	}
</script>

{#if tab}
	<div class="overlay">
		<button type="button" class="scrim" aria-label="Close settings" onclick={onClose}></button>

		<div class="sheet" role="dialog" aria-modal="true" aria-label="Settings">
			<!-- The same three icons as the header, so it is obvious which one
			     opened this and that the other two are a click away. -->
			<div class="tabs" role="tablist" aria-label="Settings">
				{#each TABS as option (option.id)}
					<button
						type="button"
						role="tab"
						id="tab-{option.id}"
						aria-selected={tab === option.id}
						aria-controls="panel-{option.id}"
						class:selected={tab === option.id}
						onclick={() => onTab(option.id)}
					>
						<Icon name={option.icon} />
						{option.label}
					</button>
				{/each}
			</div>

			{#if tab === 'theme'}
				<div class="panel" role="tabpanel" id="panel-theme" aria-labelledby="tab-theme">
					<fieldset>
						<legend class="sr-only">Theme</legend>
						<div class="swatches">
							<button
								type="button"
								class="swatch"
								class:selected={settings.current.theme === 'system'}
								aria-pressed={settings.current.theme === 'system'}
								onclick={() => settings.update({ theme: 'system' })}
							>
								<!-- Both halves of the pair, so "System" shows what it will do. -->
								<span class="preview split">
									<span data-theme={SYSTEM_PAIR.light}>Aa</span>
									<span data-theme={SYSTEM_PAIR.dark}>Aa</span>
								</span>
								<span class="name">System</span>
							</button>

							{#each THEMES as theme (theme.id)}
								<button
									type="button"
									class="swatch"
									class:selected={settings.current.theme === theme.id}
									aria-pressed={settings.current.theme === theme.id}
									title={theme.note}
									onclick={() => settings.update({ theme: theme.id })}
								>
									<!-- The swatch wears the palette, so this is the real thing and
							     not an impression of it kept in a second list. -->
									<span class="preview" data-theme={theme.id}>Aa<i></i></span>
									<span class="name">{theme.label}</span>
								</button>
							{/each}
						</div>
					</fieldset>
				</div>
			{:else if tab === 'writing'}
				<div class="panel" role="tabpanel" id="panel-writing" aria-labelledby="tab-writing">
					<fieldset>
						<legend>Text size</legend>
						<div class="segmented">
							{#each TEXT_SIZES as size (size)}
								<button
									type="button"
									class:selected={settings.current.fontSize === size}
									aria-pressed={settings.current.fontSize === size}
									aria-label="{size} pixels"
									onclick={() => settings.update({ fontSize: size })}
								>
									<span style="font-size: {size}px">Aa</span>
								</button>
							{/each}
						</div>
					</fieldset>

					<fieldset>
						<legend>Line width</legend>
						<div class="segmented">
							{#each widths as width (width)}
								<button
									type="button"
									class:selected={settings.current.lineWidth === width}
									aria-pressed={settings.current.lineWidth === width}
									onclick={() => settings.update({ lineWidth: width })}
								>
									{LINE_WIDTH_LABELS[width]}
								</button>
							{/each}
						</div>
					</fieldset>

					<label class="toggle">
						<span>
							<strong>Focus mode</strong>
							<small>Dim everything but the paragraph you're in.</small>
						</span>
						<input
							type="checkbox"
							checked={settings.current.focusMode}
							onchange={(event) => settings.update({ focusMode: event.currentTarget.checked })}
						/>
					</label>

					<label class="toggle">
						<span>
							<strong>Typewriter scrolling</strong>
							<small>Keep the line you're writing near the middle.</small>
						</span>
						<input
							type="checkbox"
							checked={settings.current.typewriter}
							onchange={(event) => settings.update({ typewriter: event.currentTarget.checked })}
						/>
					</label>

					<label class="toggle">
						<span>
							<strong>Spellcheck</strong>
							<small>Underline misspelled words while you write.</small>
						</span>
						<input
							type="checkbox"
							checked={settings.current.spellcheck}
							onchange={(event) => settings.update({ spellcheck: event.currentTarget.checked })}
						/>
					</label>

					<section class="templates">
						<h3>Templates</h3>
						<p class="note">
							Markdown you drop into an entry from the <strong>Template</strong> button while
							writing. Use <code>{'{{date}}'}</code>, <code>{'{{weekday}}'}</code>,
							<code>{'{{time}}'}</code>
							for the day being written, and <code>{'{{cursor}}'}</code> for where the caret should land.
						</p>

						{#each templates.all as template (template.id)}
							<div class="template" class:open={editing === template.id}>
								<div class="template-head">
									<button
										type="button"
										class="disclose"
										aria-expanded={editing === template.id}
										onclick={() => (editing = editing === template.id ? null : template.id)}
									>
										<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
											<path
												d="M6 3l5 5-5 5"
												fill="none"
												stroke="currentColor"
												stroke-width="1.8"
												stroke-linecap="round"
												stroke-linejoin="round"
											/>
										</svg>
										{template.name}
									</button>
									<button type="button" class="danger" onclick={() => removeTemplate(template.id)}>
										Delete
									</button>
								</div>

								{#if editing === template.id}
									<input
										bind:this={nameBox}
										class="template-name"
										aria-label="Template name"
										value={template.name}
										oninput={(event) =>
											templates.update(template.id, { name: event.currentTarget.value })}
									/>
									<textarea
										class="template-body"
										aria-label="Template for {template.name}"
										rows="8"
										placeholder="## What happened&#10;&#10;{'{{cursor}}'}"
										value={template.body}
										oninput={(event) =>
											templates.update(template.id, { body: event.currentTarget.value })}
									></textarea>
								{/if}
							</div>
						{/each}

						<div class="row">
							<button type="button" onclick={addTemplate}>Add a template</button>
						</div>

						{#if templates.all.length > 0}
							<label class="pick">
								<span>Offer on an empty day</span>
								<select
									value={settings.current.dailyTemplateId ?? ''}
									onchange={(event) =>
										settings.update({ dailyTemplateId: event.currentTarget.value || null })}
								>
									<option value="">Nothing</option>
									{#each templates.all as template (template.id)}
										<option value={template.id}>{template.name}</option>
									{/each}
								</select>
							</label>
							<p class="note">
								Offered, never written: a day you open and leave alone stays out of the repository.
								Templates live on this device — they are tooling, not journal, so they are not
								committed.
							</p>
						{/if}
					</section>
				</div>
			{:else}
				<div class="panel" role="tabpanel" id="panel-sync" aria-labelledby="tab-sync">
					<section class="sync">
						<h3>Syncing</h3>

						{#if connection.checking}
							<p class="note">Checking…</p>
						{:else if connection.ready && connection.repo}
							<p class="note">
								Committing to <strong>{connection.repo.owner}/{connection.repo.name}</strong> on
								<code>{connection.repo.branch}</code>.
							</p>
							{#if sync.conflicts.length > 0}
								<p class="note warn">
									{sync.conflicts.length === 1
										? '1 day has changes from two devices'
										: `${sync.conflicts.length} days have changes from two devices`} and is waiting for
									you. Open it to sort out.
								</p>
							{:else if sync.pending > 0}
								<p class="note">
									{sync.pending === 1 ? '1 entry is' : `${sync.pending} entries are`} written here but
									not committed yet.
								</p>
							{:else if sync.lastSyncAt}
								<p class="note">Last synced {new Date(sync.lastSyncAt).toLocaleTimeString()}.</p>
							{/if}

							<label class="toggle">
								<span>
									<strong>Sync automatically</strong>
									<small>
										{settings.current.syncMode === 'auto'
											? 'Commits on a pause in writing, on reconnect, and every few minutes.'
											: 'Off — entries commit only when you ask.'}
									</small>
								</span>
								<input
									type="checkbox"
									checked={settings.current.syncMode === 'auto'}
									onchange={(event) =>
										settings.update({ syncMode: event.currentTarget.checked ? 'auto' : 'manual' })}
								/>
							</label>

							<div class="row">
								<button
									type="button"
									onclick={() => sync.syncNow()}
									disabled={sync.state === 'syncing'}
								>
									{sync.state === 'syncing' ? 'Syncing…' : 'Sync now'}
								</button>
								<a href="/connect">Change repository</a>
								<button type="button" class="danger" onclick={() => connection.disconnect()}>
									Disconnect
								</button>
							</div>
						{:else if connection.connected}
							<p class="note">Connected to GitHub, but no repository chosen yet.</p>
							<a href="/connect">Choose a repository</a>
						{:else}
							<p class="note">
								Entries are stored on this device only. Connect a GitHub repository to keep them in
								version control and read them anywhere.
							</p>
							<a href="/connect">Connect a repository</a>
						{/if}
					</section>
				</div>
			{/if}
		</div>
	</div>
{/if}

<svelte:window
	onkeydown={(event) => {
		if (tab && event.key === 'Escape') onClose();
	}}
/>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		place-items: center;
	}

	.scrim {
		position: absolute;
		inset: 0;
		background: var(--bg-overlay);
		backdrop-filter: blur(3px);
		cursor: default;
	}

	.sheet {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		width: min(26rem, calc(100vw - 2rem));
		max-height: 85vh;
		overflow-y: auto;
		padding: var(--space-6);
		background: var(--bg-raised);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	/* --- The three menus ---------------------------------------------- */

	.tabs {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--bg-sunken);
		border-radius: var(--radius);
	}

	.tabs button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: var(--space-2);
		min-height: 34px;
		padding: var(--space-1) var(--space-2);
		border-radius: calc(var(--radius) - 2px);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.tabs button.selected {
		background: var(--bg-raised);
		color: var(--ink);
		box-shadow: var(--shadow-sm);
	}

	.panel {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
	}

	/* Syncing is the whole of its panel, so it carries no separating rule. */
	.panel > .sync:first-child {
		margin-top: 0;
		padding-top: 0;
		border-top: none;
	}

	fieldset {
		border: none;
		padding: 0;
		margin: 0;
	}

	legend {
		padding: 0 0 var(--space-2);
		color: var(--ink-muted);
		font-size: var(--text-sm);
	}

	.segmented {
		display: flex;
		gap: 2px;
		padding: 2px;
		background: var(--bg-sunken);
		border-radius: var(--radius);
	}

	.segmented button {
		flex: 1;
		display: grid;
		place-items: center;
		min-height: 34px;
		padding: var(--space-1) var(--space-2);
		border-radius: calc(var(--radius) - 2px);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.segmented button.selected {
		background: var(--bg-raised);
		color: var(--ink);
		box-shadow: var(--shadow-sm);
	}

	/* --- Theme swatches ---------------------------------------------- */

	.swatches {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(5.5rem, 1fr));
		gap: var(--space-2);
	}

	.swatch {
		display: flex;
		flex-direction: column;
		gap: var(--space-1);
		padding: var(--space-1);
		border: 1px solid transparent;
		border-radius: var(--radius);
		text-align: left;
	}

	.swatch.selected {
		border-color: var(--accent);
	}

	.swatch:hover .preview {
		border-color: var(--rule-strong);
	}

	.preview {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 2.4rem;
		padding: 0 var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		/* Inside a `[data-theme]` these resolve to that palette, which is the whole
		   point: the swatch is the theme rather than a picture of it. */
		background: var(--bg);
		color: var(--ink);
		font-family: var(--font-serif);
		font-size: var(--text-sm);
		overflow: hidden;
	}

	.preview i {
		width: 7px;
		height: 7px;
		margin-left: auto;
		border-radius: 50%;
		background: var(--accent);
	}

	.preview.split {
		padding: 0;
		border: none;
		background: none;
	}

	.preview.split span {
		flex: 1;
		display: grid;
		place-items: center;
		height: 100%;
		background: var(--bg);
		color: var(--ink);
		border: 1px solid var(--rule);
	}

	.preview.split span:first-child {
		border-radius: var(--radius-sm) 0 0 var(--radius-sm);
	}

	.preview.split span:last-child {
		border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
		border-left: none;
	}

	.name {
		color: var(--ink-muted);
		font-size: var(--text-xs);
	}

	.swatch.selected .name {
		color: var(--ink);
	}

	/* --- Templates ---------------------------------------------------- */

	.templates {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
		margin-top: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
	}

	.template {
		width: 100%;
		padding: var(--space-1) 0;
		border-bottom: 1px solid var(--rule);
	}

	.template-head {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
	}

	.disclose {
		flex: 1;
		display: flex;
		align-items: center;
		gap: var(--space-2);
		text-align: left;
		font-size: var(--text-sm);
		color: var(--ink);
	}

	.disclose svg {
		flex: 0 0 auto;
		color: var(--ink-faint);
		transition: transform var(--dur-fast) var(--ease);
	}

	.disclose[aria-expanded='true'] svg {
		transform: rotate(90deg);
	}

	.disclose:hover {
		color: var(--accent);
	}

	.template-name,
	.template-body {
		width: 100%;
		margin-top: var(--space-2);
		padding: var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		font-size: var(--text-sm);
	}

	.template-body {
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		line-height: 1.6;
		resize: vertical;
		white-space: pre;
		overflow-wrap: normal;
		overflow-x: auto;
	}

	.pick {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		width: 100%;
		font-size: var(--text-sm);
	}

	.pick select {
		max-width: 12rem;
		padding: var(--space-1) var(--space-2);
		border: 1px solid var(--rule);
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
	}

	.templates .row button {
		color: var(--accent);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.toggle {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		cursor: pointer;
	}

	.toggle span {
		display: flex;
		flex-direction: column;
	}

	.toggle strong {
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.toggle small {
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.4;
	}

	.toggle input {
		flex: 0 0 auto;
		width: 18px;
		height: 18px;
		accent-color: var(--accent);
	}

	.sync {
		display: flex;
		flex-direction: column;
		gap: var(--space-2);
		align-items: flex-start;
		margin-top: var(--space-2);
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
	}

	h3 {
		color: var(--ink-muted);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.note {
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: 1.5;
		text-wrap: pretty;
	}

	.note code {
		font-family: var(--font-mono);
		font-size: 0.95em;
	}

	.row {
		display: flex;
		gap: var(--space-4);
		font-size: var(--text-xs);
	}

	.sync a {
		font-size: var(--text-xs);
	}

	.row button {
		color: var(--accent);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.row button:disabled {
		color: var(--ink-faint);
		text-decoration: none;
		cursor: default;
	}

	.note.warn {
		color: var(--warn);
	}

	.danger {
		color: var(--danger);
		font-size: var(--text-xs);
		text-decoration: underline;
		text-underline-offset: 2px;
	}
</style>
