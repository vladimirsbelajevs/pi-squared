import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, readObject, requiredParam, requiredString } from '$lib/server/http';
import { setRuntimeModel } from '$lib/server/runtimes';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request);

		return json({
			snapshot: await setRuntimeModel(requiredParam(params.runtimeId, 'Runtime'), {
				provider: requiredString(body.provider, 'Provider'),
				id: requiredString(body.id, 'Model')
			})
		});
	} catch (error) {
		return errorResponse(error);
	}
};
