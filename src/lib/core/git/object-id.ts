/**
 * Git object identity.
 *
 * A blob's SHA is `sha1("blob " + byteLength + "\0" + bytes)` — it hashes the
 * *content*, with no reference to the path or the commit. Computing it locally
 * lets the sync engine know a file's identity on the remote without asking:
 * after a push it can record the new base SHA directly instead of re-fetching
 * the whole tree, and on a pull it can tell "changed" from "same" by comparison.
 */

const encoder = new TextEncoder();

export async function blobSha(content: Uint8Array | string): Promise<string> {
	const bytes = typeof content === 'string' ? encoder.encode(content) : content;
	const header = encoder.encode(`blob ${bytes.length}\0`);

	const framed = new Uint8Array(header.length + bytes.length);
	framed.set(header, 0);
	framed.set(bytes, header.length);

	return hex(await crypto.subtle.digest('SHA-1', framed));
}

export async function sha1Hex(input: Uint8Array | string): Promise<string> {
	// Copied into a fresh buffer: `crypto.subtle` will not accept a view that
	// might be backed by a SharedArrayBuffer.
	const bytes = typeof input === 'string' ? encoder.encode(input) : Uint8Array.from(input);

	return hex(await crypto.subtle.digest('SHA-1', bytes));
}

function hex(buffer: ArrayBuffer): string {
	return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
