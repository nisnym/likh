import { getDay, listWrittenCounts, saveDay } from '$lib/core/db/days';
import type { DayRecord } from '$lib/core/db/types';
import { emptyDay } from '$lib/core/db/days';
import { todayKey, type DayKey } from '$lib/core/date/day';
import { isEmptyDay } from '$lib/core/repo/day-file';
import { appendNote } from '$lib/core/repo/note';
import { countWords } from '$lib/core/stats/writing';
import { debounce } from '$lib/core/util/debounce';
import { search } from '$lib/search/client.svelte';
import { sync } from './sync.svelte';

/** How long after the last keystroke the entry is written to IndexedDB. */
const PERSIST_MS = 400;

/**
 * The open day.
 *
 * Edits are applied to the in-memory record immediately and written to
 * IndexedDB on a short debounce — local durability is cheap, so the only reason
 * to wait at all is to avoid a write per keystroke. Pushing to git is a
 * separate, much slower rhythm handled by the sync engine (M3).
 */
class JournalStore {
	date = $state<DayKey>(todayKey());
	record = $state<DayRecord>(emptyDay(todayKey()));
	loading = $state(true);

	/** Words per written day, as last read from IndexedDB. */
	#stored = $state<Map<DayKey, number>>(new Map());

	/**
	 * The same map, with the open day counted from what is on screen.
	 *
	 * `#stored` only moves when a write reaches IndexedDB, which is a debounce
	 * behind the keyboard. Overlaying the record held in memory is what keeps
	 * today's mark on the calendar and today's line in the sidebar in step with
	 * the caret, without re-reading the whole store on every keystroke.
	 */
	written: ReadonlyMap<DayKey, number> = $derived.by(() => {
		const live = this.wordCount;
		if (live === (this.#stored.get(this.date) ?? 0)) return this.#stored;

		const merged = new Map(this.#stored);
		if (live === 0) merged.delete(this.date);
		else merged.set(this.date, live);

		return merged;
	});

	/**
	 * True between an edit and it reaching IndexedDB.
	 *
	 * Held as state rather than read from the debouncer, because a plain getter
	 * over a non-reactive object is invisible to the template — it would render
	 * once and then never update.
	 */
	unsaved = $state(false);

	get wordCount(): number {
		return countWords(this.record.body);
	}

	/** The write currently reaching IndexedDB, so `flush` can be awaited. */
	#inFlight: Promise<void> | null = null;

	#persist = debounce((date: DayKey, body: string) => {
		this.#inFlight = this.#write(date, body);
	}, PERSIST_MS);

	/**
	 * Re-read the open day from IndexedDB.
	 *
	 * Called after a sync pulls changes in, so the editor shows what just
	 * arrived instead of a stale copy. Any edit still in flight is written first,
	 * so a pull can never silently discard something half-typed.
	 */
	async reload(): Promise<void> {
		await this.flush();
		this.record = await getDay(this.date);
		await this.refreshWritten();
	}

	async open(date: DayKey): Promise<void> {
		// Never carry a pending edit across a day change — it would be written
		// under the wrong key.
		await this.flush();

		this.date = date;
		this.loading = true;
		this.record = await getDay(date);
		this.unsaved = false;
		this.loading = false;
	}

	edit(body: string): void {
		this.record = { ...this.record, body };
		this.unsaved = true;
		this.#persist(this.date, body);
	}

	/**
	 * Add a dated note to the end of a day.
	 *
	 * The only way a past day changes at all: what was written stays as written,
	 * and the note carries the date it was added. Routed through `edit` so the
	 * save, the search index and the sync counter follow exactly the same path a
	 * keystroke does — there is no second way for text to reach a day.
	 */
	async addNote(text: string, addedOn: DayKey = todayKey()): Promise<void> {
		const body = appendNote(this.record.body, text, addedOn);
		if (body === this.record.body) return;

		this.edit(body);
		await this.flush();
	}

	async setTags(tags: string[]): Promise<void> {
		await this.flush();
		this.record = await saveDay(this.date, { tags });
		await this.refreshWritten();
	}

	/**
	 * Write anything outstanding now — on navigation, or when the tab hides.
	 *
	 * Awaitable on purpose. Syncing right after a flush has to see the edit
	 * already in IndexedDB, or the sync pushes the previous text and the write
	 * lands afterwards, leaving the day dirty and queueing a pointless second
	 * commit.
	 */
	async flush(): Promise<void> {
		this.#persist.flush();
		await this.#inFlight;
	}

	/** Never written to; exists so the debounce interval is discoverable in tests. */
	static readonly persistMs = PERSIST_MS;

	/** Re-read every day's word count. A full scan, so only on boot and after a sync. */
	async refreshWritten(): Promise<void> {
		this.#stored = await listWrittenCounts();
	}

	async #write(date: DayKey, body: string): Promise<void> {
		const saved = await saveDay(date, { body });

		// Only adopt the saved record if we're still on that day; otherwise the
		// user has navigated away and this write belongs to the previous one.
		if (this.date === date) this.record = saved;

		// Another keystroke may have landed while this write was in flight.
		this.unsaved = this.#persist.pending;

		// The search index is now behind; it rebuilds on the next search rather
		// than here, so typing never pays for indexing.
		search.invalidate();

		// Tell the scheduler there is something to commit. It decides when.
		if (saved.dirty === 1) sync.edited();

		// Patch the one day that changed rather than rescanning the store; the
		// calendar and the sidebar read this, and a save is far too frequent a
		// moment to walk every entry the journal holds.
		const next = new Map(this.#stored);
		if (isEmptyDay(saved)) next.delete(date);
		else next.set(date, countWords(saved.body));
		this.#stored = next;
	}
}

export const journal = new JournalStore();
