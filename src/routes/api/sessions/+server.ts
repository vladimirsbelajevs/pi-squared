import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse } from '$lib/server/http';
import { listHistoricalSessions } from '$lib/server/pi';
import { listProjects } from '$lib/server/projects';

export const GET: RequestHandler = async ({ url }) => {
	try {
		const projectId = url.searchParams.get('projectId');
		const projects = (await listProjects()).filter(
			(project) => !projectId || project.id === projectId
		);
		const sessions = (await Promise.all(projects.map(listHistoricalSessions)))
			.flat()
			.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
		return json({ sessions });
	} catch (error) {
		return errorResponse(error, 500);
	}
};
