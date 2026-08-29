import { redirect, type RequestHandler } from '@sveltejs/kit';
import { cookieOptions, requireEnv } from '$lib/server/env';
import { authorizeUrl } from '$lib/server/github-oauth';
import { challengeFor, createVerifier, randomToken } from '$lib/server/pkce';
import { OAUTH_COOKIE, safeRedirect, startTransaction } from '$lib/server/session';

export const GET: RequestHandler = async ({ platform, url, cookies }) => {
	const env = requireEnv(platform);

	const verifier = createVerifier();
	const state = randomToken(16);
	const transaction = await startTransaction(env.SESSIONS, {
		state,
		verifier,
		redirectTo: safeRedirect(url.searchParams.get('return'))
	});

	// The verifier stays in KV; the browser only carries an opaque handle to it.
	cookies.set(OAUTH_COOKIE, transaction, cookieOptions(url, 600));

	redirect(
		302,
		authorizeUrl(env, {
			state,
			challenge: await challengeFor(verifier),
			redirectUri: `${url.origin}/auth/callback`
		})
	);
};
