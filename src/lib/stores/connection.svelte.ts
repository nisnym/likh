import { GitHubClient } from '$lib/core/github/client';
import { bffTransport, patTransport } from '$lib/core/github/transport';
import { initializeRepo } from '$lib/core/github/init';
import type { Repo } from '$lib/core/github/types';
import { clearToken, getMeta, getToken, setMeta, setToken } from '$lib/core/db/kv';
import type { RepoRef } from '$lib/core/db/types';

export type Mode = 'none' | 'bff' | 'pat';

interface SessionInfo {
	connected: boolean;
	configured: boolean;
	login: string | null;
	installUrl: string | null;
}

/**
 * Which GitHub account and repository this device is writing to.
 *
 * Deliberately tolerant of being offline: the stored mode and repo come from
 * IndexedDB first, so a cold start on a train shows the right state and the app
 * stays usable. The network check only ever upgrades that picture.
 */
class ConnectionStore {
	mode = $state<Mode>('none');
	login = $state<string | null>(null);
	/** False when this deployment has no GitHub App configured. */
	configured = $state(false);
	installUrl = $state<string | null>(null);
	repo = $state<RepoRef | null>(null);

	checking = $state(true);
	/** Set when the last network check failed, so the UI can say "offline". */
	unreachable = $state(false);

	#token: string | null = null;

	get connected(): boolean {
		return this.mode !== 'none';
	}

	get ready(): boolean {
		return this.connected && this.repo !== null;
	}

	/** Null until a mode is established; every caller must handle that. */
	client(): GitHubClient | null {
		if (this.mode === 'bff') return new GitHubClient(bffTransport);
		if (this.mode === 'pat' && this.#token) return new GitHubClient(patTransport(this.#token));

		return null;
	}

	async load(): Promise<void> {
		this.checking = true;

		const [meta, token] = await Promise.all([getMeta(), getToken()]);
		this.repo = meta.repo;
		this.#token = token;

		// Local state first: this is what makes an offline boot correct.
		if (token) this.mode = 'pat';
		else if (meta.authMode === 'bff') this.mode = 'bff';

		if (this.mode !== 'pat') await this.#checkSession();

		this.checking = false;
	}

	async #checkSession(): Promise<void> {
		try {
			const response = await fetch('/auth/session', { credentials: 'include' });
			if (!response.ok) throw new Error(String(response.status));

			const info = (await response.json()) as SessionInfo;

			this.configured = info.configured;
			this.installUrl = info.installUrl;
			this.login = info.login;
			this.mode = info.connected ? 'bff' : 'none';
			this.unreachable = false;

			await setMeta({ authMode: info.connected ? 'bff' : null });
		} catch {
			// Offline, or the Worker is down. Keep whatever we knew from storage.
			this.unreachable = true;
		}
	}

	async connectWithToken(token: string): Promise<void> {
		const trimmed = token.trim();
		if (!trimmed) throw new Error('Paste a token first.');

		// Prove the token works before storing it, so a typo fails here rather
		// than silently at the first sync.
		const probe = new GitHubClient(patTransport(trimmed));
		const user = await probe.getUser();

		await setToken(trimmed);
		await setMeta({ authMode: 'pat' });

		this.#token = trimmed;
		this.mode = 'pat';
		this.login = user.login;
	}

	async listRepos(): Promise<Repo[]> {
		const client = this.client();
		if (!client) throw new Error('Not connected to GitHub.');

		return client.listRepos();
	}

	/**
	 * Adopt a repository: make sure it holds a journal, then remember it.
	 *
	 * The order matters. Initialization is idempotent and the write is what
	 * proves we can actually push, so doing it before saving means a repo only
	 * ever becomes "the journal" once it is genuinely usable.
	 */
	async useRepo(repo: Repo): Promise<void> {
		const client = this.client();
		if (!client) throw new Error('Not connected to GitHub.');

		const ref: RepoRef = { owner: repo.owner, name: repo.name, branch: repo.defaultBranch };
		const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

		await initializeRepo(client, ref, { timezone });

		// `headSha` is deliberately left null. It means "the commit our local
		// copies correspond to", and this device has no local copies yet — so
		// recording the head here would make the first pull believe it was
		// already up to date and skip every entry already in the repository.
		// `lastSyncAt` goes with it: it describes this repository, not the last
		// one, and leaving it behind would claim a sync that never happened.
		await setMeta({ repo: ref, headSha: null, headTreeSha: null, lastSyncAt: null });
		this.repo = ref;
	}

	async disconnect(): Promise<void> {
		if (this.mode === 'bff') {
			try {
				await fetch('/auth/logout', { method: 'POST', credentials: 'include' });
			} catch {
				// Best effort: the local state is cleared regardless.
			}
		}

		await clearToken();
		await setMeta({ authMode: null, repo: null, headSha: null, headTreeSha: null });

		this.#token = null;
		this.mode = 'none';
		this.login = null;
		this.repo = null;
	}
}

export const connection = new ConnectionStore();
