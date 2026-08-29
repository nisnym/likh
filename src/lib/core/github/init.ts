import { CONFIG_PATH, JOURNAL_DIR, ATTACHMENTS_DIR, README_PATH } from '../repo/paths';
import type { GitHubClient } from './client';
import type { NewTreeEntry, RepoRef } from './types';

export interface InitResult {
	/** The branch head after initialization. */
	headSha: string;
	treeSha: string;
	/** Paths this call actually wrote. Empty when the repo was already set up. */
	written: string[];
	/** True when the branch did not exist before (an empty repo). */
	createdBranch: boolean;
}

export interface InitOptions {
	/** Recorded once, for whoever reads the repo later. Never used as authority. */
	timezone?: string;
}

const CONFIG_VERSION = 1;

/**
 * Make a repository ready to hold a journal.
 *
 * Idempotent by design: it writes only the files that are missing, and if
 * nothing is missing it makes no commit at all. Running it again on a repo with
 * years of entries must be a no-op, not an empty commit — and must never
 * overwrite a README the user has since made their own.
 */
export async function initializeRepo(
	client: GitHubClient,
	repo: RepoRef,
	options: InitOptions = {}
): Promise<InitResult> {
	const head = await client.getRef(repo);

	let baseTree: string | null = null;
	const existing = new Set<string>();

	if (head) {
		const commit = await client.getCommit(repo, head);
		baseTree = commit.treeSha;

		const tree = await client.getTree(repo, commit.treeSha, true);
		// A truncated tree can't prove a file is absent, so treat both as present
		// rather than risk clobbering a README behind entry 100,000.
		if (tree.truncated) {
			return { headSha: head, treeSha: commit.treeSha, written: [], createdBranch: false };
		}
		for (const entry of tree.entries) existing.add(entry.path);
	}

	const entries: NewTreeEntry[] = [];
	const written: string[] = [];

	if (!existing.has(CONFIG_PATH)) {
		entries.push({
			path: CONFIG_PATH,
			mode: '100644',
			type: 'blob',
			content: configFile(options.timezone)
		});
		written.push(CONFIG_PATH);
	}

	if (!existing.has(README_PATH)) {
		entries.push({ path: README_PATH, mode: '100644', type: 'blob', content: readmeFile() });
		written.push(README_PATH);
	}

	if (entries.length === 0) {
		return { headSha: head!, treeSha: baseTree!, written: [], createdBranch: false };
	}

	const treeSha = await client.createTree(repo, baseTree, entries);
	const message = head ? 'Set up likh journal' : 'Start journal';
	const commitSha = await client.createCommit(repo, message, treeSha, head ? [head] : []);

	if (head) await client.updateRef(repo, commitSha);
	else await client.createRef(repo, commitSha);

	return { headSha: commitSha, treeSha, written, createdBranch: head === null };
}

function configFile(timezone?: string): string {
	const config = {
		version: CONFIG_VERSION,
		journalDir: JOURNAL_DIR,
		attachmentsDir: ATTACHMENTS_DIR,
		// Informational only. Devices in other zones will disagree, and each one
		// files entries under its own local day — as it should be.
		createdIn: timezone ?? null
	};

	return JSON.stringify(config, null, '\t') + '\n';
}

function readmeFile(): string {
	return `# Journal

Written with [likh](https://likh.dev). One markdown file per day.

\`\`\`
${JOURNAL_DIR}/2026/August/28.md
${ATTACHMENTS_DIR}/2026/August/sunset-a1b2c3.webp
\`\`\`

Each entry is plain markdown with a small frontmatter block:

\`\`\`markdown
---
date: 2026-08-28
tags: [work, ideas]
---

Shipped the sync layer today.
\`\`\`

That's the whole format. These are just files — read them here, clone them,
\`grep\` them, or keep writing in any editor. likh is one way to write them, not
a requirement for reading them.
`;
}
