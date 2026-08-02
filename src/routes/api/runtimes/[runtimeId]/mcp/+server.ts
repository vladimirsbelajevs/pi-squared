import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, readObject, requiredParam, requiredString } from '$lib/server/http';
import { setRuntimeMcpServerEnabled } from '$lib/server/runtimes';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request);
		if (typeof body.enabled !== 'boolean') {
			throw new Error('MCP server state must be a boolean.');
		}

		return json({
			checkpoint: await setRuntimeMcpServerEnabled(
				requiredParam(params.runtimeId, 'Runtime'),
				requiredString(body.serverName, 'MCP server'),
				body.enabled
			)
		});
	} catch (error) {
		return errorResponse(error);
	}
};
