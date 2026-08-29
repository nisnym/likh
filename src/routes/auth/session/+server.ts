import { json, type RequestHandler } from '@sveltejs/kit';
import { installUrl } from '$lib/server/github-oauth';
import { SESSION_COOKIE, readSession } from '$lib/server/session';

/**
 * Who, if anyone, is signed in.
 *
 * Deliberately does not use `requireEnv`: a deployment with no GitHub App
 * configured should report "not connected" so the app stays usable offline,
 * rather than 503-ing the first thing the client asks on boot.
 */
export const GET: RequestHandler = async ({ platform, cookies }) => {
	const env = platform?.env;

	if (!env?.SESSIONS || !env.GITHUB_CLIENT_ID) {
		return json({ connected: false, configured: false, login: null, installUrl: null });
	}

	const session = await readSession(env.SESSIONS, cookies.get(SESSION_COOKIE));

	return json({
		connected: session !== null,
		configured: true,
		login: session?.login ?? null,
		installUrl: env.GITHUB_APP_SLUG ? installUrl(env) : null
	});
};
