import type { DayKey } from '../date/day';
import { DEFAULT_LINE_WIDTH, DEFAULT_TEXT_SIZE, type LineWidth } from '../theme/reading';
import { DEFAULT_THEME, type ThemeChoice } from '../theme/themes';

/**
 * One journal day, as held locally.
 *
 * `dirty` and `conflicted` are 0/1 rather than booleans because IndexedDB
 * cannot index a boolean — `IDBKeyRange` only accepts numbers, strings, dates,
 * binary and arrays. Storing them as flags is what lets the sync engine ask for
 * "everything unsynced" with an index lookup instead of a full scan.
 */
export interface DayRecord {
	date: DayKey;

	/** Entry text, already normalised (no trailing whitespace). */
	body: string;
	tags: string[];
	/** Frontmatter fields likh doesn't recognise, preserved verbatim. */
	extra: string[];

	/**
	 * The exact file content last known to be on the remote — the merge base.
	 *
	 * Null means this day has never been seen on the remote, which is what tells
	 * the sync engine to treat a remote copy as an independent creation rather
	 * than an edit. Three-way merge correctness rests entirely on this field
	 * being maintained honestly: it is written only after a successful push or
	 * pull, never after a local edit.
	 */
	baseText: string | null;
	/** Git blob SHA of `baseText`, used to spot remote changes without fetching. */
	baseBlobSha: string | null;

	/** 1 when the serialized day differs from `baseText`. Derived, never guessed. */
	dirty: 0 | 1;
	/** 1 when `body` currently contains unresolved conflict markers. */
	conflicted: 0 | 1;

	/** Epoch ms of the last local edit. */
	updatedAt: number;
}

export interface AttachmentRecord {
	path: string;
	blob: Blob;
	/** Git blob SHA once the file exists on the remote. */
	baseSha: string | null;
	dirty: 0 | 1;
	/** The day the attachment was added from, for cleanup and display. */
	day: DayKey;
	addedAt: number;
}

export interface RepoRef {
	owner: string;
	name: string;
	branch: string;
}

export interface SyncMeta {
	repo: RepoRef | null;
	/** Commit SHA our `baseText` values correspond to. */
	headSha: string | null;
	headTreeSha: string | null;
	lastSyncAt: number | null;
	authMode: 'bff' | 'pat' | null;
}

export interface Settings {
	/** A named palette, or `system` to follow the OS. See `THEMES`. */
	theme: ThemeChoice;
	/** Undefined means "use the browser's locale". */
	locale?: string;
	focusMode: boolean;
	typewriter: boolean;
	spellcheck: boolean;
	/** Body text size in px; the writing surface scales from this. */
	fontSize: number;
	/** How wide the writing column runs. */
	lineWidth: LineWidth;
	/**
	 * The template offered on an empty day, by id.
	 *
	 * Only ever *offered*: nothing is written to a day until the writer asks for
	 * it, so a day that was opened and left alone stays out of the repository.
	 * Null, or an id that no longer exists, simply means no offer.
	 */
	dailyTemplateId: string | null;
	/**
	 * When entries reach GitHub.
	 *
	 * `manual` — only when you ask: the sync button, ⌘S, or Sync now in
	 * settings. Nothing commits behind your back, so the history is a record of
	 * moments you chose rather than of pauses in your typing.
	 *
	 * `auto` — also on a pause in writing, when the tab goes away, when the
	 * network returns, and on a background poll.
	 *
	 * Either way IndexedDB is the source of truth and nothing is ever lost by
	 * not syncing; the only thing at stake is how soon another device sees it.
	 */
	syncMode: 'manual' | 'auto';
}

export const DEFAULT_SETTINGS: Settings = {
	theme: DEFAULT_THEME,
	focusMode: false,
	typewriter: false,
	spellcheck: true,
	fontSize: DEFAULT_TEXT_SIZE,
	lineWidth: DEFAULT_LINE_WIDTH,
	dailyTemplateId: null,
	syncMode: 'manual'
};

export const EMPTY_META: SyncMeta = {
	repo: null,
	headSha: null,
	headTreeSha: null,
	lastSyncAt: null,
	authMode: null
};
