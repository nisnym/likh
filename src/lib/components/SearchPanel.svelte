<script lang="ts">
	import { formatRelative, type DayKey } from '$lib/core/date/day';
	import { search } from '$lib/search/client.svelte';

	interface Props {
		onSelect: (date: DayKey) => void;
		locale?: string;
	}

	let { onSelect, locale }: Props = $props();

	let input = $state<HTMLInputElement>();

	$effect(() => {
		if (search.open) input?.focus();
	});

	function choose(date: DayKey) {
		search.hide();
		onSelect(date);
	}

	function onKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			event.preventDefault();
			search.hide();
		} else if (event.key === 'ArrowDown') {
			event.preventDefault();
			search.move(1);
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			search.move(-1);
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const hit = search.hits[search.selected];
			if (hit) choose(hit.date);
		}
	}
</script>

{#if search.open}
	<div class="overlay" role="presentation">
		<button type="button" class="scrim" aria-label="Close search" onclick={() => search.hide()}
		></button>

		<div class="panel" role="dialog" aria-modal="true" aria-label="Search entries">
			<div class="field">
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
					<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.5" />
					<path
						d="M10.5 10.5L14 14"
						stroke="currentColor"
						stroke-width="1.5"
						stroke-linecap="round"
					/>
				</svg>
				<input
					bind:this={input}
					type="search"
					placeholder="Search your journal"
					value={search.text}
					oninput={(event) => search.setText(event.currentTarget.value)}
					onkeydown={onKeydown}
					autocomplete="off"
					spellcheck="false"
					aria-label="Search your journal"
				/>
			</div>

			{#if search.text.trim() !== ''}
				<ul class="results" role="listbox" aria-label="Results">
					{#each search.hits as hit, i (hit.date)}
						<li>
							<button
								type="button"
								class="hit"
								class:active={i === search.selected}
								role="option"
								aria-selected={i === search.selected}
								onclick={() => choose(hit.date)}
								onmouseenter={() => (search.selected = i)}
							>
								<span class="when">{formatRelative(hit.date, undefined, locale)}</span>
								<span class="excerpt">{hit.excerpt}</span>
							</button>
						</li>
					{:else}
						<li class="empty">{search.busy ? 'Searching…' : 'Nothing found.'}</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
{/if}

<style>
	.overlay {
		position: fixed;
		inset: 0;
		z-index: 40;
		display: grid;
		justify-items: center;
		align-content: start;
		padding-top: 12vh;
	}

	.scrim {
		position: absolute;
		inset: 0;
		background: var(--bg-overlay);
		backdrop-filter: blur(3px);
		cursor: default;
	}

	.panel {
		position: relative;
		width: min(36rem, calc(100vw - 2rem));
		max-height: 70vh;
		overflow: hidden;
		display: flex;
		flex-direction: column;
		background: var(--bg-raised);
		border: 1px solid var(--rule);
		border-radius: var(--radius-lg);
		box-shadow: var(--shadow-lg);
	}

	.field {
		display: flex;
		align-items: center;
		gap: var(--space-3);
		padding: var(--space-4);
		border-bottom: 1px solid var(--rule);
		color: var(--ink-faint);
	}

	input {
		flex: 1;
		min-width: 0;
		border: none;
		background: none;
		outline: none;
		font-size: var(--text-base);
	}

	input::-webkit-search-cancel-button {
		display: none;
	}

	.results {
		list-style: none;
		margin: 0;
		padding: var(--space-2);
		overflow-y: auto;
	}

	.hit {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border-radius: var(--radius);
		text-align: left;
	}

	.hit.active {
		background: var(--bg-sunken);
	}

	.when {
		color: var(--ink);
		font-size: var(--text-sm);
		font-weight: 500;
	}

	.excerpt {
		color: var(--ink-muted);
		font-family: var(--font-serif);
		font-size: var(--text-sm);
		line-height: 1.5;
		display: -webkit-box;
		-webkit-line-clamp: 2;
		line-clamp: 2;
		-webkit-box-orient: vertical;
		overflow: hidden;
	}

	.empty {
		padding: var(--space-4);
		color: var(--ink-faint);
		font-size: var(--text-sm);
		text-align: center;
	}
</style>
