import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { searchProjectFiles } from '$lib/server/project-files';

export const GET: RequestHandler = async ({ params, request, url }) => {
	try {
		const query = url.searchParams.get('q') ?? '';
		const result = await searchProjectFiles(
			requiredParam(params.projectId, 'Project'),
			query,
			request.signal
		);

		return json(result);
	} catch (error) {
		return errorResponse(error);
	}
};
