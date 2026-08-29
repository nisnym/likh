import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { fromBase64, toBase64 } from './base64';

describe('base64', () => {
	it('round-trips bytes', () => {
		const bytes = new Uint8Array([0, 1, 127, 128, 255, 42]);

		expect(fromBase64(toBase64(bytes))).toEqual(bytes);
	});

	it('handles buffers larger than the argument limit', () => {
		// Spreading this into String.fromCharCode in one call would throw.
		const big = new Uint8Array(200_000).map((_, i) => i % 256);

		expect(fromBase64(toBase64(big))).toEqual(big);
	});

	it('round-trips arbitrary bytes', () => {
		fc.assert(
			fc.property(fc.uint8Array({ maxLength: 2000 }), (bytes) => {
				expect(fromBase64(toBase64(bytes))).toEqual(bytes);
			})
		);
	});
});
