import { CHALLENGE_METHOD } from './pkce';
import type { Session } from './session';
import { writeSession } from './session';
import type { KVNamespace } from '@cloudflare/workers-types';

/**
 * The GitHub App OAuth flow, server side.
 *
 * GitHub requires the client secret at the token endpoint even when PKCE is
 * used, so this module can only ever run in the Worker. That constraint is
 * exactly why the hosted path is a backend-for-frontend rather than a pure
 * client-side flow — and why the personal-token mode exists as the alternative
 * for people who would rather not run one.
 */

const AUTHORIZE = 'https://github.com/login/oauth/authorize';
const TOKEN = 'https://github.com/login/oauth/access_token';

/** Refresh a little before expiry so a long request can't straddle the boundary. */
const REFRESH_MARGIN_MS = 120_000;

export interface OAuthEnv {
	GITHUB_CLIENT_ID: string;
	GITHUB_CLIENT_SECRET: string;
	GITHUB_APP_SLUG: string;
}

export interface Tokens {
	accessToken: string;
	accessExpiresAt: number | null;
	refreshToken: string | null;
	refreshExpiresAt: number | null;
}

export function authorizeUrl(
	env: OAuthEnv,
	options: { state: string; challenge: string; redirectUri: string }
): string {
	const url = new URL(AUTHORIZE);

	url.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
	url.searchParams.set('redirect_uri', options.redirectUri);
	url.searchParams.set('state', options.state);
	url.searchParams.set('code_challenge', options.challenge);
	url.searchParams.set('code_challenge_method', CHALLENGE_METHOD);

	return url.toString();
}

/** Where to send someone who has authorized but granted no repositories yet. */
export function installUrl(env: OAuthEnv): string {
	return `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new`;
}

export async function exchangeCode(
	env: OAuthEnv,
	code: string,
	verifier: string,
	redirectUri: string
): Promise<Tokens> {
	return post(env, {
		client_id: env.GITHUB_CLIENT_ID,
		client_secret: env.GITHUB_CLIENT_SECRET,
		code,
		redirect_uri: redirectUri,
		code_verifier: verifier
	});
}

export async function refreshTokens(env: OAuthEnv, refreshToken: string): Promise<Tokens> {
	return post(env, {
		client_id: env.GITHUB_CLIENT_ID,
		client_secret: env.GITHUB_CLIENT_SECRET,
		grant_type: 'refresh_token',
		refresh_token: refreshToken
	});
}

/**
 * Return a session whose access token is good for the next couple of minutes,
 * refreshing and persisting it if not.
 *
 * Returns null when the session can no longer be revived — an expired refresh
 * token, or a revoked authorization — so the caller can clear the cookie rather
 * than retry forever.
 */
export async function freshSession(
	kv: KVNamespace,
	env: OAuthEnv,
	id: string,
	session: Session
): Promise<Session | null> {
	const expiresAt = session.accessExpiresAt;
	if (expiresAt === null || expiresAt - Date.now() > REFRESH_MARGIN_MS) return session;

	if (!session.refreshToken) return null;
	if (session.refreshExpiresAt !== null && session.refreshExpiresAt <= Date.now()) return null;

	try {
		const tokens = await refreshTokens(env, session.refreshToken);
		const next: Session = { ...session, ...tokens };

		await writeSession(kv, id, next);
		return next;
	} catch {
		return null;
	}
}

export class OAuthError extends Error {
	readonly code: string;

	constructor(code: string, description: string) {
		super(description || code);
		this.name = 'OAuthError';
		this.code = code;
	}
}

async function post(env: OAuthEnv, body: Record<string, string>): Promise<Tokens> {
	const response = await fetch(TOKEN, {
		method: 'POST',
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/x-www-form-urlencoded'
		},
		body: new URLSearchParams(body).toString()
	});

	if (!response.ok) {
		throw new OAuthError('http_error', `GitHub returned ${response.status}`);
	}

	const data = (await response.json()) as {
		access_token?: string;
		expires_in?: number;
		refresh_token?: string;
		refresh_token_expires_in?: number;
		error?: string;
		error_description?: string;
	};

	// GitHub reports OAuth failures with a 200 and an error body, so the status
	// code alone is not enough to know this worked.
	if (data.error || !data.access_token) {
		throw new OAuthError(data.error ?? 'no_token', data.error_description ?? 'No access token');
	}

	const now = Date.now();

	return {
		accessToken: data.access_token,
		// Apps with token expiry disabled return no `expires_in`; null means
		// "never refresh", not "already expired".
		accessExpiresAt: data.expires_in ? now + data.expires_in * 1000 : null,
		refreshToken: data.refresh_token ?? null,
		refreshExpiresAt: data.refresh_token_expires_in
			? now + data.refresh_token_expires_in * 1000
			: null
	};
}
