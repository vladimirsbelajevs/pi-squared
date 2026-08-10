import { json, type RequestHandler } from '@sveltejs/kit';
import {
	getApplicationUpdateReminder,
	recordApplicationUpdateReminder
} from '$lib/server/application-update-reminder';
import { errorResponse, isSameOriginRequest } from '$lib/server/http';

export const GET: RequestHandler = async () => {
	try {
		return json(await getApplicationUpdateReminder());
	} catch (error) {
		return errorResponse(error, 500);
	}
};

export const POST: RequestHandler = async ({ request, url }) => {
	if (!isSameOriginRequest(request, url.origin)) {
		return json(
			{ error: 'Application update reminder requests must originate from this local application.' },
			{ status: 403 }
		);
	}

	try {
		return json(await recordApplicationUpdateReminder());
	} catch (error) {
		return errorResponse(error, 500);
	}
};
