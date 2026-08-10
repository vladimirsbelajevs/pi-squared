import { json, type RequestHandler } from '@sveltejs/kit';
import {
	claimApplicationUpdate,
	createApplicationUpdateStream,
	getApplicationUpdateStatus,
	getSupportedApplicationPlatform,
	isApplicationUpdateRunning,
	releaseApplicationUpdate
} from '$lib/server/application-update';
import { errorResponse, isSameOriginRequest } from '$lib/server/http';

export const GET: RequestHandler = async () => {
	try {
		return json(await getApplicationUpdateStatus());
	} catch (error) {
		return errorResponse(error, 500);
	}
};

export const POST: RequestHandler = ({ request, url }) => {
	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Application update requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	if (!getSupportedApplicationPlatform()) {
		return json(
			{ error: 'Application updates are not supported on this platform.' },
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
