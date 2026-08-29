import { json, type RequestHandler } from '@sveltejs/kit';
import { isAllowed } from '$lib/server/allowlist';
import { requireEnv } from '$lib/server/env';
import { freshSession } from '$lib/server/github-oauth';
import { SESSION_COOKIE, readSession } from '$lib/server/session';

/**
 * The GitHub proxy.
 *
 * The browser never sees a token: it sends its session cookie here, and the
 * Worker attaches the credential. That means an XSS on the page can *use* the
 * user's GitHub access but cannot steal it — the difference between a bad day
 * and a token loose on the internet for six months.
 *
 * Every request is checked against a narrow allowlist, and the response is
 * rebuilt from scratch so nothing from upstream (cookies, redirects, auth
 * challenges) is reflected back to the page by accident.
 */

const API_ORIGIN = 'https://api.github.com';

/** Sent upstream; anything else the browser attached is dropped. */
const FORWARD_REQUEST_HEADERS = ['accept', 'content-type', 'x-github-api-version'];

/** Returned to the page; the sync engine needs the rate-limit picture. */
const FORWARD_RESPONSE_HEADERS = [
	'content-type',
	'retry-after',
	'x-ratelimit-limit',
	'x-ratelimit-remaining',
	'x-ratelimit-reset',
	'x-ratelimit-used',
	'x-ratelimit-resource',
	'x-github-request-id'
];

const handler: RequestHandler = async ({ platform, params, request, url, cookies }) => {
	const env = requireEnv(platform);

	const sessionId = cookies.get(SESSION_COOKIE);
	const stored = await readSession(env.SESSIONS, sessionId);
	if (!stored || !sessionId) {
		return unauthorized('Not connected to GitHub.');
	}

	const session = await freshSession(env.SESSIONS, env, sessionId, stored);
	if (!session) {
		// The refresh token is gone or revoked; make the browser stop retrying.
		cookies.delete(SESSION_COOKIE, { path: '/' });
		return unauthorized('Your GitHub session expired. Please connect again.');
	}

	const path = `/${params.path ?? ''}`;
	if (!isAllowed(request.method, path)) {
		return json(
			{ message: `likh does not proxy ${request.method} ${path}` },
			{ status: 403, headers: { 'cache-control': 'no-store' } }
		);
	}

	const target = new URL(path + url.search, API_ORIGIN);
	// Belt and braces: `isAllowed` should have made this impossible, but a URL
	// that resolved off-origin must never be fetched with the user's token.
	if (target.origin !== API_ORIGIN) {
		return json({ message: 'Bad request path' }, { status: 400 });
	}

	const headers = new Headers();
	for (const name of FORWARD_REQUEST_HEADERS) {
		const value = request.headers.get(name);
		if (value) headers.set(name, value);
	}
	headers.set('Authorization', `Bearer ${session.accessToken}`);
	headers.set('User-Agent', 'likh');
	if (!headers.has('accept')) headers.set('Accept', 'application/vnd.github+json');

	const hasBody = request.method !== 'GET' && request.method !== 'HEAD';

	const upstream = await fetch(target, {
		method: request.method,
		headers,
		// Buffered rather than streamed: request bodies here are a tree or a
		// base64 blob, and streaming would need duplex support for no gain.
		body: hasBody ? await request.arrayBuffer() : undefined,
		redirect: 'follow'
	});

	const responseHeaders = new Headers({ 'cache-control': 'no-store' });
	for (const name of FORWARD_RESPONSE_HEADERS) {
		const value = upstream.headers.get(name);
		if (value) responseHeaders.set(name, value);
	}

	return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
};

function unauthorized(message: string): Response {
	return json({ message }, { status: 401, headers: { 'cache-control': 'no-store' } });
}

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
