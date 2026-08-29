import { countDirtyDays, listConflictedDays } from '$lib/core/db/days';
import { getMeta } from '$lib/core/db/kv';
import type { DayKey } from '$lib/core/date/day';
import { NetworkError } from '$lib/core/github/errors';
import { retryDelayFor, sync as runSync, TruncatedTreeError } from '$lib/core/sync/engine';
import { SyncScheduler } from '$lib/core/sync/scheduler';
import { connection } from './connection.svelte';

export type SyncState =
	/** No repository connected; entries stay on this device. */
	| 'off'
	/** Connected, but there is no network right now. */
	| 'offline'
	| 'idle'
	/** Entries are written but not committed yet. */
	| 'pending'
	| 'syncing'
	/** Days are holding conflict markers and need a person. */
	| 'conflict'
	| 'error';

/**
 * Syncing, as the UI sees it.
 *
 * Nothing here decides *when* to sync — that is the scheduler's job, and it is
 * tested on its own with fake timers. This store owns the wiring: it starts and
 * stops with the connection, translates engine reports into one honest status,
 * and tells the page when entries changed underneath it.
 */
class SyncStore {
	state = $state<SyncState>('off');
	pending = $state(0);
	conflicts = $state<DayKey[]>([]);
	lastSyncAt = $state<number | null>(null);
	error = $state<string | null>(null);
	online = $state(true);

	#scheduler: SyncScheduler | null = null;
	#onPulled: (() => void) | null = null;

	/**
	 * Manual until told otherwise.
	 *
	 * Starting from the permissive value would let a poll or a catch-up fire in
	 * the gap before settings load from IndexedDB — a sync the user never asked
	 * for, which is the whole thing the setting exists to prevent.
	 */
	#auto = false;

	/** Whether syncing runs on its own, or only when the button is pressed. */
	get auto(): boolean {
		return this.#auto;
	}

	setAuto(auto: boolean): void {
		this.#auto = auto;
		this.#scheduler?.setAuto(auto);
		this.#refreshState();
	}

	/** Called after a sync brought in changes, so the open day can be reloaded. */
	onPulled(listener: () => void): void {
		this.#onPulled = listener;
	}

	async start(): Promise<void> {
		if (this.#scheduler) return;
		if (!connection.ready) return;

		this.#scheduler = new SyncScheduler(() => this.#run(), { retryDelayFor, auto: this.#auto });
		this.#scheduler.onChange(() => this.#refreshState());
		this.#scheduler.start();

		const meta = await getMeta();
		this.lastSyncAt = meta.lastSyncAt;
		await this.#refreshCounts();

		// Catch up with whatever happened while this device was away. A no-op in
		// manual mode — arriving is not asking.
		this.#scheduler.requestNow();
	}

	stop(): void {
		this.#scheduler?.stop();
		this.#scheduler = null;
		this.state = 'off';
	}

	/** An entry changed. */
	edited(): void {
		this.#scheduler?.edited();
		// Counted from the database rather than incremented: `pending` is the
		// number of *days* waiting to be committed, and a day edited twenty times
		// is still one day.
		void this.#refreshCounts().then(() => this.#refreshState());
	}

	/** The tab is going away, or the network came back. */
	requestNow(): void {
		this.#scheduler?.requestNow();
	}

	/** The user asked, explicitly. Bypasses the rate-limit floor and the mode. */
	async syncNow(): Promise<void> {
		if (!this.#scheduler) return;
		await this.#scheduler.flush();
	}

	/**
	 * A repository was just adopted. Pull it down once, in either mode.
	 *
	 * Connecting *is* an explicit request — and without this a new device would
	 * open on an empty journal whose entries are sitting in the repo, which
	 * reads as data loss however carefully the button is labelled.
	 */
	async adopt(): Promise<void> {
		await this.start();
		await this.syncNow();
	}

	setOnline(online: boolean): void {
		this.online = online;
		this.#refreshState();
		if (online) this.requestNow();
	}

	async #run(): Promise<void> {
		if (!connection.ready || !connection.repo) return;

		const client = connection.client();
		if (!client) return;

		try {
			const report = await runSync({ client, repo: connection.repo });

			this.error = null;
			this.lastSyncAt = Date.now();
			this.conflicts = report.conflicts;

			if (report.pulled > 0 || report.merged > 0) this.#onPulled?.();
		} catch (caught) {
			this.error = describe(caught, this.#auto);
			// A dropped connection is not a failure worth shouting about; it is
			// the normal condition of a phone on a train.
			if (caught instanceof NetworkError) this.online = false;
			throw caught;
		} finally {
			await this.#refreshCounts();
			this.#refreshState();
		}
	}

	/**
	 * Reading the counts is async, so two refreshes can land out of order — the
	 * one started before a push finishing after it, and reporting the work as
	 * still outstanding. The token discards any result that has been superseded.
	 */
	#countsToken = 0;

	async #refreshCounts(): Promise<void> {
		const token = ++this.#countsToken;
		const [pending, conflicted] = await Promise.all([countDirtyDays(), listConflictedDays()]);

		if (token !== this.#countsToken) return;

		this.pending = pending;
		this.conflicts = conflicted.map((day) => day.date);
	}

	#refreshState(): void {
		if (!this.#scheduler || !connection.ready) {
			this.state = 'off';
			return;
		}

		const scheduler = this.#scheduler.state;

		if (scheduler === 'running') this.state = 'syncing';
		else if (!this.online) this.state = 'offline';
		else if (this.conflicts.length > 0) this.state = 'conflict';
		else if (this.error !== null) this.state = 'error';
		else if (scheduler === 'waiting' || scheduler === 'backoff' || this.pending > 0)
			this.state = 'pending';
		else this.state = 'idle';
	}
}

function describe(error: unknown, auto: boolean): string {
	if (error instanceof NetworkError) {
		return auto
			? 'Offline — changes are saved here and will sync later.'
			: 'Offline — changes are saved here. Sync when you are back.';
	}
	if (error instanceof TruncatedTreeError) return error.message;
	if (error instanceof Error) return error.message;

	return 'Sync failed.';
}

export const sync = new SyncStore();
