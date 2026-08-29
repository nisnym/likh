import { getSettings, setSettings } from '$lib/core/db/kv';
import { DEFAULT_SETTINGS, type Settings } from '$lib/core/db/types';
import { LINE_WIDTHS } from '$lib/core/theme/reading';
import { resolveTheme, themeById } from '$lib/core/theme/themes';

/**
 * User settings, mirrored from IndexedDB into runes.
 *
 * Reads start from the defaults, so nothing waits on the database to render.
 * Appearance is the exception and waits for `loaded`: painting the defaults and
 * correcting them a frame later is a visible flash rather than a fast start.
 * Every write goes to IndexedDB immediately — there is no "save settings"
 * button to forget to press.
 */
class SettingsStore {
	current = $state<Settings>({ ...DEFAULT_SETTINGS });
	loaded = $state(false);

	async load(): Promise<void> {
		try {
			this.current = await getSettings();
		} finally {
			// The appearance effects wait on this, so it has to be set even when the
			// read failed: the defaults are a worse journal than the stored values,
			// but an unpainted page is not a journal at all.
			this.loaded = true;
		}
	}

	async update(patch: Partial<Settings>): Promise<void> {
		this.current = { ...this.current, ...patch };
		this.current = await setSettings(patch);
	}
}

export const settings = new SettingsStore();

/**
 * What the next cold start needs before it can paint.
 *
 * Settings live in IndexedDB, which cannot be read before the first paint, so
 * without this a dark-theme reader gets a white flash on every launch and
 * anyone who widened the column watches it jump. The mirror holds resolved
 * values — `19px`, `52rem` — so the inline script in `app.html` can set them
 * verbatim and needs no copy of the lookup tables. Losing it (a private window,
 * cleared storage) costs one flash, never a setting.
 */
const PAINT_HINT = 'likh-paint';

function prefersDark(): boolean {
	return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Paint everything the reader chose about how the app looks.
 *
 * `system` is resolved to a concrete palette here rather than by a
 * `prefers-color-scheme` block in the stylesheet, which is what lets each
 * palette be written exactly once. The metrics ride along because they are
 * paint-critical for the same reason the colour is: both are wrong for a frame
 * otherwise, and both are wrong in a way you can see.
 */
export function applyAppearance(current: Settings): void {
	if (typeof document === 'undefined') return;

	const theme = themeById(resolveTheme(current.theme, prefersDark()));
	const size = `${current.fontSize}px`;
	const measure = LINE_WIDTHS[current.lineWidth];

	const root = document.documentElement;
	root.dataset.theme = theme.id;
	root.style.setProperty('--editor-size', size);
	root.style.setProperty('--measure', measure);

	// The browser paints its own chrome — the address bar, the status bar of an
	// installed PWA — from this, and reads it before any stylesheet applies.
	let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	if (!meta) {
		meta = document.createElement('meta');
		meta.name = 'theme-color';
		document.head.append(meta);
	}
	meta.content = theme.chrome;

	try {
		// The *choice*, not the resolved theme: `system` has to stay dynamic across
		// launches, or following the OS would freeze at whatever it said last time.
		localStorage.setItem(PAINT_HINT, JSON.stringify({ theme: current.theme, size, measure }));
	} catch {
		// Storage denied. Everything still applies; only the next launch flashes.
	}
}

/** Repaint when the OS flips, which only matters while the choice is `system`. */
export function watchSystemTheme(repaint: () => void): () => void {
	if (typeof window === 'undefined' || !window.matchMedia) return () => {};

	const query = window.matchMedia('(prefers-color-scheme: dark)');
	query.addEventListener('change', repaint);

	return () => query.removeEventListener('change', repaint);
}
