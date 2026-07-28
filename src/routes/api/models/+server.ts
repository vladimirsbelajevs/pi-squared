import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse } from '$lib/server/http';
import { listAvailableModels } from '$lib/server/pi';

export const GET: RequestHandler = async () => {
	try {
		return json({ models: await listAvailableModels() });
	} catch (error) {
		return errorResponse(error, 500);
	}
};
