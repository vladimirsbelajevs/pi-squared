import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, optionalString, readObject, requiredString } from '$lib/server/http';
import { addProject, listProjects } from '$lib/server/projects';

export const GET: RequestHandler = async () => {
	try {
		return json({ projects: await listProjects() });
	} catch (error) {
		return errorResponse(error, 500);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const body = await readObject(request);
		const project = await addProject({
			cwd: requiredString(body.cwd, 'Project directory'),
			name: optionalString(body.name, 'Project name')
		});
		return json({ project }, { status: 201 });
	} catch (error) {
		return errorResponse(error);
	}
};
