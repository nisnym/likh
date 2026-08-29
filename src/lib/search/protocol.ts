import type { DayKey } from '$lib/core/date/day';

export interface SearchHit {
	date: DayKey;
	score: number;
	/** A short window of the entry around the first match. */
	excerpt: string;
	tags: string[];
}

export type SearchRequest =
	{ type: 'build'; id: number } | { type: 'query'; id: number; text: string; limit: number };

export type SearchResponse =
	| { type: 'ready'; id: number; count: number }
	| { type: 'results'; id: number; hits: SearchHit[] }
	| { type: 'error'; id: number; message: string };
