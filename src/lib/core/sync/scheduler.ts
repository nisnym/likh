/**
 * When to sync.
 *
 * GitHub's secondary rate limit is 80 content-generating requests per minute
 * and 500 per hour. A push costs three of those — create tree, create commit,
 * move ref — so the hourly limit caps us at ~166 pushes an hour, and that is
 * the binding constraint. The per-minute limit never bites at these rates.
 *
 * Hence a 30-second floor: 3600 / 30 = 120 pushes an hour, 360 requests, with
 * room left for the occasional blob upload. A 20-second floor would allow 180
 * pushes — 540 requests — and would exceed the limit during a long writing
 * session. Reads (pull's GETs) are not content-generating and do not count.
 *
 * Coalescing is what makes this comfortable rather than restrictive: syncing
 * per keystroke would blow the budget in a minute, and fill the repo's history
 * with noise besides.
 *
 * So: wait for a pause in the writing, never run two syncs at once, never start
 * one sooner than the floor allows, and fold everything outstanding into the
 * next run.
 *
 * Deadlines are absolute rather than relative. A relative delay cannot express
 * "push this later because they're still typing" and "pull this earlier because
 * they asked" in the same comparison, and conflating the two makes a long burst
 * of typing sync on a fixed cadence instead of waiting for the pause.
 *
 * All of that is the *automatic* half, and it is optional. With `auto: false`
 * — the app's default — nothing above ever fires: no debounce, no poll, no
 * retry, no catching up when the network returns. Only `flush()` runs a sync,
 * and `flush()` has exactly one caller, the sync button. The rest of the class
 * still earns its keep in that mode: one sync at a time, never two.
 */

export type SchedulerState = 'stopped' | 'idle' | 'waiting' | 'running' | 'backoff';

/**
 * `debounce` moves the deadline later as writing continues; `asap` only ever
 * moves it earlier. An explicit request is never postponed by further typing.
 */
type Urgency = 'debounce' | 'asap';

export interface SchedulerOptions {
	/** Quiet period after the last edit before a sync is worth doing. */
	idleMs?: number;
	/** Hard floor between the end of one sync and the start of the next. */
	minIntervalMs?: number;
	/** Background poll while the app is visible, to notice other devices. */
	pollMs?: number;
	/** First backoff step after a failure; doubles from here. */
	backoffMs?: number;
	maxBackoffMs?: number;
	/**
	 * Read a server-supplied delay out of a failure (a `Retry-After`, or a
	 * rate-limit reset). Returning null falls back to exponential backoff.
	 */
	retryDelayFor?: (error: unknown) => number | null;
	/**
	 * Whether anything may schedule itself. False leaves `flush()` — an explicit
	 * press of the sync button — as the only way a sync ever starts.
	 */
	auto?: boolean;
}

const DEFAULTS = {
	auto: true,
	idleMs: 30_000,
	minIntervalMs: 30_000,
	pollMs: 300_000,
	backoffMs: 5_000,
	maxBackoffMs: 300_000
};

export class SyncScheduler {
	state: SchedulerState = 'stopped';

	readonly #run: () => Promise<void>;
	readonly #options: Required<Omit<SchedulerOptions, 'retryDelayFor'>>;
	readonly #retryDelayFor: (error: unknown) => number | null;

	/**
	 * Lifecycle, tracked separately from `state`. `state` says what the scheduler
	 * is doing right now; this says whether it should be doing anything at all —
	 * and stays correct while a run is in flight.
	 */
	#stopped = true;

	#timer: ReturnType<typeof setTimeout> | null = null;
	#poll: ReturnType<typeof setInterval> | null = null;

	/** Absolute time the pending run is due, and why. */
	#dueAt = Infinity;
	#urgency: Urgency = 'debounce';

	/** The run currently in flight, so an explicit press can queue behind it. */
	#inFlight: Promise<void> | null = null;

	#lastFinishedAt = 0;
	#backoff = 0;
	/** A request arrived while a sync was in flight; run again when it lands. */
	#again = false;
	#onChange: (() => void) | null = null;

	constructor(run: () => Promise<void>, options: SchedulerOptions = {}) {
		this.#run = run;
		this.#options = { ...DEFAULTS, ...stripUndefined(options) };
		this.#retryDelayFor = options.retryDelayFor ?? (() => null);
	}

	/** Called whenever `state` changes, so a UI can follow along. */
	onChange(listener: () => void): void {
		this.#onChange = listener;
	}

