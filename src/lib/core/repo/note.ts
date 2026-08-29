/**
 * Notes added to a day after it has ended.
 *
 * A past day is a record, and likh will not rewrite one. What it will do is let
 * you add to it — marked with the date you added it, so the file says plainly
 * that the addition came later. The point of a journal is that it holds what
 * you thought at the time; a silent edit years on destroys exactly that, and
 * does it invisibly, since a diff of a file nobody is watching says nothing.
 *
 * The output is ordinary markdown. Nothing parses these headings back — they
 * are for whoever reads the repository, which is usually you, later.
 */

import { formatFixed, type DayKey } from '../date/day';

/** The heading that introduces a note: `**Added 29 August 2026**`. */
export function noteHeading(addedOn: DayKey): string {
	return `**Added ${formatFixed(addedOn)}**`;
}

/**
 * Append a dated note to an entry body. Returns the body unchanged if the note
 * is blank, so an empty composer cannot dirty a day.
 *
 * The blank line above the `---` is load-bearing: directly under a paragraph,
 * `---` is a Setext underline and would turn the last line of the entry into a
 * heading rather than drawing a rule beneath it.
 */
export function appendNote(body: string, text: string, addedOn: DayKey): string {
	const note = text.trim();
	if (note === '') return body;

	const block = `${noteHeading(addedOn)}\n\n${note}`;
	const existing = body.trim();

	// A day nobody wrote in gets the note on its own: there is nothing above for
	// a rule to separate it from.
	return existing === '' ? block : `${existing}\n\n---\n\n${block}`;
}
