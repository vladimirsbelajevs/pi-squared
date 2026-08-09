import { json, type RequestHandler } from '@sveltejs/kit';
import { errorResponse, requiredParam, requiredString } from '$lib/server/http';
import { resolveProject } from '$lib/server/projects';
import {
	listSubagentRuns,
	readSubagentTimeline,
	SUBAGENT_STATUS_FRESH_MS
} from '$lib/server/subagents';

export const GET: RequestHandler = async ({ params, url }) => {
	try {
		const project = await resolveProject(requiredParam(params.projectId, 'Project'));
		const sessionId = requiredString(url.searchParams.get('sessionId'), 'Session');
		const runs = await listSubagentRuns(project, sessionId);
		const childSessionId = url.searchParams.get('childSessionId');
		if (!childSessionId) {
			return json({ runs, freshForMs: SUBAGENT_STATUS_FRESH_MS });
		}

		if (!runs.some((candidate) => candidate.childSessionId === childSessionId)) {
			throw new Error('Child session is not available for this parent session.');
		}

		return json(await readSubagentTimeline(project, sessionId, childSessionId));
	} catch (error) {
		return errorResponse(error, 404);
	}
};
