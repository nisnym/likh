/**
 * Frontmatter for a day file.
 *
 * The on-disk format is a deliberately tiny, closed schema (`date`, `tags`), so
 * this module parses it directly instead of pulling in a full YAML engine —
 * ~100 lines with no dependencies, and every byte it emits is something we can
 * reason about in a diff.
 *
 * Two properties matter, and both are property-tested in `frontmatter.test.ts`:
 *
 *  - **Idempotence.** `serialize(parse(serialize(d)))` is byte-identical to
 *    `serialize(d)`. Saving an unchanged day must never produce a diff, or the
 *    sync engine would commit noise forever.
 *  - **Losslessness.** Fields we don't recognise are preserved verbatim. Someone
 *    hand-editing `mood: 7` into a file on github.com must not have it silently
 *    deleted the next time they type in the app.
 */

export interface DayFrontmatter {
	/** `YYYY-MM-DD`. Always emitted first. */
	date: string;
	/** Emitted only when non-empty — an empty `tags: []` line is diff noise. */
	tags: string[];
	/**
	 * Frontmatter lines we don't understand, kept exactly as they were read and
	 * re-emitted after the known fields. Each entry is one logical YAML field,
	 * including any continuation lines, without a trailing newline.
	 */
	extra: string[];
}

export interface DayDocument {
	frontmatter: DayFrontmatter;
	/**
	 * The entry text. Always stored without trailing newlines; `serialize` adds
	 * exactly one. Normalising here rather than in the editor means the buffer
	 * you type into is never rewritten under your cursor, while the file on disk
	 * stays stable.
	 */
	body: string;
}

const FENCE = '---';
/** A new YAML field starts at column 0 with `key:`; anything else continues the previous one. */
const FIELD_START = /^([A-Za-z0-9_.-]+):(.*)$/;

/**
 * Strip trailing whitespace from a body.
 *
 * Trailing spaces mid-document are meaningful in markdown (two of them are a
 * hard line break), but at the very end of a file there is nothing to break
 * to — and leaving them in produces diffs consisting only of invisible
 * characters. Anything trailing goes.
 */
export function normalizeBody(body: string): string {
	return body.replace(/\s+$/, '');
}

export function parse(text: string, fallbackDate: string): DayDocument {
	const normalized = text.replace(/\r\n/g, '\n');

	if (!normalized.startsWith(FENCE + '\n')) {
		// No frontmatter (a file written by hand, or an empty one). Treat the
		// whole thing as body rather than guessing.
		return {
			frontmatter: { date: fallbackDate, tags: [], extra: [] },
			body: normalizeBody(normalized)
		};
	}

	const end = findClosingFence(normalized);
	if (end === -1) {
		// An unterminated `---` is not frontmatter, it's just text.
		return {
			frontmatter: { date: fallbackDate, tags: [], extra: [] },
			body: normalizeBody(normalized)
		};
	}

	const block = normalized.slice(FENCE.length + 1, end.blockEnd);
	const rest = normalized.slice(end.bodyStart);

	const fields = splitFields(block);
	let date = fallbackDate;
	let tags: string[] = [];
	const extra: string[] = [];

	for (const field of fields) {
		// Match the field's first line only. A block-style list spans several
		// lines, and `$` in FIELD_START would never match against the whole thing.
		const breakAt = field.indexOf('\n');
		const match = FIELD_START.exec(breakAt === -1 ? field : field.slice(0, breakAt));
		const key = match?.[1];
		const inline = match?.[2] ?? '';

		if (key === 'date') {
			const value = unquote(inline.trim());
			if (value) date = value;
		} else if (key === 'tags') {
			tags = parseTags(inline, field);
		} else {
			extra.push(field);
		}
	}

	return { frontmatter: { date, tags, extra }, body: normalizeBody(rest) };
}

