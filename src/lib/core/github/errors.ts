import type { RateLimit } from './types';

/**
 * A failed GitHub request.
 *
 * The predicates matter more than the message: the sync engine branches on
 * "branch doesn't exist yet", "someone else pushed", and "slow down", and those
 * are the three cases that decide whether a push retries, forks, or waits.
 */
export class GitHubError extends Error {
	readonly status: number;
	readonly rateLimit: RateLimit;
	readonly documentationUrl: string | null;

	constructor(
		status: number,
		message: string,
		rateLimit: RateLimit,
		documentationUrl: string | null = null
	) {
		super(message);
		this.name = 'GitHubError';
		this.status = status;
		this.rateLimit = rateLimit;
		this.documentationUrl = documentationUrl;
	}

	get isNotFound(): boolean {
		return this.status === 404;
	}

	/** The ref moved under us — pull and retry, never force. */
	get isRefConflict(): boolean {
		return this.status === 409 || this.status === 422;
	}

	get isAuth(): boolean {
		return this.status === 401;
	}

	/** 403 with no remaining quota, or an explicit 429. */
	get isRateLimited(): boolean {
		return this.status === 429 || (this.status === 403 && this.rateLimit.remaining === 0);
	}

	/** Authenticated, but the token isn't allowed to do this. */
	get isForbidden(): boolean {
		return this.status === 403 && !this.isRateLimited;
	}
}

/** The network failed — offline, DNS, a dropped connection. Never a server verdict. */
export class NetworkError extends Error {
	readonly cause: unknown;

	constructor(message: string, cause: unknown) {
		super(message);
		this.name = 'NetworkError';
		this.cause = cause;
	}
}
