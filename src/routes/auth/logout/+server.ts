import { json, type RequestHandler } from '@sveltejs/kit';
import { requireEnv } from '$lib/server/env';
import { SESSION_COOKIE, deleteSession } from '$lib/server/session';

export const POST: RequestHandler = async ({ platform, cookies }) => {
	const env = requireEnv(platform);

	await deleteSession(env.SESSIONS, cookies.get(SESSION_COOKIE));
	cookies.delete(SESSION_COOKIE, { path: '/' });

	return json({ connected: false });
};
