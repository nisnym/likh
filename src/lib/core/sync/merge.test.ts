import { describe, expect, it } from 'vitest';
import { hasConflictMarkers, findConflicts } from '../markdown/conflict';
import { dayToText } from '../repo/day-file';
import { mergeDay } from './merge';

const DATE = '2026-08-28';

function file(body: string, tags: string[] = [], extra: string[] = []): string {
	return dayToText({ date: DATE, body, tags, extra });
}

function local(body: string, baseText: string | null, tags: string[] = [], extra: string[] = []) {
	return { body, tags, extra, baseText };
}

describe('mergeDay', () => {
	it('merges edits to different parts of a day', () => {
		const base = 'morning notes\nafternoon notes\nevening notes';

		const result = mergeDay({
			date: DATE,
			local: local('MORNING\nafternoon notes\nevening notes', file(base)),
			remoteText: file('morning notes\nafternoon notes\nEVENING')
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('MORNING\nafternoon notes\nEVENING');
	});

	it('keeps both sides when the same lines were edited', () => {
		const base = 'one\ntwo\nthree';

		const result = mergeDay({
			date: DATE,
			local: local('one\nMINE\nthree', file(base)),
			remoteText: file('one\nTHEIRS\nthree')
		});

		expect(result.clean).toBe(false);
		expect(hasConflictMarkers(result.body)).toBe(true);
		// Neither version is lost.
		expect(result.body).toContain('MINE');
		expect(result.body).toContain('THEIRS');

		const [region] = findConflicts(result.body);
		expect(region.ours).toEqual(['MINE']);
		expect(region.theirs).toEqual(['THEIRS']);
		expect(region.oursLabel).toBe('this device');
		expect(region.theirsLabel).toBe('remote');
	});

	it('takes the remote when this device changed nothing', () => {
		const base = 'unchanged here';

		const result = mergeDay({
			date: DATE,
			local: local(base, file(base)),
			remoteText: file('written elsewhere')
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('written elsewhere');
	});

	it('keeps the local text when the remote changed nothing', () => {
		const base = 'unchanged here';

		const result = mergeDay({
			date: DATE,
			local: local('written here', file(base)),
			remoteText: file(base)
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('written here');
	});

	it('does not conflict when both sides made the same edit', () => {
		const result = mergeDay({
			date: DATE,
			local: local('agreed', file('before')),
			remoteText: file('agreed')
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('agreed');
	});

	it('conflicts when a day was written independently on two devices', () => {
		// No base: neither side ever saw the other's version.
		const result = mergeDay({
			date: DATE,
			local: local('wrote on the train', null),
			remoteText: file('wrote at my desk')
		});

		expect(result.clean).toBe(false);
		expect(result.body).toContain('wrote on the train');
		expect(result.body).toContain('wrote at my desk');
	});

	it('fast-forwards an empty local day with no base', () => {
		const result = mergeDay({
			date: DATE,
			local: local('', null),
			remoteText: file('from the other device')
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('from the other device');
	});

	it('merges an insertion at the end without conflict', () => {
		const base = 'first thought';

		const result = mergeDay({
			date: DATE,
			local: local('first thought\nsecond thought', file(base)),
			remoteText: file(base)
		});

		expect(result.clean).toBe(true);
		expect(result.body).toBe('first thought\nsecond thought');
	});

	it('uses the labels it is given', () => {
		const result = mergeDay({
			date: DATE,
			local: local('a', file('base')),
			remoteText: file('b'),
			localLabel: 'phone',
			remoteLabel: 'github'
		});

		expect(result.body).toContain('<<<<<<< phone');
		expect(result.body).toContain('>>>>>>> github');
	});
});

describe('tags', () => {
	it('unions tags added on both sides', () => {
		const result = mergeDay({
			date: DATE,
			local: local('text', file('text', ['work']), ['work', 'ideas']),
			remoteText: file('text', ['work', 'travel'])
		});

		expect(result.clean).toBe(true);
		expect(result.tags).toEqual(['work', 'ideas', 'travel']);
	});

	it('takes the remote tags when this device did not touch them', () => {
		const result = mergeDay({
			date: DATE,
			local: local('text', file('text', ['work']), ['work']),
			remoteText: file('text', ['work', 'travel'])
		});

		expect(result.tags).toEqual(['work', 'travel']);
	});

	it('never drops a tag on merge, even one removed remotely', () => {
		// Losing a label silently is worse than keeping one too many.
		const result = mergeDay({
			date: DATE,
			local: local('text', file('text', ['work', 'ideas']), ['work', 'ideas', 'new']),
			remoteText: file('text', ['work'])
		});

		expect(result.tags).toContain('ideas');
		expect(result.tags).toContain('new');
	});
});

describe('unknown frontmatter', () => {
	it('accepts remote changes to fields this device did not touch', () => {
		const base = file('text', [], ['mood: 5']);

		const result = mergeDay({
			date: DATE,
			local: local('text edited', base, [], ['mood: 5']),
			remoteText: file('text', [], ['mood: 9'])
		});

		expect(result.extra).toEqual(['mood: 9']);
	});

	it('keeps local changes to unknown fields', () => {
		const base = file('text', [], ['mood: 5']);

		const result = mergeDay({
			date: DATE,
			local: local('text', base, [], ['mood: 7']),
			remoteText: file('text', [], ['mood: 9'])
		});

		expect(result.extra).toEqual(['mood: 7']);
	});
});
