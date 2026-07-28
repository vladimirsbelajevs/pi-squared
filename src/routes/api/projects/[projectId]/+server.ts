import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, optionalString, readObject, requiredParam } from '$lib/server/http';
import { removeProject, updateProject } from '$lib/server/projects';

export const PATCH: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request);
		const project = await updateProject(requiredParam(params.projectId, 'Project'), {
			name: optionalString(body.name, 'Project name')
		});
		return json({ project });
	} catch (error) {
		return errorResponse(error);
	}
};

export const DELETE: RequestHandler = async ({ params }) => {
	try {
		await removeProject(requiredParam(params.projectId, 'Project'));
		return new Response(null, { status: 204 });
	} catch (error) {
		return errorResponse(error);
	}
};
