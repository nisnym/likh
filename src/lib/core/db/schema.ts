import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { AttachmentRecord, DayRecord } from './types';

export const DB_NAME = 'likh';
export const DB_VERSION = 1;

export interface LikhDB extends DBSchema {
	days: {
		key: string;
		value: DayRecord;
		indexes: {
			/** Everything the sync engine needs to push, without a full scan. */
			'by-dirty': number;
			'by-updated': number;
		};
	};
	attachments: {
		key: string;
		value: AttachmentRecord;
		indexes: { 'by-dirty': number; 'by-day': string };
	};
	/**
	 * Loose key/value for sync metadata and settings. Deliberately schemaless so
	 * adding a setting never costs an IndexedDB version bump — a migration is a
	 * risky thing to run against the only copy of someone's journal.
	 */
	kv: {
		key: string;
		value: unknown;
	};
}

let handle: Promise<IDBPDatabase<LikhDB>> | null = null;

export function db(): Promise<IDBPDatabase<LikhDB>> {
	handle ??= openDB<LikhDB>(DB_NAME, DB_VERSION, {
		upgrade(database, oldVersion) {
			if (oldVersion < 1) {
				const days = database.createObjectStore('days', { keyPath: 'date' });
				days.createIndex('by-dirty', 'dirty');
				days.createIndex('by-updated', 'updatedAt');

				const attachments = database.createObjectStore('attachments', { keyPath: 'path' });
				attachments.createIndex('by-dirty', 'dirty');
				attachments.createIndex('by-day', 'day');

				database.createObjectStore('kv');
			}
		},
		blocking() {
			// Another tab is upgrading. Close so it can proceed rather than
			// deadlocking both tabs; the next call reopens.
			void closeDb();
		}
	});

	return handle;
}

export async function closeDb(): Promise<void> {
	const current = handle;
	handle = null;
	if (current) (await current).close();
}

/** Test seam: drop the database and forget the cached handle. */
export async function resetDb(): Promise<void> {
	await closeDb();
	await new Promise<void>((resolve, reject) => {
		const request = indexedDB.deleteDatabase(DB_NAME);
		request.onsuccess = () => resolve();
		request.onerror = () => reject(request.error);
		request.onblocked = () => resolve();
	});
}
