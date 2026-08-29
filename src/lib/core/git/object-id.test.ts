import { describe, expect, it } from 'vitest';
import { blobSha } from './object-id';

describe('blobSha', () => {
	// These are the SHAs real git produces; `git hash-object` agrees. Pinning
	// them means a change to the framing can't silently desync us from GitHub.
	it('matches git for the empty blob', async () => {
		await expect(blobSha('')).resolves.toBe('e69de29bb2d1d6434b8b29ae775ad8c2e48c5391');
	});

	it('matches git for "hello\\n"', async () => {
		await expect(blobSha('hello\n')).resolves.toBe('ce013625030ba8dba906f756967f9e9ca394464a');
	});

	it('matches git for "what is up, doc?"', async () => {
		await expect(blobSha('what is up, doc?')).resolves.toBe(
			'bd9dbf5aae1a3862dd1526723246b20206e5fc37'
		);
	});

	it('matches git for multi-byte UTF-8', async () => {
		// Devanagari plus an em dash: proves the length in the header counts bytes
		// rather than JavaScript's UTF-16 code units.
		await expect(blobSha('लिख — write\n')).resolves.toBe(
			'4ee6f8fddd237a6a0bd922958ead51f6880113ac'
		);
	});

	it('hashes bytes and the equivalent string identically', async () => {
		const text = 'लिख — write\n';

		expect(await blobSha(text)).toBe(await blobSha(new TextEncoder().encode(text)));
	});

	it('is sensitive to trailing whitespace', async () => {
		expect(await blobSha('a')).not.toBe(await blobSha('a\n'));
	});
});
