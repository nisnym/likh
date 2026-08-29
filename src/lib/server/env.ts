import { error } from '@sveltejs/kit';

export type Env = App.Platform['env'];

/**
 * The bindings the hosted auth flow needs.
 *
 * Fails with a 503 and a plain explanation rather than a stack trace, because
 * the most likely reader of this message is someone self-hosting likh who
 * hasn't set their secrets yet — or a developer running `vite dev` without a
 * `.dev.vars` file.
 */
export function requireEnv(platform: App.Platform | undefined): Env {
	const env = platform?.env;

	const missing: string[] = [];
	if (!env?.SESSIONS) missing.push('SESSIONS (KV namespace)');
	if (!env?.GITHUB_CLIENT_ID) missing.push('GITHUB_CLIENT_ID');
	if (!env?.GITHUB_CLIENT_SECRET) missing.push('GITHUB_CLIENT_SECRET');

	if (!env || missing.length > 0) {
		throw error(
			503,
			`GitHub sign-in is not configured on this deployment. Missing: ${missing.join(', ')}. ` +
				`See docs/technical.md, or use a personal access token in Settings instead.`
		);
	}

	return env;
}

/** Cookie attributes shared by both cookies we set. */
export function cookieOptions(url: URL, maxAge: number) {
	return {
		path: '/',
		httpOnly: true,
		// Lax, not Strict: the browser arrives here on a top-level redirect back
		// from github.com, and Strict would withhold the cookie on that navigation.
		sameSite: 'lax' as const,
		secure: url.protocol === 'https:',
		maxAge
	};
}
