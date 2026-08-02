import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { disposeRuntime, getRuntimeCheckpoint } from '$lib/server/runtimes';

export const GET: RequestHandler = async ({ params }) => {
	try {
		return json({ checkpoint: getRuntimeCheckpoint(requiredParam(params.runtimeId, 'Runtime')) });
	} catch (error) {
		return errorResponse(error, 404);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await disposeRuntime(requiredParam(params.runtimeId, 'Runtime'));

		return new Response(null, { status: 204 });
	} catch (error) {
		return errorResponse(error);
	}
};
