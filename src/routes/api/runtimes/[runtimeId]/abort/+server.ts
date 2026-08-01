import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { abortRuntime } from '$lib/server/runtimes';

export const POST: RequestHandler = async ({ params }) => {
	try {
		await abortRuntime(requiredParam(params.runtimeId, 'Runtime'));

		return json({ ok: true });
	} catch (error) {
		return errorResponse(error);
	}
};
