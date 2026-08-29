import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncScheduler } from './scheduler';

const OPTIONS = { idleMs: 30_000, minIntervalMs: 30_000, pollMs: 300_000 };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Let queued promise callbacks run without advancing the clock. */
async function settle() {
	await vi.advanceTimersByTimeAsync(0);
}

describe('debouncing', () => {
	it('waits for a pause in the writing', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.edited();
		await vi.advanceTimersByTimeAsync(29_000);
		expect(run).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(1_500);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('coalesces a burst of edits into one sync', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		// Someone typing for two minutes without a 30s pause.
		for (let i = 0; i < 24; i++) {
			scheduler.edited();
			await vi.advanceTimersByTimeAsync(5_000);
		}
		expect(run).not.toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(30_000);
		expect(run).toHaveBeenCalledTimes(1);
	});
});

describe('the minimum interval', () => {
	it('holds a second sync back to the floor', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.requestNow();
		await settle();
		expect(run).toHaveBeenCalledTimes(1);

		scheduler.requestNow();
		await vi.advanceTimersByTimeAsync(29_000);
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(2_000);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it("keeps a full hour of syncing inside GitHub's write budget", async () => {
		// The constraint that actually binds: 500 content-generating requests an
		// hour, and a push spends three of them. Asserted against the real budget
		// rather than a magic number, so changing the floor without redoing this
		// arithmetic fails here.
		const REQUESTS_PER_PUSH = 3;
		const HOURLY_BUDGET = 500;

		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		// An hour of someone asking to sync as often as they possibly could.
		for (let i = 0; i < 600; i++) {
			scheduler.requestNow();
			await vi.advanceTimersByTimeAsync(6_000);
		}

		expect(run.mock.calls.length * REQUESTS_PER_PUSH).toBeLessThanOrEqual(HOURLY_BUDGET);
	});
});

describe('single flight', () => {
	it('never runs two syncs at once, and folds requests into the one in flight', async () => {
		let active = 0;
		let overlapped = false;
		const run = vi.fn(async () => {
			active++;
			if (active > 1) overlapped = true;
			await new Promise((resolve) => setTimeout(resolve, 5_000));
			active--;
		});

		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.requestNow();
		await settle();
		expect(run).toHaveBeenCalledTimes(1);

		// Three more requests arrive mid-flight.
		scheduler.requestNow();
		scheduler.edited();
		scheduler.requestNow();
		await vi.advanceTimersByTimeAsync(5_000);

		expect(overlapped).toBe(false);
		expect(run).toHaveBeenCalledTimes(1);

		// They become exactly one follow-up run, after the floor.
		await vi.advanceTimersByTimeAsync(35_000);
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe('failure handling', () => {
	it('backs off exponentially and recovers', async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error('boom'))
			.mockRejectedValueOnce(new Error('boom'))
			.mockResolvedValue(undefined);

		const scheduler = new SyncScheduler(run, { ...OPTIONS, backoffMs: 5_000 });
		scheduler.start();

		scheduler.requestNow();
		await settle();
		expect(run).toHaveBeenCalledTimes(1);
		expect(scheduler.state).toBe('backoff');

		await vi.advanceTimersByTimeAsync(31_000);
		expect(run).toHaveBeenCalledTimes(2);

		// Doubled, and still floored by the minimum interval.
		await vi.advanceTimersByTimeAsync(31_000);
		expect(run).toHaveBeenCalledTimes(3);

		// A success clears the backoff.
		await settle();
		expect(scheduler.state).toBe('idle');
	});

	it('honours a delay the server asked for', async () => {
		const run = vi
			.fn()
			.mockRejectedValueOnce(new Error('rate limited'))
			.mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, {
			...OPTIONS,
			retryDelayFor: () => 120_000
		});
		scheduler.start();

		scheduler.requestNow();
		await settle();

		// Well past the ordinary backoff, but short of what the server asked.
		await vi.advanceTimersByTimeAsync(60_000);
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(61_000);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('caps the backoff', async () => {
		const run = vi.fn().mockRejectedValue(new Error('always fails'));
		const scheduler = new SyncScheduler(run, {
			...OPTIONS,
			backoffMs: 5_000,
			maxBackoffMs: 60_000
		});
		scheduler.start();

		scheduler.requestNow();
		await vi.advanceTimersByTimeAsync(600_000);

		// With a 60s cap, ten minutes allows roughly ten attempts, not hundreds.
		expect(run.mock.calls.length).toBeLessThan(15);
		expect(run.mock.calls.length).toBeGreaterThan(5);
	});
});

describe('polling', () => {
	it('checks for other devices while running', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, { ...OPTIONS, pollMs: 300_000 });
		scheduler.start();

		await vi.advanceTimersByTimeAsync(310_000);
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(300_000);
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe('manual mode', () => {
	const MANUAL = { ...OPTIONS, auto: false };

	it('never syncs on its own', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, MANUAL);
		scheduler.start();

		// Everything that would trigger a sync in auto mode: writing, the tab
		// going away, the network coming back, and the background poll.
		scheduler.edited();
		scheduler.requestNow();
		await vi.advanceTimersByTimeAsync(3_600_000);
		scheduler.edited();
		await vi.advanceTimersByTimeAsync(3_600_000);

		expect(run).not.toHaveBeenCalled();
		expect(scheduler.state).toBe('idle');
	});

	it('syncs when the button is pressed', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, MANUAL);
		scheduler.start();

		await scheduler.flush();
		expect(run).toHaveBeenCalledTimes(1);

		// And again straight away: the floor exists to protect the rate limit
		// from automation, not to argue with the person pressing the button.
		await scheduler.flush();
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('does not retry a failure behind your back', async () => {
		const run = vi.fn().mockRejectedValue(new Error('boom'));
		const scheduler = new SyncScheduler(run, { ...MANUAL, backoffMs: 5_000 });
		scheduler.start();

		await scheduler.flush();
		expect(run).toHaveBeenCalledTimes(1);

		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('queues a press that lands mid-sync instead of dropping it', async () => {
		let active = 0;
		let overlapped = false;
		const run = vi.fn(async () => {
			active++;
			if (active > 1) overlapped = true;
			await new Promise((resolve) => setTimeout(resolve, 5_000));
			active--;
		});

		const scheduler = new SyncScheduler(run, MANUAL);
		scheduler.start();

		// The second press is someone who wrote a line while the first sync was
		// still going: that line is not in the run already in flight, so the
		// press has to survive.
		void scheduler.flush();
		await settle();
		void scheduler.flush();

		await vi.advanceTimersByTimeAsync(11_000);

		expect(overlapped).toBe(false);
		expect(run).toHaveBeenCalledTimes(2);
	});

	it('drops a scheduled sync when switched on mid-wait', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.edited();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(scheduler.state).toBe('waiting');

		// Turning the setting off has to cancel what is already armed, or the
		// next sync would be one the user just said they did not want.
		scheduler.setAuto(false);
		expect(scheduler.state).toBe('idle');

		await vi.advanceTimersByTimeAsync(3_600_000);
		expect(run).not.toHaveBeenCalled();
	});

	it('resumes automatic syncing when switched back on', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, MANUAL);
		scheduler.start();

		await vi.advanceTimersByTimeAsync(600_000);
		expect(run).not.toHaveBeenCalled();

		scheduler.setAuto(true);
		scheduler.edited();
		await vi.advanceTimersByTimeAsync(31_000);
		expect(run).toHaveBeenCalledTimes(1);

		// Including the poll, which had to be started rather than merely unpaused.
		await vi.advanceTimersByTimeAsync(310_000);
		expect(run).toHaveBeenCalledTimes(2);
	});
});

describe('lifecycle', () => {
	it('does nothing before start', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);

		scheduler.edited();
		scheduler.requestNow();
		await vi.advanceTimersByTimeAsync(600_000);

		expect(run).not.toHaveBeenCalled();
		expect(scheduler.state).toBe('stopped');
	});

	it('stops cleanly, including mid-flight', async () => {
		const run = vi.fn(async () => {
			await new Promise((resolve) => setTimeout(resolve, 5_000));
		});
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.requestNow();
		await settle();
		scheduler.stop();

		await vi.advanceTimersByTimeAsync(600_000);

		expect(run).toHaveBeenCalledTimes(1);
		expect(scheduler.state).toBe('stopped');
	});

	it('flushes immediately when the user asks', async () => {
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.start();

		scheduler.requestNow();
		await settle();

		// The floor would normally hold this back for 30s.
		await scheduler.flush();

		expect(run).toHaveBeenCalledTimes(2);
	});

	it('reports state changes', async () => {
		const seen: string[] = [];
		const run = vi.fn().mockResolvedValue(undefined);
		const scheduler = new SyncScheduler(run, OPTIONS);
		scheduler.onChange(() => seen.push(scheduler.state));

		scheduler.start();
		scheduler.edited();
		await vi.advanceTimersByTimeAsync(31_000);

		expect(seen).toEqual(['idle', 'waiting', 'running', 'idle']);
	});
});
