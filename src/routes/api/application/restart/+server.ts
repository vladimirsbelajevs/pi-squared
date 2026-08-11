import { json, type RequestHandler } from '@sveltejs/kit';
import { getApplicationRuntimeMode } from '$lib/server/application-update';
import { errorResponse, isSameOriginRequest } from '$lib/server/http';

export const POST: RequestHandler = ({ request, url }) => {
	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Application restart requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	try {
		return json(
			{
				error:
					getApplicationRuntimeMode() === 'electron'
						? 'Use Restart and install from the desktop update dialog.'
						: 'Stop the foreground server and run it again to load the updated build.'
			},
			{ status: 501 }
		);
	} catch (error) {
		return errorResponse(error, 500);
	}
};
