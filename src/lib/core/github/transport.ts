import { NetworkError } from './errors';

/**
 * How a request reaches GitHub.
 *
 * The two auth modes differ *only* here. Everything above this line — every
 * endpoint, every bit of error handling — is shared, so the BFF path and the
 * personal-token path cannot drift apart in behaviour.
 */
export interface Transport {
	readonly mode: 'bff' | 'pat';
	request(path: string, init: RequestInit): Promise<Response>;
}

const API = 'https://api.github.com';

/**
 * Hosted mode: calls go to our own Worker, which holds the token. The cookie is
 * httpOnly, so no credential is reachable from JavaScript here.
 */
export const bffTransport: Transport = {
	mode: 'bff',
	async request(path, init) {
		return guard(() => fetch(`/api/gh${path}`, { ...init, credentials: 'include' }));
	}
};

/**
 * Self-hosted mode: the browser talks to GitHub directly with a fine-grained
 * token the user pasted. No Worker required, at the cost of the token living in
 * the origin's storage.
 */
export function patTransport(token: string): Transport {
	return {
		mode: 'pat',
		async request(path, init) {
			const headers = new Headers(init.headers);
			headers.set('Authorization', `Bearer ${token}`);

			return guard(() => fetch(`${API}${path}`, { ...init, headers }));
		}
	};
}

/** Turn a transport-level failure into something callers can distinguish. */
async function guard(run: () => Promise<Response>): Promise<Response> {
	try {
		return await run();
	} catch (error) {
		throw new NetworkError('Could not reach GitHub', error);
	}
}
