import adapter from '@sveltejs/adapter-cloudflare';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},

			adapter: adapter({
				// `assets.not_found_handling: "single-page-application"` in wrangler.jsonc
				// makes the adapter emit an SPA fallback regardless, but be explicit.
				fallback: 'spa'
				//
				// `platformProxy` is deliberately NOT enabled. It boots a Miniflare
				// instance inside `vite dev`/`vite preview`, and concurrent instances
				// deadlock on one SQLite lock — leaving orphaned `workerd` processes
				// that break every later run.
				//
				// The cost is that `platform.env` is undefined under `vite dev`, so
				// hosted GitHub sign-in reports itself unconfigured there. Everything
				// else — writing, offline, search, personal-token mode — works. Use
				// `pnpm cf:preview` (wrangler dev) to work on the OAuth flow; that is
				// the real Worker runtime anyway.
			})
		})
	]
});
