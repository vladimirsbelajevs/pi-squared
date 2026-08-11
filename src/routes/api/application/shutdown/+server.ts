import { json, type RequestHandler } from '@sveltejs/kit';
import { disposeAllRuntimes } from '$lib/server/runtimes';
import { isSameOriginRequest } from '$lib/server/http';

const SHUTDOWN_TOKEN_HEADER = 'x-pi-squared-shutdown-token';

export const POST: RequestHandler = async ({ request, url }) => {
	if (process.env.PI_SQUARED_DESKTOP !== '1') {
		return json({ error: 'Desktop shutdown is unavailable in source-web mode.' }, { status: 404 });
	}

	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Shutdown requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	if (request.headers.get(SHUTDOWN_TOKEN_HEADER) !== process.env.PI_SQUARED_SHUTDOWN_TOKEN) {
		return json({ error: 'Invalid shutdown token.' }, { status: 403 });
	}

	await disposeAllRuntimes();

	return json({ ok: true });
};
