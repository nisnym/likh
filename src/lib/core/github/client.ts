import { fromBase64, toBase64 } from '../util/base64';
import { GitHubError } from './errors';
import type { Transport } from './transport';
import type {
	CommitInfo,
	GitUser,
	Installation,
	NewTreeEntry,
	RateLimit,
	Repo,
	RepoRef,
	TreeEntry
} from './types';

export interface TreeResult {
	entries: TreeEntry[];
	/**
	 * GitHub caps a recursive tree at 100,000 entries / 7MB. A truncated tree
	 * looks exactly like one where files were deleted, so callers must refuse to
	 * compute a diff from it rather than quietly lose entries.
	 */
	truncated: boolean;
}

/** Guard against a runaway loop if GitHub ever stops shortening the last page. */
const MAX_PAGES = 20;
const PER_PAGE = 100;

export class GitHubClient {
	readonly #transport: Transport;

	constructor(transport: Transport) {
		this.#transport = transport;
	}

	get mode(): 'bff' | 'pat' {
		return this.#transport.mode;
	}

	// --- identity ---------------------------------------------------------

	async getUser(): Promise<GitUser> {
		const data = await this.#json<{ login: string; name?: string; avatar_url?: string }>(
			'GET',
			'/user'
		);

		return { login: data.login, name: data.name ?? null, avatarUrl: data.avatar_url ?? null };
	}

	async listInstallations(): Promise<Installation[]> {
		const data = await this.#json<{
			installations: Array<{
				id: number;
				account: { login: string } | null;
				repository_selection: string;
			}>;
		}>('GET', '/user/installations?per_page=100');

		return data.installations.map((item) => ({
			id: item.id,
			account: item.account?.login ?? '',
			repositorySelection: item.repository_selection === 'all' ? 'all' : 'selected'
		}));
	}

	/**
	 * Repositories this credential can write to.
	 *
	 * The two modes genuinely differ: a GitHub App user token sees repos through
	 * its installations, while a fine-grained personal token answers on
	 * `/user/repos` directly. This is the one place that branch is justified.
	 */
	async listRepos(): Promise<Repo[]> {
		if (this.mode === 'pat') {
			const repos = await this.#paged<RawRepo>(
				'/user/repos?affiliation=owner,collaborator&sort=updated',
				(page) => page as RawRepo[]
			);
			return repos.map(toRepo).filter((repo) => repo.canPush);
		}

		const installations = await this.listInstallations();
		const found = new Map<string, Repo>();

		for (const installation of installations) {
			const repos = await this.#paged<RawRepo>(
				`/user/installations/${installation.id}/repositories`,
				(page) => (page as { repositories?: RawRepo[] }).repositories ?? []
			);

			for (const raw of repos) {
				const repo = toRepo(raw);
				// A repo can appear under more than one installation; keep one.
				if (repo.canPush) found.set(repo.fullName, repo);
			}
		}

		return [...found.values()].sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
	}

	async getRepo(owner: string, name: string): Promise<Repo> {
		return toRepo(await this.#json<RawRepo>('GET', `/repos/${owner}/${name}`));
	}

	// --- git plumbing -----------------------------------------------------

	/** Null when the branch does not exist yet — an empty repo, or a new branch. */
	async getRef(repo: RepoRef): Promise<string | null> {
		try {
			const data = await this.#json<{ object: { sha: string } }>(
				'GET',
				`/repos/${repo.owner}/${repo.name}/git/ref/heads/${encodeURIComponent(repo.branch)}`
			);
			return data.object.sha;
		} catch (error) {
			if (error instanceof GitHubError && error.isNotFound) return null;
			throw error;
		}
	}

	async getCommit(repo: RepoRef, sha: string): Promise<CommitInfo> {
		const data = await this.#json<{
			sha: string;
			message: string;
			tree: { sha: string };
			parents: Array<{ sha: string }>;
		}>('GET', `/repos/${repo.owner}/${repo.name}/git/commits/${sha}`);

		return {
			sha: data.sha,
			treeSha: data.tree.sha,
			parents: data.parents.map((parent) => parent.sha),
			message: data.message
		};
	}

	async getTree(repo: RepoRef, sha: string, recursive = true): Promise<TreeResult> {
		const query = recursive ? '?recursive=1' : '';
		const data = await this.#json<{ tree: TreeEntry[]; truncated?: boolean }>(
			'GET',
			`/repos/${repo.owner}/${repo.name}/git/trees/${sha}${query}`
		);

		return { entries: data.tree ?? [], truncated: data.truncated === true };
	}

	async getBlob(repo: RepoRef, sha: string): Promise<Uint8Array> {
		const data = await this.#json<{ content: string; encoding: string }>(
			'GET',
			`/repos/${repo.owner}/${repo.name}/git/blobs/${sha}`
		);

		if (data.encoding !== 'base64') {
			throw new GitHubError(500, `Unexpected blob encoding: ${data.encoding}`, emptyRateLimit());
		}

		return fromBase64(data.content);
	}

	async createBlob(repo: RepoRef, bytes: Uint8Array): Promise<string> {
		const data = await this.#json<{ sha: string }>(
			'POST',
			`/repos/${repo.owner}/${repo.name}/git/blobs`,
			{ content: toBase64(bytes), encoding: 'base64' }
		);

		return data.sha;
	}

	/** One call writes every changed file; `baseTree` carries the rest forward. */
	async createTree(
		repo: RepoRef,
		baseTree: string | null,
		entries: NewTreeEntry[]
	): Promise<string> {
		const data = await this.#json<{ sha: string }>(
			'POST',
			`/repos/${repo.owner}/${repo.name}/git/trees`,
			{ ...(baseTree ? { base_tree: baseTree } : {}), tree: entries }
		);

		return data.sha;
	}

	async createCommit(
		repo: RepoRef,
		message: string,
		treeSha: string,
		parents: string[]
	): Promise<string> {
		const data = await this.#json<{ sha: string }>(
			'POST',
			`/repos/${repo.owner}/${repo.name}/git/commits`,
			{ message, tree: treeSha, parents }
		);

		return data.sha;
	}

	/** Creates the branch. Use when `getRef` returned null. */
	async createRef(repo: RepoRef, sha: string): Promise<void> {
		await this.#json('POST', `/repos/${repo.owner}/${repo.name}/git/refs`, {
			ref: `refs/heads/${repo.branch}`,
			sha
		});
	}

	/**
	 * Move the branch. Never forced: a rejection here means someone else pushed,
	 * which the sync engine answers by pulling and merging, not by overwriting.
	 */
	async updateRef(repo: RepoRef, sha: string): Promise<void> {
		await this.#json(
			'PATCH',
			`/repos/${repo.owner}/${repo.name}/git/refs/heads/${encodeURIComponent(repo.branch)}`,
			{ sha, force: false }
		);
	}

	// --- plumbing ---------------------------------------------------------

	async #json<T>(method: string, path: string, body?: unknown): Promise<T> {
		const response = await this.#transport.request(path, {
			method,
			headers: {
				Accept: 'application/vnd.github+json',
				'X-GitHub-Api-Version': '2022-11-28',
				...(body === undefined ? {} : { 'Content-Type': 'application/json' })
			},
			...(body === undefined ? {} : { body: JSON.stringify(body) })
		});

		if (!response.ok) throw await toError(response);

		if (response.status === 204) return undefined as T;
		return (await response.json()) as T;
	}

	/** Page until a short page arrives; avoids relying on Link headers surviving the proxy. */
	async #paged<T>(path: string, extract: (page: unknown) => T[]): Promise<T[]> {
		const separator = path.includes('?') ? '&' : '?';
		const all: T[] = [];

		for (let page = 1; page <= MAX_PAGES; page++) {
			const batch = extract(
				await this.#json<unknown>('GET', `${path}${separator}per_page=${PER_PAGE}&page=${page}`)
			);

			all.push(...batch);
			if (batch.length < PER_PAGE) break;
		}

		return all;
	}
}

