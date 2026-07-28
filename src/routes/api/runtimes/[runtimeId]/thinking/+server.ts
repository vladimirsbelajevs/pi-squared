import { json, type RequestHandler } from '@sveltejs/kit';
import type { ThinkingLevel } from '$lib/contracts';
import { errorResponse, readObject, requiredParam, requiredString } from '$lib/server/http';
import { setRuntimeThinkingLevel } from '$lib/server/runtimes';

const thinkingLevels = new Set<ThinkingLevel>([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
	'max'
]);

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request);
		const thinkingLevel = requiredString(body.thinkingLevel, 'Reasoning level') as ThinkingLevel;
		if (!thinkingLevels.has(thinkingLevel)) throw new Error('Reasoning level is invalid.');
		return json({
			snapshot: setRuntimeThinkingLevel(requiredParam(params.runtimeId, 'Runtime'), thinkingLevel)
		});
	} catch (error) {
		return errorResponse(error);
	}
};
