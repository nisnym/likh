// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { KVNamespace } from '@cloudflare/workers-types';

declare global {
	namespace App {
		interface Locals {
			/** Set by the auth handlers once a session cookie has been resolved. */
			sessionId?: string;
		}

		interface Platform {
			env: {
				/** OAuth transactions and sessions. `wrangler kv namespace create SESSIONS`. */
				SESSIONS: KVNamespace;
				/** GitHub App client id. Public; safe as a plain var. */
				GITHUB_CLIENT_ID: string;
				/** GitHub App client secret. `wrangler secret put GITHUB_CLIENT_SECRET`. */
				GITHUB_CLIENT_SECRET: string;
				/** The app's slug, used to build the installation URL. */
				GITHUB_APP_SLUG: string;
			};
			context: { waitUntil(promise: Promise<unknown>): void };
		}
	}
}

export {};
