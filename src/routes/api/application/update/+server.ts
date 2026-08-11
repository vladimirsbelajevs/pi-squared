import { json, type RequestHandler } from '@sveltejs/kit';
import {
	claimApplicationUpdate,
	createApplicationUpdateStream,
	getApplicationRuntimeMode,
	getApplicationUpdateStatus,
	isApplicationUpdateRunning,
	releaseApplicationUpdate,
	selectApplicationUpdateCommand
} from '$lib/server/application-update';
import { errorResponse, isSameOriginRequest } from '$lib/server/http';

export const GET: RequestHandler = () => json(getApplicationUpdateStatus());

export const POST: RequestHandler = ({ request, url }) => {
	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Application update requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	if (getApplicationRuntimeMode() === 'electron') {
		return json({ error: 'Desktop updates are managed by the Electron updater.' }, { status: 501 });
	}

	if (!selectApplicationUpdateCommand()) {
		return json(
			{ error: 'Source checkout updates are not supported on this platform.' },
			{ status: 501 }
		);
	}

	if (isApplicationUpdateRunning() || !claimApplicationUpdate()) {
		return json({ error: 'An application update is already running.' }, { status: 409 });
	}

	try {
		const stream = createApplicationUpdateStream();

		return new Response(stream, {
			headers: {
				'Cache-Control': 'no-cache, no-transform',
				'Content-Type': 'application/x-ndjson; charset=utf-8',
				'X-Accel-Buffering': 'no'
			}
		});
	} catch (error) {
		releaseApplicationUpdate();

		return errorResponse(error, 500);
	}
};
