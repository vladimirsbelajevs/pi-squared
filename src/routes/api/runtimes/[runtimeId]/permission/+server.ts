import { json, type RequestHandler } from '@sveltejs/kit';
import type { PermissionResponse } from '$lib/contracts';
import { errorResponse, readObject, requiredParam, requiredString } from '$lib/server/http';
import { respondToPermissionRequest } from '$lib/server/runtimes';

function parseResponse(body: Record<string, unknown>): PermissionResponse {
	const requestId = requiredString(body.requestId, 'Permission request');
	if (body.cancelled === true) {
		return { requestId, cancelled: true };
	}

	if (typeof body.value === 'string') {
		return { requestId, value: body.value };
	}

	if (typeof body.confirmed === 'boolean') {
		return { requestId, confirmed: body.confirmed };
	}

	throw new Error('A permission response must approve, deny, select an option, or cancel.');
}

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		respondToPermissionRequest(
			requiredParam(params.runtimeId, 'Runtime'),
			parseResponse(await readObject(request))
		);

		return json({ ok: true });
	} catch (error) {
		return errorResponse(error);
	}
};
