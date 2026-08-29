/** A branch in a repository — everything the sync engine needs to address it. */
export interface RepoRef {
	owner: string;
	name: string;
	branch: string;
}

export interface Repo {
	owner: string;
	name: string;
	fullName: string;
	private: boolean;
	defaultBranch: string;
	/** False for a repo the installation can read but not write. */
	canPush: boolean;
	updatedAt: string | null;
}

export interface Installation {
	id: number;
	account: string;
	/** 'all' when the user granted access to every repo, else 'selected'. */
	repositorySelection: 'all' | 'selected';
}

export interface GitUser {
	login: string;
	name: string | null;
	avatarUrl: string | null;
}

export interface TreeEntry {
	path: string;
	mode: string;
	type: 'blob' | 'tree' | 'commit';
	sha: string;
	size?: number;
}

/**
 * An entry being written. `content` inlines a text blob so a whole commit can go
 * up in one call; `sha` references a blob already uploaded (how binaries go).
 * A null `sha` deletes the path.
 */
export interface NewTreeEntry {
	path: string;
	mode: '100644' | '100755' | '040000';
	type: 'blob' | 'tree';
	content?: string;
	sha?: string | null;
}

export interface CommitInfo {
	sha: string;
	treeSha: string;
	parents: string[];
	message: string;
}

/** Parsed from response headers so callers can back off before being told to. */
export interface RateLimit {
	remaining: number | null;
	reset: number | null;
	retryAfterMs: number | null;
}
