/// <reference lib="webworker" />

import MiniSearch from 'minisearch';
import { listAllDays } from '$lib/core/db/days';
import { isEmptyDay } from '$lib/core/repo/day-file';
import type { SearchHit, SearchRequest, SearchResponse } from './protocol';

/**
 * Full-text search, off the main thread.
 *
 * The index lives here rather than in the page so that building it over years
 * of entries never blocks a keystroke. It is rebuilt whenever the client asks,
 * which happens when the search panel opens after an edit — cheaper and far
 * less error-prone than maintaining incremental updates in two places.
 */

const worker = self as unknown as DedicatedWorkerGlobalScope;

let index: MiniSearch<IndexedDay> | null = null;
const bodies = new Map<string, string>();

interface IndexedDay {
	id: string;
	body: string;
	tags: string;
}

async function build(): Promise<number> {
	const days = (await listAllDays()).filter((day) => !isEmptyDay(day));

	bodies.clear();
	const documents = days.map((day) => {
		bodies.set(day.date, day.body);
		return { id: day.date, body: day.body, tags: day.tags.join(' ') };
	});

	index = new MiniSearch<IndexedDay>({
		fields: ['body', 'tags'],
		storeFields: ['id'],
		searchOptions: {
			boost: { tags: 2 },
			prefix: true,
			fuzzy: 0.15
		}
	});
	index.addAll(documents);

	return documents.length;
}

/** A window of text around the first match, so results are scannable. */
function excerpt(body: string, terms: string[]): string {
	const haystack = body.toLowerCase();
	let at = -1;

	for (const term of terms) {
		const found = haystack.indexOf(term.toLowerCase());
		if (found !== -1 && (at === -1 || found < at)) at = found;
	}
	if (at === -1) at = 0;

	const start = Math.max(0, at - 40);
	const end = Math.min(body.length, at + 120);
	const slice = body.slice(start, end).replace(/\s+/g, ' ').trim();

	return `${start > 0 ? '…' : ''}${slice}${end < body.length ? '…' : ''}`;
}

async function query(text: string, limit: number): Promise<SearchHit[]> {
	if (!index) await build();
	if (!index || text.trim() === '') return [];

	return index
		.search(text)
		.slice(0, limit)
		.map((result) => ({
			date: result.id as string,
			score: result.score,
			excerpt: excerpt(bodies.get(result.id as string) ?? '', result.terms),
			tags: []
		}));
}

worker.addEventListener('message', async (event: MessageEvent<SearchRequest>) => {
	const request = event.data;

	try {
		if (request.type === 'build') {
			const count = await build();
			reply({ type: 'ready', id: request.id, count });
		} else {
			const hits = await query(request.text, request.limit);
			reply({ type: 'results', id: request.id, hits });
		}
	} catch (error) {
		reply({
			type: 'error',
			id: request.id,
			message: error instanceof Error ? error.message : String(error)
		});
	}
});

function reply(response: SearchResponse): void {
	worker.postMessage(response);
}
