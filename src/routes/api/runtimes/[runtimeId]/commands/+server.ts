import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { listRuntimeSlashCommands } from '$lib/server/runtimes';

export const GET: RequestHandler = ({ params }) => {
	try {
		const commands = listRuntimeSlashCommands(requiredParam(params.runtimeId, 'Runtime'));

		return json({ commands });
	} catch (error) {
		return errorResponse(error);
	}
};
