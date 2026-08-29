/**
 * Entry templates — the scaffolding someone wants in front of them every time
 * they sit down to write.
 *
 * A template is plain markdown with a few `{{…}}` placeholders. It is never
 * written to a day on its own: inserting is always something the writer did, so
 * a day that was never opened stays absent from the repository rather than
 * accumulating an empty scaffold and a commit to go with it.
 *
 * Placeholders that reach the file are formatted with the locale-independent
 * date helpers, for the same reason note headings are: two devices in different
 * locales must produce the same bytes.
 */

import { formatFixed, weekdayFixed, type DayKey } from '../date/day';

export interface Template {
	/** Stable across renames, so a setting can point at one. */
	id: string;
	name: string;
	body: string;
}

/** Where the caret should land after inserting. */
export const CURSOR = '{{cursor}}';

export interface FillContext {
	/** The day being written, which is what `{{date}}` and `{{weekday}}` mean. */
	day: DayKey;
	/** For `{{time}}`, read in the writer's local clock. */
	now?: Date;
}

function clockTime(now: Date): string {
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

/**
 * Substitute the placeholders, and say where the caret goes.
 *
 * `cursor` is the offset of the first `{{cursor}}` within the returned text, or
 * the end of it when the template does not say. Unknown placeholders are left
 * exactly as written — a template that mentions `{{weight}}` is asking for that
 * text, not for a silent deletion.
 */
export function fillTemplate(body: string, context: FillContext): { text: string; cursor: number } {
	const now = context.now ?? new Date();

	const filled = body
		.replaceAll('{{date}}', formatFixed(context.day))
		.replaceAll('{{weekday}}', weekdayFixed(context.day))
		.replaceAll('{{time}}', clockTime(now));

	const at = filled.indexOf(CURSOR);
	const text = filled.replaceAll(CURSOR, '');

	return { text, cursor: at === -1 ? text.length : at };
}

/**
 * Fit filled text into a document at `pos`, with a blank line either side.
 *
 * Templates are block-shaped — headings and lists — and markdown needs the
 * blank line to treat them as blocks at all. Padding here rather than in the
 * template body means the same template reads correctly whether it lands in an
 * empty day or halfway down a full one.
 */
export function placeTemplate(
	doc: string,
	pos: number,
	filled: { text: string; cursor: number }
): { insert: string; cursor: number } {
	const before = doc.slice(0, pos);
	const after = doc.slice(pos);

	const lead = before.trim() === '' ? '' : '\n\n'.slice(0, 2 - trailingNewlines(before));
	const tail = after.trim() === '' ? '' : '\n\n'.slice(0, 2 - leadingNewlines(after));

	return { insert: lead + filled.text + tail, cursor: pos + lead.length + filled.cursor };
}

function trailingNewlines(text: string): number {
	return Math.min(2, /\n*$/.exec(text)?.[0].length ?? 0);
}

function leadingNewlines(text: string): number {
	return Math.min(2, /^\n*/.exec(text)?.[0].length ?? 0);
}

export function newTemplate(name = '', body = ''): Template {
	return { id: crypto.randomUUID(), name, body };
}

/**
 * Read a stored value back as templates.
 *
 * Returns `null` for anything that was never written, which is what lets the
 * caller tell "has not chosen yet" — seed the starters — from an empty list,
 * which means "deleted them all, leave me alone".
 */
export function readTemplates(value: unknown): Template[] | null {
	if (!Array.isArray(value)) return null;

	return value.flatMap((entry) => {
		if (typeof entry !== 'object' || entry === null) return [];
		const { id, name, body } = entry as Record<string, unknown>;
		if (typeof id !== 'string' || id === '') return [];

		return [
			{
				id,
				name: typeof name === 'string' && name.trim() !== '' ? name : 'Untitled',
				body: typeof body === 'string' ? body : ''
			}
		];
	});
}

/**
 * What a new journal starts with.
 *
 * Two, not one: a single template reads like a fixed feature of the app, and
 * the point is that they are yours to rewrite. Both are ordinary markdown, so
 * deleting them costs nothing.
 */
export const STARTER_TEMPLATES: readonly Omit<Template, 'id'>[] = [
	{
		name: 'Daily',
		body: `## What happened\n\n${CURSOR}\n\n## Worth remembering\n\n\n## Tomorrow\n`
	},
	{
		name: 'Three good things',
		body: `**{{weekday}} evening**\n\n1. ${CURSOR}\n2.\n3.\n`
	}
];

export function starterTemplates(): Template[] {
	return STARTER_TEMPLATES.map((template) => ({ ...template, id: crypto.randomUUID() }));
}
