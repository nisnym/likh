import type { KVNamespace } from '@cloudflare/workers-types';
import { randomToken } from './pkce';

/**
 * Server-held sessions.
 *
 * The browser only ever holds an opaque id in an httpOnly cookie; the GitHub
 * tokens live in KV and never cross the network to the client. That is the
 * whole point of the BFF: script running on the page — including anything an
 * XSS managed to inject — cannot read or exfiltrate the token.
 */

export const SESSION_COOKIE = 'likh_sid';
export const OAUTH_COOKIE = 'likh_oauth';

/** Sessions outlive an access token; the refresh token is what keeps them alive. */
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;
/** An in-flight authorization is short-lived by design. */
const OAUTH_TTL_SECONDS = 600;

export interface Session {
	accessToken: string;
	/** Epoch ms, or null when the app issues non-expiring tokens. */
	accessExpiresAt: number | null;
	refreshToken: string | null;
	refreshExpiresAt: number | null;
	login: string;
	createdAt: number;
}

export interface OAuthTransaction {
	state: string;
	verifier: string;
	/** Same-origin path to return to. Validated before it is ever used. */
	redirectTo: string;
}

export async function createSession(kv: KVNamespace, session: Session): Promise<string> {
	const id = randomToken(32);

	await kv.put(`session:${id}`, JSON.stringify(session), {
		expirationTtl: SESSION_TTL_SECONDS
	});

	return id;
}

export async function readSession(
	kv: KVNamespace,
	id: string | undefined
): Promise<Session | null> {
	if (!id) return null;

	return (await kv.get(`session:${id}`, 'json')) as Session | null;
}

export async function writeSession(kv: KVNamespace, id: string, session: Session): Promise<void> {
	await kv.put(`session:${id}`, JSON.stringify(session), {
		expirationTtl: SESSION_TTL_SECONDS
	});
}

export async function deleteSession(kv: KVNamespace, id: string | undefined): Promise<void> {
	if (id) await kv.delete(`session:${id}`);
}

export async function startTransaction(
	kv: KVNamespace,
	transaction: OAuthTransaction
): Promise<string> {
	const id = randomToken(16);

	await kv.put(`oauth:${id}`, JSON.stringify(transaction), {
		expirationTtl: OAUTH_TTL_SECONDS
	});

	return id;
}

/** Reads and immediately deletes: an authorization code may be redeemed once. */
export async function takeTransaction(
	kv: KVNamespace,
	id: string | undefined
): Promise<OAuthTransaction | null> {
	if (!id) return null;

	const found = (await kv.get(`oauth:${id}`, 'json')) as OAuthTransaction | null;
	if (found) await kv.delete(`oauth:${id}`);

	return found;
}

/**
 * Only same-origin paths are ever followed after sign-in, so a crafted
 * `redirectTo` cannot bounce someone to another site carrying our cookie.
 */
export function safeRedirect(candidate: string | null): string {
	if (!candidate) return '/';
	if (!candidate.startsWith('/')) return '/';
	// `//host` and `/\host` are protocol-relative and leave the origin.
	if (candidate.startsWith('//') || candidate.startsWith('/\\')) return '/';

	return candidate;
}
