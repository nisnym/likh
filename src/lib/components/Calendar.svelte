<script lang="ts">
	import {
		addDays,
		dayOfWeek,
		daysInMonth,
		formatLong,
		formatMonth,
		startOfMonth,
		todayKey,
		type DayKey
	} from '$lib/core/date/day';
	import { intensity } from '$lib/core/stats/writing';

	interface Props {
		selected: DayKey;
		/** Words written on each day that holds anything. Absent means unwritten. */
		written: ReadonlyMap<DayKey, number>;
		onSelect: (date: DayKey) => void;
		locale?: string;
	}

	let { selected, written, onSelect, locale }: Props = $props();

	// The grid normally shows the selected day's month; paging sets an override
	// so you can look ahead without the selection jumping around.
	let pagedMonth = $state<DayKey | null>(null);
	const cursorMonth = $derived(pagedMonth ?? startOfMonth(selected));

	$effect(() => {
		// Re-runs whenever the selected day changes: drop any manual paging so the
		// calendar follows the entry actually on screen.
		void selected;
		pagedMonth = null;
	});

	const today = todayKey();

	/** Weekday initials in the viewer's locale, starting on Monday. */
	const weekdayLabels = $derived.by(() => {
		const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
		// 2024-01-01 was a Monday.
		return Array.from({ length: 7 }, (_, i) =>
			format.format(new Date(Date.UTC(2024, 0, 1 + i))).slice(0, 2)
		);
	});

	/** Blank leading cells so the 1st lands under the right weekday (Monday-first). */
	const leadingBlanks = $derived(Array.from({ length: (dayOfWeek(cursorMonth) + 6) % 7 }));
	const monthDays = $derived(
		Array.from({ length: daysInMonth(cursorMonth) }, (_, i) => addDays(cursorMonth, i))
	);

	const number = $derived(new Intl.NumberFormat(locale));

	/**
	 * How dark a written day's mark is, 1 to 4.
	 *
	 * Floored at 1 so a day that holds only tags still shows it was touched —
	 * `intensity` reserves 0 for a day with nothing on it at all.
	 */
	function mark(date: DayKey): number {
		return Math.max(intensity(written.get(date) ?? 0), 1);
	}

	/**
	 * The mark is the one thing on this grid a screen reader cannot see, so the
	 * count goes in the label rather than being left as decoration.
	 */
	function dayLabel(date: DayKey): string {
		const long = formatLong(date, locale);
		const words = written.get(date);
		if (words === undefined) return long;

		return `${long} — ${number.format(words)} ${words === 1 ? 'word' : 'words'}`;
	}

	function step(months: number) {
		const [year, month] = cursorMonth.split('-').map(Number);
		const shifted = new Date(Date.UTC(year, month - 1 + months, 1));

		pagedMonth = `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-01`;
	}
</script>

<section class="calendar" aria-label="Calendar">
	<header>
		<button type="button" onclick={() => step(-1)} aria-label="Previous month">
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<path
					d="M10 3L5 8l5 5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
		<h2>{formatMonth(cursorMonth, locale)}</h2>
		<button type="button" onclick={() => step(1)} aria-label="Next month">
			<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
				<path
					d="M6 3l5 5-5 5"
					fill="none"
					stroke="currentColor"
					stroke-width="1.5"
					stroke-linecap="round"
					stroke-linejoin="round"
				/>
			</svg>
		</button>
	</header>

	<div class="grid" role="grid">
		{#each weekdayLabels as label, i (i)}
			<abbr class="weekday">{label}</abbr>
		{/each}

		{#each leadingBlanks as _, i (i)}
			<span class="blank"></span>
		{/each}

		{#each monthDays as date (date)}
			<button
				type="button"
				class="day"
				class:selected={date === selected}
				class:today={date === today}
				class:written={written.has(date)}
				style:--mark={mark(date)}
				aria-current={date === selected ? 'date' : undefined}
				aria-label={dayLabel(date)}
				onclick={() => onSelect(date)}
			>
				{Number(date.slice(8))}
			</button>
		{/each}
	</div>
</section>

<style>
	.calendar {
		font-family: var(--font-sans);
		font-size: var(--text-sm);
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: var(--space-2);
		margin-bottom: var(--space-3);
	}

	h2 {
		font-size: var(--text-sm);
		font-weight: 500;
		letter-spacing: 0.01em;
	}

	header button {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		transition: background var(--dur-fast) var(--ease);
	}

	header button:hover {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.weekday {
		display: grid;
		place-items: center;
		height: 24px;
		color: var(--ink-faint);
		font-size: var(--text-xs);
		text-decoration: none;
	}

	.day {
		position: relative;
		display: grid;
		place-items: center;
		aspect-ratio: 1;
		border-radius: var(--radius-sm);
		color: var(--ink-muted);
		font-variant-numeric: tabular-nums;
		transition:
			background var(--dur-fast) var(--ease),
			color var(--dur-fast) var(--ease);
	}

	.day:hover {
		background: var(--bg-sunken);
		color: var(--ink);
	}

	/*
	 * A quiet dot marks a day with writing in it, growing and darkening with the
	 * length of the entry — the month, and roughly how much of it, at a glance.
	 * `--mark` runs 1 to 4; see `INTENSITY_STEPS`.
	 */
	.day.written::after {
		content: '';
		position: absolute;
		bottom: 3px;
		width: calc(2px + var(--mark) * 1px);
		height: calc(2px + var(--mark) * 1px);
		border-radius: 50%;
		background: var(--ink-muted);
		opacity: calc(0.4 + var(--mark) * 0.15);
	}

	.day.today {
		color: var(--accent);
		font-weight: 600;
	}

	.day.selected {
		background: var(--ink);
		color: var(--bg);
	}

	.day.selected.written::after,
	.day.selected.today::after {
		background: var(--bg);
		opacity: 1;
	}

	.day.selected.today {
		color: var(--bg);
	}
</style>
