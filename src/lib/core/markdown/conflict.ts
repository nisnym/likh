/**
 * Git-style conflict markers.
 *
 * When a three-way merge can't reconcile two versions of a day, likh writes the
 * same markers git would rather than picking a winner. They're ugly on purpose:
 * both versions of your words are still there, and the app can point at them.
 */

export const OURS_MARKER = '<<<<<<<';
export const SPLIT_MARKER = '=======';
export const THEIRS_MARKER = '>>>>>>>';

const OURS_LINE = /^<{7}(?: |$)/m;
const SPLIT_LINE = /^={7}$/m;
const THEIRS_LINE = /^>{7}(?: |$)/m;

export function hasConflictMarkers(text: string): boolean {
	return OURS_LINE.test(text) && SPLIT_LINE.test(text) && THEIRS_LINE.test(text);
}

export interface ConflictRegion {
	/** Line index (0-based) of the `<<<<<<<` line. */
	start: number;
	/** Line index of the `>>>>>>>` line. */
	end: number;
	ours: string[];
	theirs: string[];
	oursLabel: string;
	theirsLabel: string;
}

/** Locate each conflict region so the UI can offer "keep mine" / "keep theirs". */
export function findConflicts(text: string): ConflictRegion[] {
	const lines = text.split('\n');
	const regions: ConflictRegion[] = [];

	let start = -1;
	let split = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		if (line.startsWith(OURS_MARKER)) {
			start = i;
			split = -1;
		} else if (line === SPLIT_MARKER && start !== -1) {
			split = i;
		} else if (line.startsWith(THEIRS_MARKER) && start !== -1 && split !== -1) {
			regions.push({
				start,
				end: i,
				ours: lines.slice(start + 1, split),
				theirs: lines.slice(split + 1, i),
				oursLabel: lines[start].slice(OURS_MARKER.length).trim() || 'this device',
				theirsLabel: lines[i].slice(THEIRS_MARKER.length).trim() || 'remote'
			});
			start = -1;
			split = -1;
		}
	}

	return regions;
}

/** Resolve every conflict region by taking one side wholesale. */
export function resolveAll(text: string, side: 'ours' | 'theirs'): string {
	const lines = text.split('\n');
	const regions = findConflicts(text);
	if (regions.length === 0) return text;

	const output: string[] = [];
	let cursor = 0;

	for (const region of regions) {
		output.push(...lines.slice(cursor, region.start));
		output.push(...(side === 'ours' ? region.ours : region.theirs));
		cursor = region.end + 1;
	}
	output.push(...lines.slice(cursor));

	return output.join('\n');
}
