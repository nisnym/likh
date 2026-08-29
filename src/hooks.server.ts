import type { Handle } from '@sveltejs/kit';

/**
 * Nothing under `/auth` or `/api` may be cached — not by the browser, not by a
 * proxy, not by Cloudflare.
 *
 * Setting the header here rather than in each handler means it also covers
 * error responses, which SvelteKit generates itself and which would otherwise
 * escape without it.
 */
export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);

	if (event.url.pathname.startsWith('/api/') || event.url.pathname.startsWith('/auth/')) {
		response.headers.set('cache-control', 'no-store');
		response.headers.set('vary', 'cookie');
	}

	return response;
};
