// likh is a local-first app: IndexedDB is the source of truth and the UI must
// boot with no network. Rendering on the server would only produce a shell we
// immediately throw away, so everything is client-rendered and the Worker is
// reserved for the GitHub BFF endpoints.
//
// Prerendering stays off: adapter-cloudflare's `fallback: 'spa'` already emits
// the shell as index.html, and prerendering `/` would just overwrite it with an
// identical (equally empty) page.
export const ssr = false;
export const prerender = false;
export const trailingSlash = 'never';
