/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `likh-${version}`;

/**
 * With `fallback: 'spa'` every route resolves to the same shell document, so
 * caching that one entry is what makes a cold start work with no network.
 */
const SHELL = '/';
const PRECACHE = [SHELL, ...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(PRECACHE);
			// Journals are single-user and the app carries no cross-version state in
			// the cache, so there is nothing to be gained by making someone close
			// every tab before an update lands.
			await sw.skipWaiting();
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) {
				if (key !== CACHE) await caches.delete(key);
			}
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// The GitHub BFF is never cached: a stale commit SHA or a replayed token
	// exchange would be far worse than an offline error.
	if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) return;

	event.respondWith(respond(request));
});

async function respond(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);

	// Any navigation resolves to the shell; the client router owns the URL space.
	if (request.mode === 'navigate') {
		const shell = await cache.match(SHELL);
		if (shell) return shell;
	}

	// Build assets are content-hashed, so a hit is always current.
	const hit = await cache.match(request);
	if (hit) return hit;

	try {
		const response = await fetch(request);
		if (response.ok && response.type === 'basic') {
			void cache.put(request, response.clone());
		}
		return response;
	} catch (error) {
		const shell = await cache.match(SHELL);
		if (shell) return shell;
		throw error;
	}
}
