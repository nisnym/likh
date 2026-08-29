import { describe, expect, it } from 'vitest';
import { CHALLENGE_METHOD, challengeFor, createVerifier, randomToken } from './pkce';

describe('pkce', () => {
	it('matches the worked example in RFC 7636', async () => {
		// Appendix B of the spec. Pinning it means a change to the encoding
		// (padding, base64 vs base64url) fails here rather than at GitHub.
		await expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).resolves.toBe(
			'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
		);
	});

	it('announces S256, the only method GitHub accepts', () => {
		expect(CHALLENGE_METHOD).toBe('S256');
	});

	it('produces verifiers of a length the spec allows', () => {
		const verifier = createVerifier();

		expect(verifier.length).toBeGreaterThanOrEqual(43);
		expect(verifier.length).toBeLessThanOrEqual(128);
	});

	it('emits url-safe characters only', () => {
		for (let i = 0; i < 50; i++) {
			expect(createVerifier()).toMatch(/^[A-Za-z0-9\-._~]+$/);
		}
	});

	it('does not repeat itself', () => {
		const seen = new Set(Array.from({ length: 200 }, () => randomToken(16)));

		expect(seen.size).toBe(200);
	});
});
