/**
 * Trailing-edge debounce with a `flush` for the moments that can't wait — a tab
 * going to the background, or the user navigating to another day.
 */
export interface Debounced<A extends unknown[]> {
	(...args: A): void;
	/** Run any pending call immediately. */
	flush(): void;
	/** Drop any pending call. */
	cancel(): void;
	readonly pending: boolean;
}

export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): Debounced<A> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let queued: A | undefined;

	const run = () => {
		const args = queued;
		timer = undefined;
		queued = undefined;
		if (args) fn(...args);
	};

	const debounced = ((...args: A) => {
		queued = args;
		if (timer) clearTimeout(timer);
		timer = setTimeout(run, ms);
	}) as Debounced<A>;

	debounced.flush = () => {
		if (!timer) return;
		clearTimeout(timer);
		run();
	};

	debounced.cancel = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
		queued = undefined;
	};

	Object.defineProperty(debounced, 'pending', { get: () => timer !== undefined });

	return debounced;
}
