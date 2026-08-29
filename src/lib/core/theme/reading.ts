/**
 * How wide and how big the writing surface is.
 *
 * Both land on `<html>` as custom properties rather than as classes, so the
 * editor's CodeMirror theme and the plain-text surface it swaps in for can read
 * the same value without either of them knowing the setting exists.
 */

export type LineWidth = 'narrow' | 'regular' | 'wide' | 'full';

/**
 * The writing column, gutters included.
 *
 * `regular` is the default and is deliberately wider than a book's measure:
 * this is a text field you type into, and a column sized purely for reading
 * comfort reads as a cramped box when you are the one filling it.
 */
export const LINE_WIDTHS: Record<LineWidth, string> = {
	narrow: '34rem',
	regular: '42rem',
	wide: '52rem',
	full: '100%'
};

export const LINE_WIDTH_LABELS: Record<LineWidth, string> = {
	narrow: 'Narrow',
	regular: 'Regular',
	wide: 'Wide',
	full: 'Full'
};

export const DEFAULT_LINE_WIDTH: LineWidth = 'regular';

/** Body text size in px. The default is one step up from a UI font: this is
 *  the only text on the screen that matters, and it should look like it. */
export const TEXT_SIZES = [15, 17, 19, 22, 25] as const;

export const DEFAULT_TEXT_SIZE = 19;

export function isLineWidth(value: unknown): value is LineWidth {
	return typeof value === 'string' && value in LINE_WIDTHS;
}
