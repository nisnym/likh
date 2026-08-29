/**
 * Base64 for git blobs.
 *
 * `btoa` only accepts a binary string, and spreading a large array into
 * `String.fromCharCode` blows the argument limit, so bytes go through in
 * chunks. Decoding tolerates the newlines GitHub wraps blob content in.
 */

const CHUNK = 0x8000;

export function toBase64(bytes: Uint8Array): string {
	let binary = '';

	for (let offset = 0; offset < bytes.length; offset += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
	}

	return btoa(binary);
}

export function fromBase64(text: string): Uint8Array {
	// GitHub returns blob content wrapped at 60 characters.
	const binary = atob(text.replace(/\s+/g, ''));
	const bytes = new Uint8Array(binary.length);

	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

	return bytes;
}
