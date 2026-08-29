import { blobSha, sha1Hex } from '../git/object-id';
import { fromBase64, toBase64 } from '../util/base64';
import type { Transport } from './transport';

/**
 * An in-memory GitHub, good enough to run the real client against.
 *
 * This is a test double, not a mock: requests go through `GitHubClient`
 * unchanged, so the tests exercise the actual URL building, JSON shapes and
 * error handling rather than a stubbed-out version of them. Blob SHAs use the
 * real git algorithm, so a client that computes a SHA locally can be checked
 * against what "the server" says.
 *
 * Only the endpoints likh uses are implemented; anything else 404s loudly.
 */

interface FakeRepo {
	owner: string;
	name: string;
	private: boolean;
	defaultBranch: string;
	canPush: boolean;
	refs: Map<string, string>;
	commits: Map<string, { tree: string; parents: string[]; message: string }>;
	trees: Map<string, Array<{ path: string; mode: string; type: string; sha: string }>>;
	blobs: Map<string, Uint8Array>;
}

export interface FakeOptions {
	login?: string;
	/** Force the next N requests to fail with this status, for retry tests. */
	failWith?: { status: number; times: number; message?: string };
}

export class FakeGitHub {
	readonly repos = new Map<string, FakeRepo>();
	login: string;

	/** Every request path, in order — lets tests assert on call counts. */
	readonly calls: Array<{ method: string; path: string }> = [];

