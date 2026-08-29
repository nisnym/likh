import { debounce } from '$lib/core/util/debounce';
import type { SearchHit, SearchRequest, SearchResponse } from './protocol';

const QUERY_DEBOUNCE_MS = 120;
const LIMIT = 30;

/**
 * Client for the search worker.
 *
 * The index is marked stale whenever an entry is saved and rebuilt on the next
 * search rather than on every keystroke — search is opened occasionally, and a
 * rebuild is far cheaper to get right than incremental updates kept in sync
 * across two threads.
 */
class SearchStore {
	open = $state(false);
	text = $state('');
	hits = $state<SearchHit[]>([]);
	busy = $state(false);
	selected = $state(0);

	#worker: Worker | undefined;
	#seq = 0;
	#pending = new Map<number, (response: SearchResponse) => void>();
	#stale = true;

	#run = debounce((text: string) => {
		void this.#query(text);
	}, QUERY_DEBOUNCE_MS);

	/** Called after an edit lands, so the next search sees it. */
	invalidate(): void {
		this.#stale = true;
	}

	show(): void {
		this.open = true;
		this.selected = 0;
		if (this.text) this.#run(this.text);
	}

	hide(): void {
		this.open = false;
		this.text = '';
		this.hits = [];
	}

	setText(text: string): void {
		this.text = text;
		this.selected = 0;

		if (text.trim() === '') {
			this.#run.cancel();
			this.hits = [];
			this.busy = false;
			return;
		}

		this.busy = true;
		this.#run(text);
	}

	move(delta: number): void {
		if (this.hits.length === 0) return;
		this.selected = (this.selected + delta + this.hits.length) % this.hits.length;
	}

	async #query(text: string): Promise<void> {
		try {
			if (this.#stale) {
				await this.#send({ type: 'build', id: this.#next() });
				this.#stale = false;
			}

			const response = await this.#send({
				type: 'query',
				id: this.#next(),
				text,
				limit: LIMIT
			});

			// A newer keystroke may have superseded this query while it was running.
			if (text !== this.text) return;

			this.hits = response.type === 'results' ? response.hits : [];
		} catch {
			this.hits = [];
		} finally {
			if (text === this.text) this.busy = false;
		}
	}

	#next(): number {
		return ++this.#seq;
	}

	#ensureWorker(): Worker {
		if (this.#worker) return this.#worker;

		const worker = new Worker(new URL('./search-worker.ts', import.meta.url), { type: 'module' });

		// Attached once, at construction — re-adding it per request would resolve
		// each promise as many times as there had been calls.
		worker.addEventListener('message', (event: MessageEvent<SearchResponse>) => {
			const resolve = this.#pending.get(event.data.id);
			if (resolve) {
				this.#pending.delete(event.data.id);
				resolve(event.data);
			}
		});

		this.#worker = worker;
		return worker;
	}

	#send(request: SearchRequest): Promise<SearchResponse> {
		const worker = this.#ensureWorker();

		return new Promise((resolve) => {
			this.#pending.set(request.id, resolve);
			worker.postMessage(request);
		});
	}
}

export const search = new SearchStore();
