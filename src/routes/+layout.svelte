<script lang="ts">
	import '$lib/styles/app.css';
	import { onMount } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import { trackKeyboardInset } from '$lib/editor/mobile-viewport';
	import { applyAppearance, settings, watchSystemTheme } from '$lib/stores/settings.svelte';
	import { templates } from '$lib/stores/templates.svelte';
	import { journal } from '$lib/stores/journal.svelte';
	import { connection } from '$lib/stores/connection.svelte';
	import { sync } from '$lib/stores/sync.svelte';

	let { children } = $props();

	onMount(() => {
		void settings.load();
		void templates.load();
		void journal.refreshWritten();
		void connection.load();

		const untrack = trackKeyboardInset();
		// The effect below repaints when the *choice* changes; this repaints when
		// the OS does, which is the other half of what `system` means.
		const untrackTheme = watchSystemTheme(() => applyAppearance(settings.current));

		// A pull can change the day that is open on screen.
		sync.onPulled(() => void journal.reload());

		const online = () => sync.setOnline(true);
		const offline = () => sync.setOnline(false);
		window.addEventListener('online', online);
		window.addEventListener('offline', offline);
		sync.setOnline(navigator.onLine);

		// A tab going away is the last chance to persist; `visibilitychange` fires
		// reliably on mobile where `beforeunload` does not. The write to IndexedDB
		// is unconditional; the commit is only a request, and manual mode ignores
		// it — leaving the tab is not the same as asking to publish.
		const onHide = () => {
			if (document.visibilityState !== 'hidden') return;
			void journal.flush();
			sync.requestNow();
		};
		document.addEventListener('visibilitychange', onHide);
		window.addEventListener('pagehide', () => void journal.flush());

		return () => {
			untrack();
			untrackTheme();
			sync.stop();
			document.removeEventListener('visibilitychange', onHide);
			window.removeEventListener('online', online);
			window.removeEventListener('offline', offline);
		};
	});

	/*
	 * Appearance waits for the stored settings.
	 *
	 * Painting the defaults first and correcting them a tick later is a visible
	 * repaint of the whole page on every launch — which is the exact thing the
	 * inline script in `app.html` exists to prevent, undone one frame after it
	 * worked. Until `loaded`, the page shows the CSS defaults, which are the same
	 * values `DEFAULT_SETTINGS` holds.
	 */
	$effect(() => {
		if (settings.loaded) applyAppearance(settings.current);
	});

	// Syncing follows the connection: it starts when a repository is chosen and
	// stops when one isn't, so a local-only journal never schedules anything.
	$effect(() => {
		if (connection.ready) void sync.start();
		else sync.stop();
	});

	// And it obeys the setting, which can change mid-session. This runs before
	// the stored settings arrive, which is why the default is the cautious one.
	$effect(() => {
		sync.setAuto(settings.current.syncMode === 'auto');
	});
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- `theme-color` is not declared here: it follows the chosen palette rather
	     than the system, so `applyAppearance` owns the tag. -->
</svelte:head>

<div class="app">
	{@render children()}
</div>

<style>
	.app {
		display: flex;
		flex-direction: column;
		height: 100%;
		/* Reserve whatever the software keyboard is covering. See
		   `trackKeyboardInset` — iOS does not shrink the layout viewport. */
		padding-bottom: var(--keyboard-inset, 0px);
		transition: padding-bottom var(--dur) var(--ease);
	}
</style>