	start(): void {
		if (!this.#stopped) return;

		this.#stopped = false;
		this.#set('idle');
		this.#startPolling();
	}

	/**
	 * Turn automatic syncing on or off while running, because it is a setting the
	 * user can change mid-session. Switching to manual drops anything already
	 * scheduled: the point of the setting is that nothing runs unasked, and a
	 * debounce armed a moment ago is exactly that.
	 */
	setAuto(auto: boolean): void {
		if (this.#options.auto === auto) return;

		this.#options.auto = auto;

		if (auto) {
			this.#startPolling();
			return;
		}

		this.#stopPolling();
		this.#again = false;
		this.#backoff = 0;
		this.#clearTimer();
		if (this.state === 'waiting' || this.state === 'backoff') this.#set('idle');
	}

	#startPolling(): void {
		if (!this.#options.auto || this.#stopped || this.#poll !== null) return;

		this.#poll = setInterval(() => this.requestNow(), this.#options.pollMs);
	}

	#stopPolling(): void {
		if (this.#poll !== null) clearInterval(this.#poll);
		this.#poll = null;
	}

	stop(): void {
		this.#stopped = true;
		this.#clearTimer();
		this.#stopPolling();
		this.#again = false;
		this.#set('stopped');
	}

	/** An entry changed. In auto mode, sync once the writing pauses. */
	edited(): void {
		this.#scheduleAt(Date.now() + this.#options.idleMs, 'debounce');
	}

	/** In auto mode, sync as soon as the floor allows — going online, tab hiding. */
	requestNow(): void {
		this.#scheduleAt(Date.now(), 'asap');
	}

	/**
	 * Run now, ignoring the floor and the mode. Only for an explicit user action —
	 * in manual mode this is the only entry point that does anything at all.
	 *
	 * A press that arrives mid-sync queues behind it rather than being dropped:
	 * the run already in flight started before the edit that prompted the press
	 * and does not carry it, so returning here would leave the writer looking at
	 * unsynced work having done exactly what the app asked them to do.
	 */
	async flush(): Promise<void> {
		this.#clearTimer();

		while (this.#inFlight) await this.#inFlight;
		if (this.#stopped) return;

		await this.#execute();
	}

	#scheduleAt(preferredAt: number, urgency: Urgency): void {
		if (this.#stopped) return;
		// The single gate for manual mode. `edited`, `requestNow`, the poll, the
		// backoff retry and the fold-in after a busy run all arrive here, so one
		// check covers every way a sync could start without being asked for.
		if (!this.#options.auto) return;

		if (this.state === 'running') {
			// Fold into the run already in flight rather than queueing another.
			this.#again = true;
			return;
		}

		const now = Date.now();
		const dueAt = Math.max(
			preferredAt,
			this.#lastFinishedAt + this.#options.minIntervalMs,
			now + this.#backoff
		);

		if (this.#timer !== null) {
			// Continued typing must not postpone a sync the user explicitly asked
			// for, and must not pull one forward either.
			if (this.#urgency === 'asap' && urgency === 'debounce') return;
			if (urgency === 'asap' && dueAt >= this.#dueAt) return;
		}

		this.#clearTimer();
		this.#dueAt = dueAt;
		this.#urgency = urgency;
		this.#timer = setTimeout(() => void this.#execute(), Math.max(0, dueAt - now));
		this.#set(this.#backoff > 0 ? 'backoff' : 'waiting');
	}

	async #execute(): Promise<void> {
		this.#clearTimer();
		if (this.#stopped || this.state === 'running') return;

		const done = this.#runOnce();
		this.#inFlight = done;

		try {
			await done;
		} finally {
			if (this.#inFlight === done) this.#inFlight = null;
		}
	}

	async #runOnce(): Promise<void> {
		this.#set('running');
		this.#again = false;

		try {
			await this.#run();
			this.#backoff = 0;
		} catch (error) {
			const hinted = this.#retryDelayFor(error);
			this.#backoff =
				hinted ??
				Math.min(
					this.#options.maxBackoffMs,
					this.#backoff === 0 ? this.#options.backoffMs : this.#backoff * 2
				);
		} finally {
			this.#lastFinishedAt = Date.now();
			// `stop()` may have been called while the run was in flight.
			this.#set(this.#stopped ? 'stopped' : 'idle');
		}

		if (this.#backoff > 0) this.#scheduleAt(Date.now() + this.#backoff, 'asap');
		else if (this.#again) this.#scheduleAt(Date.now(), 'asap');
	}

	#clearTimer(): void {
		if (this.#timer !== null) clearTimeout(this.#timer);
		this.#timer = null;
		this.#dueAt = Infinity;
	}

	#set(state: SchedulerState): void {
		if (this.state === state) return;
		this.state = state;
		this.#onChange?.();
	}
}

function stripUndefined<T extends object>(input: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(input).filter(([, value]) => value !== undefined)
	) as Partial<T>;
}