interface RawRepo {
	name: string;
	full_name: string;
	private: boolean;
	default_branch: string;
	owner: { login: string };
	permissions?: { push?: boolean };
	updated_at?: string;
}

function toRepo(raw: RawRepo): Repo {
	return {
		owner: raw.owner.login,
		name: raw.name,
		fullName: raw.full_name,
		private: raw.private,
		defaultBranch: raw.default_branch || 'main',
		// Absent permissions means the endpoint didn't say; assume writable and
		// let the first push be the thing that tells the truth.
		canPush: raw.permissions?.push ?? true,
		updatedAt: raw.updated_at ?? null
	};
}

export function readRateLimit(headers: Headers): RateLimit {
	const number = (name: string) => {
		const raw = headers.get(name);
		const value = raw === null ? Number.NaN : Number(raw);
		return Number.isFinite(value) ? value : null;
	};

	const retryAfter = number('retry-after');

	return {
		remaining: number('x-ratelimit-remaining'),
		reset: number('x-ratelimit-reset'),
		retryAfterMs: retryAfter === null ? null : retryAfter * 1000
	};
}

function emptyRateLimit(): RateLimit {
	return { remaining: null, reset: null, retryAfterMs: null };
}

async function toError(response: Response): Promise<GitHubError> {
	let message = `${response.status} ${response.statusText}`;
	let documentationUrl: string | null = null;

	try {
		const body = (await response.json()) as { message?: string; documentation_url?: string };
		if (body.message) message = body.message;
		documentationUrl = body.documentation_url ?? null;
	} catch {
		// A non-JSON error body (a proxy, an outage page) — keep the status line.
	}

	return new GitHubError(
		response.status,
		message,
		readRateLimit(response.headers),
		documentationUrl
	);
}
