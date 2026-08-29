import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from './debounce';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('debounce', () => {
	it('runs once, with the last arguments', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced('a');
		debounced('b');
		debounced('c');
		vi.advanceTimersByTime(100);

		expect(fn).toHaveBeenCalledExactlyOnceWith('c');
	});

	it('reports whether a call is pending', () => {
		const debounced = debounce(() => {}, 100);

		expect(debounced.pending).toBe(false);
		debounced();
		expect(debounced.pending).toBe(true);
		vi.advanceTimersByTime(100);
		expect(debounced.pending).toBe(false);
	});

	it('flushes immediately', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 10_000);

		debounced('now');
		debounced.flush();

		expect(fn).toHaveBeenCalledExactlyOnceWith('now');
		expect(debounced.pending).toBe(false);
	});

	it('does nothing when flushed with no pending call', () => {
		const fn = vi.fn();

		debounce(fn, 100).flush();

		expect(fn).not.toHaveBeenCalled();
	});

	it('cancels a pending call', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);

		debounced();
		debounced.cancel();
		vi.advanceTimersByTime(1000);

		expect(fn).not.toHaveBeenCalled();
	});
});
