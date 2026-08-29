import { describe, expect, it } from 'vitest';
import { findConflicts, hasConflictMarkers, resolveAll } from './conflict';

const CONFLICTED = [
	'Morning notes.',
	'',
	'<<<<<<< this device',
	'wrote on the train',
	'=======',
	'wrote at my desk',
	'>>>>>>> remote',
	'',
	'Evening notes.'
].join('\n');

describe('hasConflictMarkers', () => {
	it('detects a full conflict', () => {
		expect(hasConflictMarkers(CONFLICTED)).toBe(true);
	});

	it('ignores prose that merely mentions arrows', () => {
		expect(hasConflictMarkers('a <<<<<<< b ======= c >>>>>>> d')).toBe(false);
		expect(hasConflictMarkers('======= a horizontal rule of sorts')).toBe(false);
	});

	it('needs all three markers', () => {
		expect(hasConflictMarkers('<<<<<<< mine\ntext\n=======\nother')).toBe(false);
	});
});

describe('findConflicts', () => {
	it('locates the region and both sides', () => {
		const [region] = findConflicts(CONFLICTED);

		expect(region.start).toBe(2);
		expect(region.end).toBe(6);
		expect(region.ours).toEqual(['wrote on the train']);
		expect(region.theirs).toEqual(['wrote at my desk']);
		expect(region.oursLabel).toBe('this device');
		expect(region.theirsLabel).toBe('remote');
	});

	it('finds several regions in one day', () => {
		const text = [CONFLICTED, '<<<<<<< a', 'x', '=======', 'y', '>>>>>>> b'].join('\n');

		expect(findConflicts(text)).toHaveLength(2);
	});

	it('falls back to readable labels when the markers are bare', () => {
		const [region] = findConflicts('<<<<<<<\nmine\n=======\ntheirs\n>>>>>>>');

		expect(region.oursLabel).toBe('this device');
		expect(region.theirsLabel).toBe('remote');
	});

	it('returns nothing for clean text', () => {
		expect(findConflicts('just some prose')).toEqual([]);
	});
});

describe('resolveAll', () => {
	it('keeps our side and drops the markers', () => {
		expect(resolveAll(CONFLICTED, 'ours')).toBe(
			'Morning notes.\n\nwrote on the train\n\nEvening notes.'
		);
	});

	it('keeps their side', () => {
		expect(resolveAll(CONFLICTED, 'theirs')).toBe(
			'Morning notes.\n\nwrote at my desk\n\nEvening notes.'
		);
	});

	it('resolves every region', () => {
		const text = [
			'<<<<<<< a',
			'one',
			'=======',
			'ONE',
			'>>>>>>> b',
			'<<<<<<< a',
			'two',
			'=======',
			'TWO',
			'>>>>>>> b'
		].join('\n');

		expect(resolveAll(text, 'ours')).toBe('one\ntwo');
		expect(hasConflictMarkers(resolveAll(text, 'theirs'))).toBe(false);
	});

	it('leaves clean text untouched', () => {
		expect(resolveAll('nothing to do', 'ours')).toBe('nothing to do');
	});
});
