import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { dayToText } from '../repo/day-file';
import {
	countDirtyDays,
	deleteDay,
	emptyDay,
	getDay,
	listConflictedDays,
	listDirtyDays,
	listWrittenCounts,
	markSynced,
	putDay,
	saveDay
} from './days';
import { getMeta, getSettings, setMeta, setSettings } from './kv';
import { DEFAULT_SETTINGS, type Settings } from './types';
import { resetDb } from './schema';

const DAY = '2026-08-28';

beforeEach(async () => {
	await resetDb();
});

describe('getDay', () => {
	it('returns an empty record for a day never written', async () => {
		expect(await getDay(DAY)).toEqual(emptyDay(DAY));
	});
});

describe('saveDay', () => {
	it('persists the body and marks the day dirty', async () => {
		const saved = await saveDay(DAY, { body: 'Shipped the sync layer.' });

		expect(saved.dirty).toBe(1);
		expect((await getDay(DAY)).body).toBe('Shipped the sync layer.');
	});

	it('keeps the body exactly as typed, trailing space and all', async () => {
		// The editor is bound to this record. Rewriting it here deleted the space
		// out from under the cursor whenever someone paused mid-sentence, and the
		// next word arrived glued to the previous one.
		await saveDay(DAY, { body: 'Shipped the sync layer ' });

		expect((await getDay(DAY)).body).toBe('Shipped the sync layer ');
	});

	it('does not commit a day whose only change is trailing whitespace', async () => {
		// What the normalising above was really protecting: the file is what has
		// to stay stable, and it is serialization that trims it.
		await saveDay(DAY, { body: 'text' });
		await markSynced(DAY, dayToText(await getDay(DAY)), 'sha1');

		await saveDay(DAY, { body: 'text  \n\n' });

		const saved = await getDay(DAY);
		expect(saved.body).toBe('text  \n\n');
		expect(saved.dirty).toBe(0);
	});

	it('does not store an empty day that was never synced', async () => {
		await saveDay(DAY, { body: '   \n' });

		expect(await listWrittenCounts()).toEqual(new Map());
	});

	it('clears dirty when an edit is undone back to the synced text', async () => {
		// The flag is derived from a comparison with the merge base, not set on
		// write — so typing and deleting must not leave a phantom commit behind.
		await saveDay(DAY, { body: 'original' });
		await markSynced(DAY, dayToText(await getDay(DAY)), 'sha1');
		expect((await getDay(DAY)).dirty).toBe(0);

		await saveDay(DAY, { body: 'edited' });
		expect((await getDay(DAY)).dirty).toBe(1);

		await saveDay(DAY, { body: 'original' });
		expect((await getDay(DAY)).dirty).toBe(0);
	});

	it('treats a tag change as a change', async () => {
		await saveDay(DAY, { body: 'text' });
		await markSynced(DAY, dayToText(await getDay(DAY)), 'sha1');

		await saveDay(DAY, { tags: ['work'] });

		expect((await getDay(DAY)).dirty).toBe(1);
	});

	it('leaves updatedAt alone when nothing changed', async () => {
		const first = await saveDay(DAY, { body: 'text' });
		const second = await saveDay(DAY, { body: 'text' });

		expect(second.updatedAt).toBe(first.updatedAt);
	});

	it('flags a body containing conflict markers', async () => {
		await saveDay(DAY, { body: '<<<<<<< this device\nmine\n=======\ntheirs\n>>>>>>> remote' });

		expect((await getDay(DAY)).conflicted).toBe(1);
		expect(await listConflictedDays()).toHaveLength(1);

		await saveDay(DAY, { body: 'resolved' });
		expect((await getDay(DAY)).conflicted).toBe(0);
	});
});

describe('markSynced', () => {
	it('records the merge base and clears dirty', async () => {
		await saveDay(DAY, { body: 'text' });
		const text = dayToText(await getDay(DAY));

		await markSynced(DAY, text, 'abc123');
		const day = await getDay(DAY);

		expect(day.baseText).toBe(text);
		expect(day.baseBlobSha).toBe('abc123');
		expect(day.dirty).toBe(0);
	});

	it('keeps the day dirty when the remote text is something else', async () => {
		await saveDay(DAY, { body: 'local' });
		await markSynced(DAY, dayToText({ ...(await getDay(DAY)), body: 'remote' }), 'abc123');

		expect((await getDay(DAY)).dirty).toBe(1);
	});

	it('ignores a day that does not exist locally', async () => {
		await expect(markSynced('2026-01-01', 'text', 'sha')).resolves.toBeUndefined();
	});
});

describe('queries', () => {
	it('lists dirty days off the index', async () => {
		await saveDay(DAY, { body: 'one' });
		await saveDay('2026-08-29', { body: 'two' });
		await markSynced(DAY, dayToText(await getDay(DAY)), 'sha');

		expect(await countDirtyDays()).toBe(1);
		expect((await listDirtyDays()).map((day) => day.date)).toEqual(['2026-08-29']);
	});

	it('omits empty days from the written list', async () => {
		await saveDay(DAY, { body: 'written' });
		await putDay({ ...emptyDay('2026-08-29'), baseText: '---\ndate: 2026-08-29\n---\n' });

		expect([...(await listWrittenCounts()).keys()]).toEqual([DAY]);
	});

	it('carries the word count of each written day', async () => {
		await saveDay(DAY, { body: 'four words go here' });
		await saveDay('2026-08-29', { body: 'two words' });

		expect(await listWrittenCounts()).toEqual(
			new Map([
				[DAY, 4],
				['2026-08-29', 2]
			])
		);
	});

	it('deletes a day', async () => {
		await saveDay(DAY, { body: 'text' });
		await deleteDay(DAY);

		expect(await listWrittenCounts()).toEqual(new Map());
	});
});

describe('kv', () => {
	it('returns defaults before anything is stored', async () => {
		expect(await getMeta()).toMatchObject({ repo: null, headSha: null });
		expect(await getSettings()).toMatchObject({ ...DEFAULT_SETTINGS });
	});

	it('merges patches over what is already there', async () => {
		await setMeta({ repo: { owner: 'nishant', name: 'journal', branch: 'main' } });
		await setMeta({ headSha: 'abc' });

		const meta = await getMeta();

		expect(meta.repo?.name).toBe('journal');
		expect(meta.headSha).toBe('abc');
	});

	it('fills in settings added after the user last saved', async () => {
		await setSettings({ theme: 'ember' });

		const settings = await getSettings();

		expect(settings.theme).toBe('ember');
		expect(settings.spellcheck).toBe(true);
	});

	it('brings a theme saved under its old name forward', async () => {
		// Written by a release that only had `light` and `dark`. Left as-is it
		// would set `data-theme="dark"`, which now matches no palette at all.
		await setSettings({ theme: 'dark' } as unknown as Partial<Settings>);

		expect((await getSettings()).theme).toBe('ink');
	});
});
