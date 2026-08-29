<script lang="ts">
	import { findConflicts, resolveAll } from '$lib/core/markdown/conflict';

	interface Props {
		body: string;
		onResolve: (body: string) => void;
		/** False on a closed day, where the markers cannot be edited by hand. */
		editable?: boolean;
	}

	let { body, onResolve, editable = true }: Props = $props();

	const regions = $derived(findConflicts(body));
	const count = $derived(regions.length);
	const labels = $derived(regions[0] ?? { oursLabel: 'this device', theirsLabel: 'remote' });
</script>

{#if count > 0}
	<div class="bar" role="status">
		<div class="text">
			<strong>
				{count === 1 ? 'This day was written in two places.' : `${count} parts of this day differ.`}
			</strong>
			<span>
				{editable
					? 'Both versions are below, between the markers. Edit them into what you meant, or pick a side.'
					: 'Both versions are below, between the markers. This day is closed, so pick a side.'}
			</span>
		</div>

		<div class="actions">
			<button type="button" onclick={() => onResolve(resolveAll(body, 'ours'))}>
				Keep {labels.oursLabel}
			</button>
			<button type="button" onclick={() => onResolve(resolveAll(body, 'theirs'))}>
				Keep {labels.theirsLabel}
			</button>
		</div>
	</div>
{/if}

<style>
	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-3);
		margin-bottom: var(--space-4);
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--warn);
		border-radius: var(--radius);
		background: var(--bg-raised);
		font-family: var(--font-sans);
	}

	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 14rem;
		flex: 1;
	}

	strong {
		font-size: var(--text-sm);
		font-weight: 500;
	}

	span {
		color: var(--ink-muted);
		font-size: var(--text-xs);
		line-height: 1.5;
		text-wrap: pretty;
	}

	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}

	.actions button {
		padding: var(--space-1) var(--space-3);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
		font-size: var(--text-xs);
		white-space: nowrap;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}

	.actions button:hover {
		border-color: var(--accent);
		background: var(--bg-sunken);
	}
</style>
