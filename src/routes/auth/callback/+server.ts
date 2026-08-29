import { redirect, type RequestHandler } from '@sveltejs/kit';
import { cookieOptions, requireEnv } from '$lib/server/env';
import { exchangeCode } from '$lib/server/github-oauth';
import { OAUTH_COOKIE, SESSION_COOKIE, createSession, takeTransaction } from '$lib/server/session';

const SESSION_MAX_AGE = 60 * 60 * 24 * 180;

export const GET: RequestHandler = async ({ platform, url, cookies }) => {
	const env = requireEnv(platform);

	// Read and burn the transaction first, whatever happens next: an
	// authorization code may only be redeemed once.
	const transaction = await takeTransaction(env.SESSIONS, cookies.get(OAUTH_COOKIE));
	cookies.delete(OAUTH_COOKIE, { path: '/' });

	const denied = url.searchParams.get('error');
	if (denied) redirect(303, `/connect?error=${encodeURIComponent(denied)}`);

	const code = url.searchParams.get('code');
	const state = url.searchParams.get('state');

	// A missing transaction, a missing code, or a state that doesn't match all
	// mean the same thing: this callback did not come from a flow we started.
	if (!transaction || !code || !state || state !== transaction.state) {
		redirect(303, '/connect?error=bad_state');
	}

	let sessionId: string;

	try {
		const tokens = await exchangeCode(
			env,
			code,
			transaction.verifier,
			`${url.origin}/auth/callback`
		);
		const login = await fetchLogin(tokens.accessToken);

		sessionId = await createSession(env.SESSIONS, { ...tokens, login, createdAt: Date.now() });
	} catch (caught) {
		const reason = caught instanceof Error ? caught.message : 'exchange_failed';
		redirect(303, `/connect?error=${encodeURIComponent(reason)}`);
	}

	cookies.set(SESSION_COOKIE, sessionId, cookieOptions(url, SESSION_MAX_AGE));
	redirect(303, transaction.redirectTo);
};

async function fetchLogin(accessToken: string): Promise<string> {
	const response = await fetch('https://api.github.com/user', {
		headers: {
			Authorization: `Bearer ${accessToken}`,
			Accept: 'application/vnd.github+json',
			'User-Agent': 'likh'
		}
	});

	if (!response.ok) throw new Error('Could not read the GitHub account');

	return ((await response.json()) as { login: string }).login;
}
