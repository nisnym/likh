/**
 * The theme catalogue.
 *
 * The palettes themselves live in `src/lib/styles/tokens.css`, one block per
 * id. This file is the index over them: what to call each one, whether it is
 * light or dark, and roughly what colour the browser should tint its own chrome
 * with. `themes.test.ts` asserts the two files agree, so adding a palette to
 * only one of them fails the build rather than shipping a theme that silently
 * falls back to Paper.
 */

export type ThemeId = 'paper' | 'sepia' | 'daylight' | 'ink' | 'midnight' | 'ember';

/** What the user picked. `system` follows the OS and resolves to one of the above. */
export type ThemeChoice = ThemeId | 'system';

export interface Theme {
	id: ThemeId;
	label: string;
	/** Which half of the `system` pair this is, and what `color-scheme` it sets. */
	scheme: 'light' | 'dark';
	/** One line for the settings sheet. */
	note: string;
	/**
	 * sRGB approximation of `--bg`, for `<meta name="theme-color">`.
	 *
	 * Duplicating the background as a hex is not ideal, but the meta tag is read
	 * by the browser before any stylesheet applies and does not accept a custom
	 * property. Converted from the oklch value, not eyeballed.
	 */
	chrome: string;
}

export const THEMES: readonly Theme[] = [
	{
		id: 'paper',
		label: 'Paper',
		scheme: 'light',
		note: 'Warm off-white and terracotta.',
		chrome: '#fdfbf7'
	},
	{
		id: 'sepia',
		label: 'Sepia',
		scheme: 'light',
		note: 'Aged paper, brown ink. Gentler for long sittings.',
		chrome: '#f8efe0'
	},
	{
		id: 'daylight',
		label: 'Daylight',
		scheme: 'light',
		note: 'Cool and high-contrast, for a bright room.',
		chrome: '#fbfcfe'
	},
	{
		id: 'ink',
		label: 'Ink',
		scheme: 'dark',
		note: 'The warm dark.',
		chrome: '#13100d'
	},
	{
		id: 'midnight',
		label: 'Midnight',
		scheme: 'dark',
		note: 'The cool dark.',
		chrome: '#0f131b'
	},
	{
		id: 'ember',
		label: 'Ember',
		scheme: 'dark',
		note: 'Dim and warm, for writing with the lights off.',
		chrome: '#0e0a08'
	}
] as const;

/** Which concrete theme `system` means in each direction. */
export const SYSTEM_PAIR = { light: 'paper', dark: 'ink' } as const;

export const DEFAULT_THEME: ThemeChoice = 'paper';

export function isThemeId(value: string): value is ThemeId {
	return THEMES.some((theme) => theme.id === value);
}

export function themeById(id: ThemeId): Theme {
	const found = THEMES.find((theme) => theme.id === id);
	if (!found) throw new RangeError(`Unknown theme: ${id}`);

	return found;
}

/**
 * The concrete theme to paint, given the choice and what the OS says.
 *
 * Resolving `system` here rather than in a `prefers-color-scheme` block is what
 * lets every palette exist exactly once in CSS.
 */
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): ThemeId {
	if (choice === 'system') return SYSTEM_PAIR[prefersDark ? 'dark' : 'light'];

	return choice;
}

/**
 * Bring a stored value forward.
 *
 * The first two releases stored `light` and `dark`; those are now the ids of
 * the palettes they always meant. Anything unrecognised — a theme removed in a
 * later version, a hand-edited database — falls back to the default rather than
 * leaving the app painting from a palette that no longer exists.
 */
export function normalizeTheme(value: unknown): ThemeChoice {
	if (value === 'light') return 'paper';
	if (value === 'dark') return 'ink';
	if (value === 'system') return 'system';
	if (typeof value === 'string' && isThemeId(value)) return value;

	return DEFAULT_THEME;
}
