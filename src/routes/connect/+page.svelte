<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import type { Repo } from '$lib/core/github/types';
	import { sync } from '$lib/stores/sync.svelte';
	import { connection } from '$lib/stores/connection.svelte';

	let repos = $state<Repo[]>([]);
	let loadingRepos = $state(false);
	let busyWith = $state<string | null>(null);
	let failure = $state<string | null>(null);
	let token = $state('');
	let showTokenForm = $state(false);

	const callbackError = $derived(page.url.searchParams.get('error'));

	onMount(async () => {
		await connection.load();
		if (connection.connected) await loadRepos();
	});

	async function loadRepos() {
		loadingRepos = true;
		failure = null;

		try {
			repos = await connection.listRepos();
		} catch (error) {
			failure = message(error);
		} finally {
			loadingRepos = false;
		}
	}

	async function choose(repo: Repo) {
		busyWith = repo.fullName;
		failure = null;

		try {
			await connection.useRepo(repo);
			// Bring the repository down before leaving the page, so the journal is
			// there when it opens. Not awaited: a large journal should not hold the
			// screen, and the indicator reports it either way.
			void sync.adopt();
			await goto('/');
		} catch (error) {
			failure = message(error);
		} finally {
			busyWith = null;
		}
	}

	async function submitToken(event: SubmitEvent) {
		event.preventDefault();
		busyWith = 'token';
		failure = null;

		try {
			await connection.connectWithToken(token);
			token = '';
			showTokenForm = false;
			await loadRepos();
		} catch (error) {
			failure = message(error);
		} finally {
			busyWith = null;
		}
	}

	function message(error: unknown): string {
		return error instanceof Error ? error.message : 'Something went wrong.';
	}
</script>

<svelte:head>
	<title>Connect a repository · likh</title>
</svelte:head>