	#fail: { status: number; times: number; message: string } | null = null;
	#failOn: {
		method?: string;
		path?: RegExp;
		status: number;
		times: number;
		message: string;
	} | null = null;

	/** Force `getTree` to report truncation, whatever the tree actually holds. */
	truncateTrees = false;

	constructor(options: FakeOptions = {}) {
		this.login = options.login ?? 'testuser';
		if (options.failWith) {
			this.#fail = {
				status: options.failWith.status,
				times: options.failWith.times,
				message: options.failWith.message ?? 'Injected failure'
			};
		}
	}

	/** Make the next `times` requests fail — used to test retry and backoff. */
	failNext(status: number, times = 1, message = 'Injected failure'): void {
		this.#fail = { status, times, message };
	}

	/**
	 * Fail a *specific* request, so a push can be interrupted at a chosen step
	 * rather than wherever the request count happens to land.
	 */
	failOn(
		match: { method?: string; path?: RegExp },
		status: number,
		times = 1,
		message = 'Injected failure'
	): void {
		this.#failOn = { ...match, status, times, message };
	}

	/** Remove a path at the branch head, as someone deleting a file on GitHub would. */
	async deleteFile(fullName: string, branch: string, path: string): Promise<string> {
		const repo = this.repos.get(fullName);
		if (!repo) throw new Error(`No such repo: ${fullName}`);

		const head = repo.refs.get(branch);
		const baseTree = head ? repo.commits.get(head)?.tree : undefined;
		const entries = (baseTree ? (repo.trees.get(baseTree) ?? []) : []).filter(
			(entry) => entry.path !== path
		);

		const treeSha = await sha1Hex(JSON.stringify(entries));
		repo.trees.set(treeSha, entries);

		const commitSha = await sha1Hex(JSON.stringify({ treeSha, head, message: 'delete ' + path }));
		repo.commits.set(commitSha, {
			tree: treeSha,
			parents: head ? [head] : [],
			message: `delete ${path}`
		});
		repo.refs.set(branch, commitSha);

		return commitSha;
	}

	addRepo(fullName: string, options: Partial<Omit<FakeRepo, 'owner' | 'name'>> = {}): FakeRepo {
		const [owner, name] = fullName.split('/');
		const repo: FakeRepo = {
			owner,
			name,
			private: options.private ?? true,
			defaultBranch: options.defaultBranch ?? 'main',
			canPush: options.canPush ?? true,
			refs: new Map(),
			commits: new Map(),
			trees: new Map(),
			blobs: new Map()
		};

		this.repos.set(fullName, repo);
		return repo;
	}

	/** Read a path at the branch head, the way a second device would see it. */
	async readFile(fullName: string, branch: string, path: string): Promise<string | null> {
		const repo = this.repos.get(fullName);
		const head = repo?.refs.get(branch);
		if (!repo || !head) return null;

		const commit = repo.commits.get(head);
		if (!commit) return null;

		const entry = (repo.trees.get(commit.tree) ?? []).find((item) => item.path === path);
		if (!entry) return null;

		const bytes = repo.blobs.get(entry.sha);
		return bytes ? new TextDecoder().decode(bytes) : null;
	}

	/** Commit straight into the fake, simulating another device pushing. */
	async commit(
		fullName: string,
		branch: string,
		files: Record<string, string>,
		message = 'external commit'
	): Promise<string> {
		const repo = this.repos.get(fullName);
		if (!repo) throw new Error(`No such repo: ${fullName}`);

		const head = repo.refs.get(branch) ?? null;
		const baseTree = head ? (repo.commits.get(head)?.tree ?? null) : null;
		const entries = baseTree ? [...(repo.trees.get(baseTree) ?? [])] : [];

		for (const [path, content] of Object.entries(files)) {
			const bytes = new TextEncoder().encode(content);
			const sha = await blobSha(bytes);
			repo.blobs.set(sha, bytes);

			const existing = entries.findIndex((entry) => entry.path === path);
			const entry = { path, mode: '100644', type: 'blob', sha };
			if (existing === -1) entries.push(entry);
			else entries[existing] = entry;
		}

		const treeSha = await sha1Hex(JSON.stringify(entries));
		repo.trees.set(treeSha, entries);

		const commitSha = await sha1Hex(JSON.stringify({ treeSha, head, message }));
		repo.commits.set(commitSha, { tree: treeSha, parents: head ? [head] : [], message });
		repo.refs.set(branch, commitSha);

		return commitSha;
	}

	transport(mode: 'bff' | 'pat' = 'bff'): Transport {
		return { mode, request: (path, init) => this.#handle(path, init) };
	}

	async #handle(path: string, init: RequestInit): Promise<Response> {
		const method = init.method ?? 'GET';
		this.calls.push({ method, path });

		if (this.#fail && this.#fail.times > 0) {
			this.#fail.times -= 1;
			const status = this.#fail.status;
			const message = this.#fail.message;
			if (this.#fail.times === 0) this.#fail = null;
			return json({ message }, status);
		}

		const targeted = this.#failOn;
		if (
			targeted &&
			targeted.times > 0 &&
			(targeted.method === undefined || targeted.method === method) &&
			(targeted.path === undefined || targeted.path.test(path))
		) {
			targeted.times -= 1;
			if (targeted.times === 0) this.#failOn = null;
			return json({ message: targeted.message }, targeted.status);
		}

		const [route, search] = path.split('?');
		const query = new URLSearchParams(search ?? '');
		const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : null;

		if (route === '/user') {
			return json({ login: this.login, name: 'Test User', avatar_url: null });
		}

		if (route === '/user/installations') {
			return json({
				installations: [{ id: 1, account: { login: this.login }, repository_selection: 'selected' }]
			});
		}

		if (route === '/user/installations/1/repositories' || route === '/user/repos') {
			// The client pages until a short page; page 1 holds everything.
			const page = Number(query.get('page') ?? '1');
			const repos = page === 1 ? [...this.repos.values()].map(describeRepo) : [];
			return json(
				route === '/user/repos' ? repos : { total_count: repos.length, repositories: repos }
			);
		}

		const repoMatch = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(route);
		if (!repoMatch) return json({ message: `Not Found: ${route}` }, 404);

		const repo = this.repos.get(`${repoMatch[1]}/${repoMatch[2]}`);
		if (!repo) return json({ message: 'Not Found' }, 404);

		const rest = repoMatch[3] ?? '';
		return this.#repoRoute(repo, method, rest, body);
	}

	async #repoRoute(
		repo: FakeRepo,
		method: string,
		rest: string,
		body: Record<string, unknown> | null
	): Promise<Response> {
		if (rest === '') return json(describeRepo(repo));

		const ref = /^\/git\/refs?\/heads\/(.+)$/.exec(rest);
		if (ref) {
			const branch = decodeURIComponent(ref[1]);
			const sha = repo.refs.get(branch);

			if (method === 'GET') {
				if (!sha) return json({ message: 'Not Found' }, 404);
				return json({ ref: `refs/heads/${branch}`, object: { sha, type: 'commit' } });
			}

			if (method === 'PATCH') {
				if (!sha) return json({ message: 'Reference does not exist' }, 422);
				if (!repo.canPush) return json({ message: 'Resource not accessible' }, 403);

				const next = body?.sha as string;
				const parents = repo.commits.get(next)?.parents ?? [];
				// Reject a non-fast-forward, exactly as GitHub does when the branch
				// has moved on since the client read it.
				if (!parents.includes(sha)) {
					return json({ message: 'Update is not a fast forward' }, 422);
				}

				repo.refs.set(branch, next);
				return json({ ref: `refs/heads/${branch}`, object: { sha: next } });
			}
		}

		if (rest === '/git/refs' && method === 'POST') {
			const name = String(body?.ref ?? '').replace('refs/heads/', '');
			if (repo.refs.has(name)) return json({ message: 'Reference already exists' }, 422);

			repo.refs.set(name, String(body?.sha));
			return json({ ref: body?.ref, object: { sha: body?.sha } }, 201);
		}

		const commit = /^\/git\/commits\/(.+)$/.exec(rest);
		if (commit && method === 'GET') {
			const found = repo.commits.get(commit[1]);
			if (!found) return json({ message: 'Not Found' }, 404);

			return json({
				sha: commit[1],
				message: found.message,
				tree: { sha: found.tree },
				parents: found.parents.map((sha) => ({ sha }))
			});
		}

		if (rest === '/git/commits' && method === 'POST') {
			const treeSha = String(body?.tree);
			const parents = (body?.parents as string[]) ?? [];
			const message = String(body?.message ?? '');
			const sha = await sha1Hex(
				JSON.stringify({ treeSha, parents, message, at: repo.commits.size })
			);

			repo.commits.set(sha, { tree: treeSha, parents, message });
			return json({ sha }, 201);
		}

		const tree = /^\/git\/trees\/(.+)$/.exec(rest);
		if (tree && method === 'GET') {
			const sha = tree[1];
			const entries = repo.trees.get(sha);
			if (!entries) return json({ message: 'Not Found' }, 404);

			return json({ sha, tree: entries, truncated: this.truncateTrees });
		}

		if (rest === '/git/trees' && method === 'POST') {
			const base = body?.base_tree ? repo.trees.get(String(body.base_tree)) : undefined;
			const entries = base ? [...base] : [];

			for (const raw of (body?.tree as Array<Record<string, unknown>>) ?? []) {
				const path = String(raw.path);
				const at = entries.findIndex((entry) => entry.path === path);

				if (raw.sha === null) {
					if (at !== -1) entries.splice(at, 1);
					continue;
				}

				let sha = raw.sha as string | undefined;
				if (raw.content !== undefined) {
					const bytes = new TextEncoder().encode(String(raw.content));
					sha = await blobSha(bytes);
					repo.blobs.set(sha, bytes);
				}

				const entry = { path, mode: String(raw.mode), type: String(raw.type), sha: sha! };
				if (at === -1) entries.push(entry);
				else entries[at] = entry;
			}

			entries.sort((a, b) => a.path.localeCompare(b.path));
			const sha = await sha1Hex(JSON.stringify(entries));
			repo.trees.set(sha, entries);

			return json({ sha, tree: entries }, 201);
		}

		const blob = /^\/git\/blobs\/(.+)$/.exec(rest);
		if (blob && method === 'GET') {
			const bytes = repo.blobs.get(blob[1]);
			if (!bytes) return json({ message: 'Not Found' }, 404);

			return json({ sha: blob[1], content: toBase64(bytes), encoding: 'base64' });
		}

		if (rest === '/git/blobs' && method === 'POST') {
			const bytes = fromBase64(String(body?.content));
			const sha = await blobSha(bytes);
			repo.blobs.set(sha, bytes);

			return json({ sha }, 201);
		}

		return json({ message: `Not Found: ${rest}` }, 404);
	}
}

function describeRepo(repo: FakeRepo) {
	return {
		name: repo.name,
		full_name: `${repo.owner}/${repo.name}`,
		private: repo.private,
		default_branch: repo.defaultBranch,
		owner: { login: repo.owner },
		permissions: { push: repo.canPush },
		updated_at: '2026-08-28T00:00:00Z'
	};
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: {
			'content-type': 'application/json',
			'x-ratelimit-remaining': '4999',
			'x-ratelimit-reset': '9999999999'
		}
	});
}