export function serialize(doc: DayDocument): string {
	const { date, tags, extra } = doc.frontmatter;

	const lines = [FENCE, `date: ${date}`];
	if (tags.length > 0) lines.push(`tags: [${tags.map(quoteTag).join(', ')}]`);
	for (const field of extra) lines.push(field);
	lines.push(FENCE);

	const body = normalizeBody(doc.body);
	// A blank line between the fence and the prose; nothing at all when the day
	// is empty, so a day that exists but wasn't written in has a minimal file.
	return body ? `${lines.join('\n')}\n\n${body}\n` : `${lines.join('\n')}\n`;
}

/** Locate the closing `---`, returning where the block ends and the body begins. */
function findClosingFence(text: string): { blockEnd: number; bodyStart: number } | -1 {
	let index = FENCE.length + 1;

	while (index <= text.length) {
		const lineEnd = text.indexOf('\n', index);
		const line = lineEnd === -1 ? text.slice(index) : text.slice(index, lineEnd);

		if (line.trimEnd() === FENCE) {
			// Skip the fence, then at most one blank line separating it from the body.
			let bodyStart = lineEnd === -1 ? text.length : lineEnd + 1;
			if (text.startsWith('\n', bodyStart)) bodyStart += 1;
			return { blockEnd: index, bodyStart };
		}

		if (lineEnd === -1) break;
		index = lineEnd + 1;
	}

	return -1;
}

/**
 * Group the frontmatter block into logical fields. Indented lines and `- ` list
 * items belong to the field above them, so a block-style `tags:` list survives
 * as a single unit.
 */
function splitFields(block: string): string[] {
	const fields: string[] = [];

	for (const line of block.split('\n')) {
		if (line.trim() === '') continue;

		if (FIELD_START.test(line)) {
			fields.push(line.trimEnd());
		} else if (fields.length > 0) {
			fields[fields.length - 1] += '\n' + line.trimEnd();
		}
		// A continuation line with no field above it is malformed; drop it rather
		// than inventing a key for it.
	}

	return fields;
}

/** Accepts `[a, b]` flow style, a `- a` block list, or a bare scalar. */
function parseTags(inline: string, field: string): string[] {
	const flow = inline.trim();

	if (flow.startsWith('[')) {
		const inner = flow.replace(/^\[/, '').replace(/\]$/, '');
		return splitTagList(inner);
	}

	if (flow !== '') return splitTagList(flow);

	// Block list: every continuation line that looks like `- value`.
	return field
		.split('\n')
		.slice(1)
		.map((line) => line.trim())
		.filter((line) => line.startsWith('-'))
		.map((line) => unquote(line.slice(1).trim()))
		.filter(Boolean);
}

/**
 * Split a flow list on commas, ignoring commas inside quotes — otherwise a tag
 * like `"reading, fiction"` would silently split into two.
 */
function splitTagList(input: string): string[] {
	const parts: string[] = [];
	let current = '';
	let quote: string | null = null;

	for (let i = 0; i < input.length; i++) {
		const char = input[i];

		if (quote) {
			if (char === '\\' && quote === '"' && i + 1 < input.length) {
				current += char + input[i + 1];
				i++;
				continue;
			}
			if (char === quote) quote = null;
			current += char;
		} else if (char === '"' || char === "'") {
			quote = char;
			current += char;
		} else if (char === ',') {
			parts.push(current);
			current = '';
		} else {
			current += char;
		}
	}
	parts.push(current);

	return parts.map((tag) => unquote(tag.trim())).filter(Boolean);
}

function unquote(value: string): string {
	if (value.length < 2) return value;

	if (value.startsWith('"') && value.endsWith('"')) {
		// Our own writer emits JSON-quoted strings, so this round-trips escapes.
		try {
			return JSON.parse(value) as string;
		} catch {
			return value.slice(1, -1);
		}
	}

	if (value.startsWith("'") && value.endsWith("'")) {
		return value.slice(1, -1).replace(/''/g, "'");
	}

	return value;
}

/** Quote only when a bare tag would change meaning, to keep the common case clean. */
function quoteTag(tag: string): string {
	return /^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(tag) ? tag : JSON.stringify(tag);
}
