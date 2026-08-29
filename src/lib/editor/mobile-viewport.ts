/**
 * Keyboard-aware viewport.
 *
 * On iOS Safari the software keyboard does not shrink the layout viewport — not
 * even `100dvh` — so a full-height writing surface ends up with its last lines
 * underneath the keyboard. The visual viewport *does* shrink, so we publish the
 * difference as `--keyboard-inset` and let the layout reserve that space.
 *
 * Returns a teardown function; a no-op where `visualViewport` is unavailable.
 */
export function trackKeyboardInset(): () => void {
	if (typeof window === 'undefined' || !window.visualViewport) return () => {};

	const viewport = window.visualViewport;
	const root = document.documentElement;
	let frame = 0;

	const apply = () => {
		frame = 0;
		// How much of the layout viewport the keyboard (and any browser chrome
		// overlay) is currently covering at the bottom.
		const covered = window.innerHeight - viewport.height - viewport.offsetTop;
		const inset = Math.max(0, Math.round(covered));

		root.style.setProperty('--keyboard-inset', `${inset}px`);
		root.classList.toggle('likh-keyboard-open', inset > 120);
	};

	const schedule = () => {
		// Resize fires continuously while the keyboard animates in.
		if (frame === 0) frame = requestAnimationFrame(apply);
	};

	viewport.addEventListener('resize', schedule);
	viewport.addEventListener('scroll', schedule);
	apply();

	return () => {
		if (frame) cancelAnimationFrame(frame);
		viewport.removeEventListener('resize', schedule);
		viewport.removeEventListener('scroll', schedule);
		root.style.removeProperty('--keyboard-inset');
		root.classList.remove('likh-keyboard-open');
	};
}
