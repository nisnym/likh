<script lang="ts">
	import { page } from '$app/state';

	/*
	 * The last resort, for a route that threw or a URL the client router could
	 * not resolve.
	 *
	 * It deliberately reads nothing from IndexedDB and imports no store. If the
	 * failure was in the storage layer, anything that touches it here would throw
	 * a second time and leave the reader on a blank page — so this stays a static
	 * document, and the one piece of state it shows is the status code SvelteKit
	 * already handed it.
	 */

	const known: Record<number, string> = {
		404: 'There is no page at this address.',
		503: 'This deployment is missing a piece of its configuration.'
	};

	/* Entries live at `/YYYY-MM-DD`, so a mistyped date lands here rather than on a day. */
	const looksLikeDate = $derived(/^\/\d{4}-\d{2}-\d{2}/.test(page.url.pathname));
</script>

<svelte:head>
	<title>{page.status} · likh</title>
</svelte:head>

<main>
	<p class="code">{page.status}</p>

	<h1>{known[page.status] ?? 'Something went wrong.'}</h1>

	{#if page.error?.message && !known[page.status]}
		<p class="detail">{page.error.message}</p>
	{/if}

	<p class="reassure">
		Your writing is safe. Entries are stored in this browser and committed to your repository —
		nothing here touches either.
	</p>

	<div class="row">
		<a class="primary" href="/">Go to today</a>
		{#if looksLikeDate}
			<span class="muted">Dates look like <code>/2026-08-29</code>.</span>
		{/if}
	</div>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: var(--space-4);
		width: 100%;
		max-width: 32rem;
		margin-inline: auto;
		padding: var(--space-12) var(--space-6);
	}

	.code {
		color: var(--ink-faint);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	h1 {
		font-family: var(--font-serif);
		font-size: var(--text-xl);
		font-weight: 400;
		letter-spacing: -0.01em;
		text-wrap: pretty;
	}

	.detail {
		color: var(--ink-muted);
		font-family: var(--font-mono);
		font-size: var(--text-xs);
		overflow-wrap: break-word;
	}

	.reassure,
	.muted {
		color: var(--ink-muted);
		font-size: var(--text-sm);
		text-wrap: pretty;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: baseline;
		margin-top: var(--space-2);
	}

	.primary {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius);
		background: var(--ink);
		color: var(--bg);
		font-size: var(--text-sm);
		text-decoration: none;
	}

	code {
		font-family: var(--font-mono);
		font-size: 0.9em;
	}
</style>
