/**
 * What the browser is allowed to ask the Worker to do with the user's token.
 *
 * The GitHub App is already scoped to `contents: read/write` on repositories
 * the user picked, so this is defence in depth rather than the only barrier.
 * It exists because the proxy turns an httpOnly token into something any script
 * on the page can *use*, even though it cannot read it — so the blast radius of
 * an XSS should be the endpoints likh actually needs, and nothing else.
 *
 * Adding a feature that needs a new endpoint means adding it here, on purpose.
 */

const OWNER = '[A-Za-z0-9._-]+';
const REPO = '[A-Za-z0-9._-]+';
const SHA = '[0-9a-f]{4,40}';
/** Branch names may contain slashes and dots, but never a `..` segment. */
const BRANCH = '[^?#]+';

const RULES: Array<{ methods: string[]; pattern: RegExp }> = [
	{ methods: ['GET'], pattern: new RegExp('^/user$') },
	{ methods: ['GET'], pattern: new RegExp('^/user/installations$') },
	{ methods: ['GET'], pattern: new RegExp('^/user/installations/\\d+/repositories$') },
	{ methods: ['GET'], pattern: new RegExp('^/user/repos$') },

	{ methods: ['GET'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}$`) },
	{ methods: ['GET'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/ref/heads/${BRANCH}$`) },
	{ methods: ['GET'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/commits/${SHA}$`) },
	{ methods: ['GET'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/trees/${SHA}$`) },
	{ methods: ['GET'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/blobs/${SHA}$`) },

	{ methods: ['POST'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/blobs$`) },
	{ methods: ['POST'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/trees$`) },
	{ methods: ['POST'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/commits$`) },
	{ methods: ['POST'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/refs$`) },

	{ methods: ['PATCH'], pattern: new RegExp(`^/repos/${OWNER}/${REPO}/git/refs/heads/${BRANCH}$`) }
];

export function isAllowed(method: string, path: string): boolean {
	if (!path.startsWith('/')) return false;

	// Reject traversal before any pattern gets a chance to be clever about it.
	if (path.includes('..')) return false;
	// A backslash or an encoded slash can smuggle a segment past a `[^/]` class.
	if (path.includes('\\') || /%2f/i.test(path) || /%5c/i.test(path)) return false;

	const upper = method.toUpperCase();

	return RULES.some((rule) => rule.methods.includes(upper) && rule.pattern.test(path));
}
