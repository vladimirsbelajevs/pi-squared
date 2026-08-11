import { json, type RequestHandler } from '@sveltejs/kit';

export const GET: RequestHandler = () => json({ ok: true });
