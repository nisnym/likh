import { readTemplates, starterTemplates, type Template } from '../templates/template';
import { isLineWidth, DEFAULT_LINE_WIDTH } from '../theme/reading';
import { normalizeTheme } from '../theme/themes';
import { db } from './schema';
import { DEFAULT_SETTINGS, EMPTY_META, type Settings, type SyncMeta } from './types';

const META_KEY = 'sync-meta';
const SETTINGS_KEY = 'settings';
const TEMPLATES_KEY = 'templates';
const TOKEN_KEY = 'github-token';

/**
 * Merge a stored blob over the defaults, and repair the fields that can be
 * stale rather than merely absent.
 *
 * Spreading over the defaults means a setting added in a later release just
 * appears, with no migration against the user's only copy of their journal. But
 * two fields name things that can *stop existing* between releases — a palette
 * that was removed, a width that was renamed — and those have to be checked
 * rather than trusted, or the app paints from a palette that is not there.
 */
function hydrateSettings(stored: Partial<Settings> | undefined): Settings {
	const merged = { ...DEFAULT_SETTINGS, ...stored };

	return {
		...merged,
		theme: normalizeTheme(merged.theme),
		lineWidth: isLineWidth(merged.lineWidth) ? merged.lineWidth : DEFAULT_LINE_WIDTH
	};
}

export async function getMeta(): Promise<SyncMeta> {
	const stored = (await (await db()).get('kv', META_KEY)) as Partial<SyncMeta> | undefined;

	return { ...EMPTY_META, ...stored };
}

export async function setMeta(patch: Partial<SyncMeta>): Promise<SyncMeta> {
	const database = await db();
	const transaction = database.transaction('kv', 'readwrite');
	const store = transaction.objectStore('kv');

	const current = ((await store.get(META_KEY)) as Partial<SyncMeta> | undefined) ?? {};
	const next: SyncMeta = { ...EMPTY_META, ...current, ...patch };

	await store.put(next, META_KEY);
	await transaction.done;

	return next;
}

export async function getSettings(): Promise<Settings> {
	const stored = (await (await db()).get('kv', SETTINGS_KEY)) as Partial<Settings> | undefined;

	return hydrateSettings(stored);
}

export async function setSettings(patch: Partial<Settings>): Promise<Settings> {
	const database = await db();
	const transaction = database.transaction('kv', 'readwrite');
	const store = transaction.objectStore('kv');

	const current = ((await store.get(SETTINGS_KEY)) as Partial<Settings> | undefined) ?? {};
	const next = hydrateSettings({ ...current, ...patch });

	await store.put(next, SETTINGS_KEY);
	await transaction.done;

	return next;
}

/**
 * Entry templates.
 *
 * Local to this device, not committed to the repository. Templates are tooling
 * rather than journal, and carrying them through the sync engine would mean
 * teaching `pull` and `push` about a second kind of file with its own merge
 * rules — worth doing, but not at the cost of the day-file path that everything
 * else depends on.
 */
export async function getTemplates(): Promise<Template[]> {
	const stored = readTemplates(await (await db()).get('kv', TEMPLATES_KEY));

	// Null is "never touched" and gets the starters. An empty array is a
	// deliberate act — someone deleted them — and is left alone.
	if (stored !== null) return stored;

	const starters = starterTemplates();
	await setTemplates(starters);

	return starters;
}

export async function setTemplates(templates: Template[]): Promise<void> {
	// Structured-cloned into IndexedDB, so hand it plain objects rather than
	// whatever proxy a reactive store wrapped them in.
	await (
		await db()
	).put(
		'kv',
		templates.map(({ id, name, body }) => ({ id, name, body })),
		TEMPLATES_KEY
	);
}

/**
 * The personal access token, for self-hosted mode.
 *
 * IndexedDB rather than localStorage: not because it is meaningfully harder for
 * an attacker who already runs script on the page to read, but because it is
 * not exposed synchronously to every snippet on the origin, and it keeps the
 * token out of anything that serialises localStorage wholesale. The honest
 * summary is that this mode trades token safety for not needing a server, and
 * the UI says so.
 */
export async function getToken(): Promise<string | null> {
	return ((await (await db()).get('kv', TOKEN_KEY)) as string | undefined) ?? null;
}

export async function setToken(token: string): Promise<void> {
	await (await db()).put('kv', token, TOKEN_KEY);
}

export async function clearToken(): Promise<void> {
	await (await db()).delete('kv', TOKEN_KEY);
}
