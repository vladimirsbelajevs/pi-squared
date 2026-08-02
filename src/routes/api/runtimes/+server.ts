import { json, type RequestHandler } from '@sveltejs/kit';
import type { ModelOption, ThinkingLevel } from '$lib/contracts';
import { errorResponse, optionalString, readObject, requiredString } from '$lib/server/http';
import { cleanupIdleRuntimes, createRuntime } from '$lib/server/runtimes';

function isModel(value: unknown): value is ModelOption {
	if (!value || typeof value !== 'object') {
		return false;
	}

	const model = value as Record<string, unknown>;

	return typeof model.provider === 'string' && typeof model.id === 'string';
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		await cleanupIdleRuntimes();
		const body = await readObject(request);
		const mode = requiredString(body.mode, 'Mode');
		if (mode !== 'new' && mode !== 'resume') {
			throw new Error('Mode must be “new” or “resume”.');
		}

		const model = body.model;
		if (model !== undefined && !isModel(model)) {
			throw new Error('Model is invalid.');
		}

		const checkpoint = await createRuntime({
			mode,
			projectId: requiredString(body.projectId, 'Project'),
			sessionId: optionalString(body.sessionId, 'Session'),
			model,
			thinkingLevel: optionalString(body.thinkingLevel, 'Reasoning level') as
				ThinkingLevel | undefined
		});

		return json({ checkpoint }, { status: 201 });
	} catch (error) {
		return errorResponse(error);
	}
};
