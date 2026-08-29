import { describe, expect, it } from 'vitest';
// `?raw` rather than `node:fs`: the stylesheet is the artefact under test, and
// importing it means the test moves with the file instead of holding a path to
// it that a rename would quietly break.
import appHtml from '../../../app.html?raw';
import tokensCss from '../../styles/tokens.css?raw';
import { DEFAULT_THEME, SYSTEM_PAIR, THEMES, normalizeTheme, resolveTheme } from './themes';

// Comments go first: prose in this file contains colons, and a naive declaration
// scan would read one as a property and swallow the rest of the block with it.
const tokens = tokensCss.replace(/\/\*[\s\S]*?\*\//g, '');

/** Every declaration inside the `:root…{ }` block whose selector matches. */
function paletteFor(selector: string): Map<string, string> {
	const block = new RegExp(`(^|\\})[^{}]*${selector}[^{}]*\\{([^}]*)\\}`, 'm').exec(tokens);
	if (!block) return new Map();

	const declarations = block[2].matchAll(/([\w-]+)\s*:\s*([^;]+);/g);
	return new Map([...declarations].map(([, name, value]) => [name, value.trim()]));
}

describe('the catalogue and the stylesheet', () => {
	it('describe the same set of themes', () => {
		const inCss = [...tokens.matchAll(/\[data-theme='([\w-]+)'\]/g)].map((match) => match[1]);

		expect(new Set(inCss)).toEqual(new Set(THEMES.map((theme) => theme.id)));
	});

	it('give every theme every colour Paper defines', () => {
		// Paper is the base: a palette that forgets a token inherits Paper's, which
		// on a dark theme means one stray light-grey rule nobody notices until a
		// screenshot. Comparing the key sets is what catches that at build time.
		const paper = [...paletteFor(':root,').keys()].filter(
			(name) => name.startsWith('--') && !name.startsWith('--font')
		);

		for (const theme of THEMES) {
			if (theme.id === 'paper') continue;

			const palette = paletteFor(`\\[data-theme='${theme.id}'\\]`);
			expect({ theme: theme.id, missing: paper.filter((name) => !palette.has(name)) }).toEqual({
				theme: theme.id,
				missing: []
			});
		}
	});

	it('agree on which themes are light and which are dark', () => {
		for (const theme of THEMES) {
			const palette = paletteFor(
				theme.id === 'paper' ? ':root,' : `\\[data-theme='${theme.id}'\\]`
			);

			expect(`${theme.id}: ${palette.get('color-scheme')}`).toBe(`${theme.id}: ${theme.scheme}`);
		}
	});

	it('offer both a light and a dark option', () => {
		expect(THEMES.some((theme) => theme.scheme === 'light')).toBe(true);
		expect(THEMES.some((theme) => theme.scheme === 'dark')).toBe(true);
	});
});

describe('the pre-paint script', () => {
	// `app.html` cannot import anything — it runs before the bundle — so it
	// repeats the light/dark pair as literals. This is the only thing standing
	// between that copy and a flash of the wrong theme on every cold start.
	it('reads the same storage key the app writes', () => {
		expect(appHtml).toContain("localStorage.getItem('likh-paint')");
	});

	it('falls back to the same pair as `SYSTEM_PAIR`', () => {
		expect(appHtml).toContain(`'${SYSTEM_PAIR.dark}'`);
		expect(appHtml).toContain(`'${SYSTEM_PAIR.light}'`);
	});
});

describe('resolving', () => {
	it('follows the system only when asked to', () => {
		expect(resolveTheme('system', false)).toBe(SYSTEM_PAIR.light);
		expect(resolveTheme('system', true)).toBe(SYSTEM_PAIR.dark);
		expect(resolveTheme('sepia', true)).toBe('sepia');
	});

	it('defaults to a light theme', () => {
		const resolved = resolveTheme(DEFAULT_THEME, true);

		expect(THEMES.find((theme) => theme.id === resolved)?.scheme).toBe('light');
	});
});

describe('stored values', () => {
	it('carry the old light/dark choice into the named palettes', () => {
		expect(normalizeTheme('light')).toBe('paper');
		expect(normalizeTheme('dark')).toBe('ink');
	});

	it('keep a valid choice as it is', () => {
		expect(normalizeTheme('system')).toBe('system');
		expect(normalizeTheme('ember')).toBe('ember');
	});

	it('fall back rather than paint from a palette that no longer exists', () => {
		expect(normalizeTheme('solarized')).toBe(DEFAULT_THEME);
		expect(normalizeTheme(undefined)).toBe(DEFAULT_THEME);
		expect(normalizeTheme(7)).toBe(DEFAULT_THEME);
	});
});
