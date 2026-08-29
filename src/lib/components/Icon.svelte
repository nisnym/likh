<script lang="ts" module>
	export type IconName = 'calendar' | 'search' | 'previous' | 'next' | 'writing' | 'theme' | 'sync';
</script>

<script lang="ts">
	/**
	 * The app's icons, on one 16-unit grid.
	 *
	 * Drawn rather than imported: seven shapes is far less than a set costs to
	 * carry, and keeping them together is what makes them look like a set — the
	 * same 1.4 stroke, the same round caps, the same optical weight. Everything
	 * inherits `currentColor`, so they follow the theme without knowing it exists.
	 */
	interface Props {
		name: IconName;
		size?: number;
	}

	let { name, size = 16 }: Props = $props();
</script>

<svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
	{#if name === 'calendar'}
		<rect x="2" y="3" width="12" height="11" rx="2" fill="none" stroke="currentColor" />
		<path d="M2 6.5h12M5.5 2v2M10.5 2v2" stroke="currentColor" />
	{:else if name === 'search'}
		<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" />
		<path d="M10.5 10.5L14 14" stroke="currentColor" />
	{:else if name === 'previous'}
		<path d="M10 3L5 8l5 5" fill="none" stroke="currentColor" />
	{:else if name === 'next'}
		<path d="M6 3l5 5-5 5" fill="none" stroke="currentColor" />
	{:else if name === 'writing'}
		<!-- A pencil: body, nib at the bottom-left, and the ferrule across it. -->
		<path
			d="M3.2 12.8L3.7 10.4L10.6 3.5A1.7 1.7 0 0 1 12.9 5.8L6 12.7Z"
			fill="none"
			stroke="currentColor"
		/>
		<path d="M9.2 4.9L11.5 7.2" stroke="currentColor" />
	{:else if name === 'theme'}
		<!-- Half-filled circle: the same shape whichever half of the day it is. -->
		<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" />
		<path d="M8 2.4a5.6 5.6 0 0 0 0 11.2z" fill="currentColor" />
	{:else if name === 'sync'}
		<path d="M2.6 8.4A5.4 5.4 0 0 1 12 4.4" fill="none" stroke="currentColor" />
		<path d="M9.1 5L12 4.4L11.4 1.5" fill="none" stroke="currentColor" />
		<path d="M13.4 7.6A5.4 5.4 0 0 1 4 11.6" fill="none" stroke="currentColor" />
		<path d="M6.9 11L4 11.6L4.6 14.5" fill="none" stroke="currentColor" />
	{/if}
</svg>

<style>
	svg {
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
</style>
