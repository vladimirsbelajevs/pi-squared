import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam } from '$lib/server/http';
import { searchProjectFiles } from '$lib/server/project-files';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const query = url.searchParams.get('q') ?? '';
		const files = await searchProjectFiles(requiredParam(params.projectId, 'Project'), query);

		return json({ files });
	} catch (error) {
		return errorResponse(error);
	}
};
