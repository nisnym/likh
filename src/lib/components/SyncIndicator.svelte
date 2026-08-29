<script lang="ts">
	import { sync } from '$lib/stores/sync.svelte';

	interface Props {
		onSyncNow: () => void;
	}

	let { onSyncNow }: Props = $props();

	const label = $derived.by(() => {
		switch (sync.state) {
			case 'off':
				return 'Saved locally';
			case 'offline':
				return sync.pending > 0 ? `Offline · ${sync.pending} to sync` : 'Offline';
			case 'syncing':
				return 'Syncing…';
			case 'pending':
				return sync.pending > 0 ? `${sync.pending} to sync` : 'Sync queued';
			case 'conflict':
				return sync.conflicts.length === 1 ? '1 conflict' : `${sync.conflicts.length} conflicts`;
			case 'error':
				return 'Sync failed';
			case 'idle':
				return 'Synced';
		}
	});

	const tone = $derived(
		sync.state === 'conflict' || sync.state === 'error'
			? 'warn'
			: sync.state === 'idle'
				? 'ok'
				: 'quiet'
	);
</script>

<button
	type="button"
	class="indicator {tone}"
	onclick={onSyncNow}
	title={sync.error ??
		(sync.lastSyncAt
			? `Last synced ${new Date(sync.lastSyncAt).toLocaleTimeString()}`
			: 'Sync now')}
	aria-live="polite"
>
	<span class="dot" class:spin={sync.state === 'syncing'}></span>
	{label}
</button>

<style>
	.indicator {
		display: inline-flex;
		align-items: center;
		gap: var(--space-2);
		padding: 2px var(--space-2);
		border-radius: var(--radius-sm);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		transition: color var(--dur-fast) var(--ease);
	}

	.indicator:hover {
		color: var(--ink-muted);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		opacity: 0.6;
	}

	.ok .dot {
		background: var(--ok);
		opacity: 1;
	}

	.warn {
		color: var(--warn);
	}

	.warn .dot {
		background: var(--warn);
		opacity: 1;
	}

	/* A quiet pulse rather than a spinner: this appears while you are writing. */
	.dot.spin {
		animation: pulse 1.2s var(--ease) infinite;
	}

	@keyframes pulse {
		0%,
		100% {
			opacity: 0.25;
		}
		50% {
			opacity: 1;
		}
	}
</style>
