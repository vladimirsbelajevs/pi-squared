import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { listProjectRuntimeSlashCommands } from '$lib/server/runtimes';

export const GET: RequestHandler = async ({ params }) => {
	try {
		const commands = await listProjectRuntimeSlashCommands(
			requiredParam(params.projectId, 'Project')
		);

		return json({ commands });
	} catch (error) {
		return errorResponse(error);
	}
};
