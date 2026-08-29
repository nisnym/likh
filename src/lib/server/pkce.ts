/**
 * PKCE, per RFC 7636.
 *
 * GitHub still requires the client secret at the token endpoint, so the
 * verifier is not what keeps this flow safe — the secret living only in the
 * Worker is. PKCE is here because it closes the authorization-code interception
 * window regardless, and GitHub accepts it.
 */

const CHALLENGE_METHOD = 'S256';

export { CHALLENGE_METHOD };

export function randomToken(bytes = 32): string {
	return base64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export function createVerifier(): string {
	// 32 random bytes → 43 base64url characters, inside the 43–128 the RFC allows.
	return randomToken(32);
}

export async function challengeFor(verifier: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));

	return base64url(new Uint8Array(digest));
}

function base64url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
