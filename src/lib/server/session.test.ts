import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { KVNamespace } from '@cloudflare/workers-types';
import {
	createSession,
	deleteSession,
	readSession,
	safeRedirect,
	startTransaction,
	takeTransaction,
	type Session
} from './session';
import { freshSession } from './github-oauth';

/** Just enough KV to exercise the session helpers. */
function fakeKv() {
	const store = new Map<string, string>();

	return {
		store,
		kv: {
			get: async (key: string, type?: string) => {
				const raw = store.get(key);
				if (raw === undefined) return null;
				return type === 'json' ? JSON.parse(raw) : raw;
			},
			put: async (key: string, value: string) => {
				store.set(key, value);
			},
			delete: async (key: string) => {
				store.delete(key);
			}
		} as unknown as KVNamespace
	};
}

const ENV = {
	GITHUB_CLIENT_ID: 'id',
	GITHUB_CLIENT_SECRET: 'secret',
	GITHUB_APP_SLUG: 'likh'
};

function session(over: Partial<Session> = {}): Session {
	return {
		accessToken: 'access-1',
		accessExpiresAt: Date.now() + 3_600_000,
		refreshToken: 'refresh-1',
		refreshExpiresAt: Date.now() + 30 * 86_400_000,
		login: 'testuser',
		createdAt: Date.now(),
		...over
	};
}

describe('sessions', () => {
	it('round-trips a session under an opaque id', async () => {
		const { kv, store } = fakeKv();
		const id = await createSession(kv, session());

		expect(id).toMatch(/^[A-Za-z0-9\-_]+$/);
		// The id must not be derived from anything about the user.
		expect(id).not.toContain('testuser');
		expect([...store.keys()]).toEqual([`session:${id}`]);
		expect((await readSession(kv, id))?.login).toBe('testuser');
	});

	it('returns null for an unknown or absent id', async () => {
		const { kv } = fakeKv();

		expect(await readSession(kv, 'nope')).toBeNull();
		expect(await readSession(kv, undefined)).toBeNull();
	});

	it('deletes', async () => {
		const { kv } = fakeKv();
		const id = await createSession(kv, session());

		await deleteSession(kv, id);

		expect(await readSession(kv, id)).toBeNull();
	});
});

describe('oauth transactions', () => {
	it('can only be redeemed once', async () => {
		const { kv } = fakeKv();
		const id = await startTransaction(kv, { state: 's', verifier: 'v', redirectTo: '/' });

		expect(await takeTransaction(kv, id)).toMatchObject({ state: 's', verifier: 'v' });
		// A replayed callback must find nothing.
		expect(await takeTransaction(kv, id)).toBeNull();
	});
});

describe('safeRedirect', () => {
	it('keeps same-origin paths', () => {
		expect(safeRedirect('/connect')).toBe('/connect');
		expect(safeRedirect('/2026-08-28')).toBe('/2026-08-28');
	});

	it('refuses anything that could leave the origin', () => {
		expect(safeRedirect('//evil.example')).toBe('/');
		expect(safeRedirect('/\\evil.example')).toBe('/');
		expect(safeRedirect('https://evil.example')).toBe('/');
		expect(safeRedirect('javascript:alert(1)')).toBe('/');
		expect(safeRedirect(null)).toBe('/');
	});
});

describe('freshSession', () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it('leaves a token that is still good alone', async () => {
		const { kv } = fakeKv();
		const current = session();

		await expect(freshSession(kv, ENV, 'id', current)).resolves.toBe(current);
	});

	it('leaves a non-expiring token alone', async () => {
		const { kv } = fakeKv();
		const current = session({ accessExpiresAt: null, refreshToken: null });

		await expect(freshSession(kv, ENV, 'id', current)).resolves.toBe(current);
	});

	it('refreshes a token that is about to expire, and persists the result', async () => {
		const { kv } = fakeKv();
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					access_token: 'access-2',
					expires_in: 28800,
					refresh_token: 'refresh-2',
					refresh_token_expires_in: 15_811_200
				}),
				{ status: 200, headers: { 'content-type': 'application/json' } }
			)
		);

		// Inside the refresh margin.
		const stale = session({ accessExpiresAt: Date.now() + 30_000 });
		const next = await freshSession(kv, ENV, 'sid', stale);

		expect(next?.accessToken).toBe('access-2');
		expect(next?.refreshToken).toBe('refresh-2');
		// Persisted, so the next request doesn't refresh again.
		expect((await readSession(kv, 'sid'))?.accessToken).toBe('access-2');
	});

	it('gives up when there is no refresh token', async () => {
		const { kv } = fakeKv();
		const stale = session({ accessExpiresAt: Date.now() + 1000, refreshToken: null });

		await expect(freshSession(kv, ENV, 'sid', stale)).resolves.toBeNull();
	});

	it('gives up when the refresh token itself has expired', async () => {
		const { kv } = fakeKv();
		const stale = session({
			accessExpiresAt: Date.now() + 1000,
			refreshExpiresAt: Date.now() - 1000
		});

		await expect(freshSession(kv, ENV, 'sid', stale)).resolves.toBeNull();
	});

	it('gives up when GitHub rejects the refresh', async () => {
		const { kv } = fakeKv();
		// GitHub reports OAuth failures with a 200 and an error body.
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(JSON.stringify({ error: 'bad_refresh_token' }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);

		const stale = session({ accessExpiresAt: Date.now() + 1000 });

		await expect(freshSession(kv, ENV, 'sid', stale)).resolves.toBeNull();
	});
});