<main>
	<header>
		<h1>Where should your journal live?</h1>
		<p class="lede">
			likh writes one markdown file per day to a GitHub repository you own. Everything works
			offline; syncing just means committing.
		</p>
	</header>

	{#if callbackError}
		<p class="alert" role="alert">
			GitHub sign-in didn't complete: {callbackError.replace(/_/g, ' ')}. Try again.
		</p>
	{/if}
	{#if failure}
		<p class="alert" role="alert">{failure}</p>
	{/if}

	{#if connection.checking}
		<p class="muted">Checking…</p>
	{:else if !connection.connected}
		<section class="step">
			{#if connection.configured}
				<a class="primary" href="/auth/login?return=/connect">Connect GitHub</a>
				<p class="muted">
					likh asks only for read and write access to repository contents, on the repositories you
					pick. Your token stays on the server and is never given to the page.
				</p>
			{:else}
				<p class="muted">
					This deployment has no GitHub app configured, so use a personal access token instead.
				</p>
			{/if}

			<button type="button" class="link" onclick={() => (showTokenForm = !showTokenForm)}>
				{showTokenForm ? 'Never mind' : 'Use a personal access token instead'}
			</button>

			{#if showTokenForm}
				<form onsubmit={submitToken}>
					<label for="token"
						>Fine-grained token with <strong>Contents: read and write</strong></label
					>
					<input
						id="token"
						type="password"
						bind:value={token}
						placeholder="github_pat_…"
						autocomplete="off"
						spellcheck="false"
					/>
					<div class="row">
						<button type="submit" class="primary" disabled={busyWith === 'token' || !token.trim()}>
							{busyWith === 'token' ? 'Checking…' : 'Use this token'}
						</button>
						<a
							href="https://github.com/settings/personal-access-tokens/new"
							target="_blank"
							rel="noreferrer noopener">Create one</a
						>
					</div>
					<p class="warn">
						A token pasted here is stored in this browser, where any script running on this page
						could use it.{#if connection.configured}
							The hosted sign-in above keeps the token on the server instead.{:else}
							Give it access to one repository, and nothing else.{/if}
					</p>
				</form>
			{/if}
		</section>
	{:else}
		<section class="step">
			<p class="who">
				Connected as <strong>{connection.login}</strong>
				<button type="button" class="link" onclick={() => connection.disconnect()}
					>Disconnect</button
				>
			</p>

			{#if loadingRepos}
				<p class="muted">Loading your repositories…</p>
			{:else if repos.length === 0}
				<p class="muted">
					No repositories available yet. Create one on GitHub — an empty private repo is ideal —
					then grant likh access to it.
				</p>
				<div class="row">
					<a
						class="primary"
						href="https://github.com/new"
						target="_blank"
						rel="noreferrer noopener"
					>
						Create a repository
					</a>
					{#if connection.installUrl}
						<a href={connection.installUrl} target="_blank" rel="noreferrer noopener">
							Choose repositories
						</a>
					{/if}
					<button type="button" class="link" onclick={loadRepos}>Refresh</button>
				</div>
			{:else}
				<ul class="repos">
					{#each repos as repo (repo.fullName)}
						<li>
							<button
								type="button"
								class="repo"
								disabled={busyWith !== null}
								onclick={() => choose(repo)}
							>
								<span class="name">
									{repo.fullName}
									{#if repo.private}<span class="badge">private</span>{/if}
								</span>
								<span class="action">
									{busyWith === repo.fullName ? 'Setting up…' : 'Use this'}
								</span>
							</button>
						</li>
					{/each}
				</ul>
				<div class="row">
					{#if connection.installUrl}
						<a href={connection.installUrl} target="_blank" rel="noreferrer noopener">
							Add another repository
						</a>
					{/if}
					<button type="button" class="link" onclick={loadRepos}>Refresh</button>
				</div>
			{/if}
		</section>
	{/if}

	<footer>
		<a href="/">Keep writing without syncing</a>
	</footer>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: var(--space-6);
		width: 100%;
		max-width: 32rem;
		margin-inline: auto;
		padding: var(--space-12) var(--space-6);
	}

	h1 {
		font-family: var(--font-serif);
		font-size: var(--text-xl);
		font-weight: 400;
		letter-spacing: -0.01em;
	}

	.lede {
		margin-top: var(--space-3);
		color: var(--ink-muted);
		font-size: var(--text-sm);
		text-wrap: pretty;
	}

	.step {
		display: flex;
		flex-direction: column;
		gap: var(--space-4);
		align-items: flex-start;
	}

	.muted {
		color: var(--ink-muted);
		font-size: var(--text-sm);
		text-wrap: pretty;
	}

	.warn {
		color: var(--warn);
		font-size: var(--text-xs);
		line-height: 1.5;
		text-wrap: pretty;
	}

	.alert {
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--danger);
		border-radius: var(--radius);
		color: var(--danger);
		font-size: var(--text-sm);
	}

	.primary {
		display: inline-block;
		padding: var(--space-2) var(--space-4);
		border-radius: var(--radius);
		background: var(--ink);
		color: var(--bg);
		font-size: var(--text-sm);
		font-weight: 500;
		text-decoration: none;
	}

	.primary:disabled {
		opacity: 0.5;
	}

	.link {
		color: var(--accent);
		font-size: var(--text-sm);
		text-decoration: underline;
		text-underline-offset: 2px;
	}

	.row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-4);
		font-size: var(--text-sm);
	}

	form {
		display: flex;
		flex-direction: column;
		gap: var(--space-3);
		width: 100%;
		padding: var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
	}

	label {
		font-size: var(--text-sm);
	}

	input {
		width: 100%;
		padding: var(--space-2) var(--space-3);
		border: 1px solid var(--rule-strong);
		border-radius: var(--radius-sm);
		background: var(--bg);
		font-family: var(--font-mono);
		font-size: var(--text-sm);
	}

	.who {
		display: flex;
		align-items: baseline;
		gap: var(--space-3);
		font-size: var(--text-sm);
	}

	.repos {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 100%;
		list-style: none;
		margin: 0;
		padding: 0;
	}

	.repo {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-4);
		width: 100%;
		padding: var(--space-3) var(--space-4);
		border: 1px solid var(--rule);
		border-radius: var(--radius);
		text-align: left;
		transition:
			border-color var(--dur-fast) var(--ease),
			background var(--dur-fast) var(--ease);
	}

	.repo:hover:not(:disabled) {
		border-color: var(--accent);
		background: var(--bg-sunken);
	}

	.repo:disabled {
		opacity: 0.6;
	}

	.name {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		font-size: var(--text-sm);
	}

	.badge {
		padding: 1px var(--space-2);
		border-radius: 999px;
		background: var(--bg-sunken);
		color: var(--ink-faint);
		font-size: var(--text-xs);
	}

	.action {
		flex: 0 0 auto;
		color: var(--accent);
		font-size: var(--text-sm);
	}

	footer {
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
		font-size: var(--text-sm);
	}
</style>
