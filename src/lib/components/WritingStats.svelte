<script lang="ts">
	import { todayKey, type DayKey } from '$lib/core/date/day';
	import { summarize } from '$lib/core/stats/writing';

	interface Props {
		/** Words written on each day that holds anything. */
		written: ReadonlyMap<DayKey, number>;
		locale?: string;
	}

	let { written, locale }: Props = $props();

	/*
	 * A quiet account of the year, under the calendar.
	 *
	 * Everything here is something that already happened. There is no target, no
	 * share of one, and nothing that turns amber when a day is missed — a journal
	 * you feel watched by is one you stop being honest in. The numbers are here
	 * because it is genuinely nice to see a year add up, and for no other reason.
	 */

	const today = todayKey();
	const stats = $derived(summarize(written, today));

	const number = $derived(new Intl.NumberFormat(locale));
	// A year is a number, not a quantity: 2026, never 2,026.
	const year = $derived(
		new Intl.NumberFormat(locale, { useGrouping: false }).format(Number(today.slice(0, 4)))
	);

	function days(count: number): string {
		return `${number.format(count)} ${count === 1 ? 'day' : 'days'}`;
	}

	/*
	 * A run of one day is every journal's starting state, and a longest run equal
	 * to the current one is the same fact written twice. Neither earns a line.
	 */
	const showRun = $derived(stats.current.length > 0);
	const showLongest = $derived(stats.longest.length > stats.current.length);

	/** All-time totals are only news once the journal reaches past this year. */
	const showAllTime = $derived(stats.days > stats.daysThisYear);
</script>

{#if stats.days > 0}
	<section class="stats" aria-label="Writing stats">
		<h2>{year}</h2>

		<dl>
			<div class="row">
				<dt>Days written</dt>
				<dd>{number.format(stats.daysThisYear)}</dd>
			</div>
			<div class="row">
				<dt>Words</dt>
				<dd>{number.format(stats.wordsThisYear)}</dd>
			</div>
			{#if showRun}
				<div class="row">
					<dt>In a row</dt>
					<dd>{days(stats.current.length)}</dd>
				</div>
			{/if}
			{#if showLongest}
				<div class="row">
					<dt>Longest run</dt>
					<dd>{days(stats.longest.length)}</dd>
				</div>
			{/if}
		</dl>

		{#if showAllTime}
			<p class="all">{days(stats.days)} and {number.format(stats.words)} words in all.</p>
		{/if}
	</section>
{/if}

<style>
	.stats {
		margin-top: var(--space-6);
		padding-top: var(--space-4);
		border-top: 1px solid var(--rule);
		font-family: var(--font-sans);
	}

	/* Sits level with the calendar's month, so the sidebar reads as two sections. */
	h2 {
		margin-bottom: var(--space-3);
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	.row {
		display: flex;
		align-items: baseline;
		justify-content: space-between;
		gap: var(--space-3);
		padding-block: 2px;
		font-size: var(--text-xs);
	}

	dt {
		color: var(--ink-muted);
	}

	dd {
		color: var(--ink);
		font-variant-numeric: tabular-nums;
	}

	.all {
		margin-top: var(--space-3);
		color: var(--ink-faint);
		font-size: var(--text-xs);
		line-height: var(--leading-tight);
		text-wrap: pretty;
	}
</style>
