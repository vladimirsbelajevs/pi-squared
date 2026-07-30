import { json, type RequestHandler } from '@sveltejs/kit';
import { validatePromptAttachments } from '$lib/attachments';
import { errorResponse, optionalString, readObject, requiredParam } from '$lib/server/http';
import { promptRuntime } from '$lib/server/runtimes';

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request);
		const streamingBehavior = optionalString(body.streamingBehavior, 'Streaming behavior');
		if (streamingBehavior && streamingBehavior !== 'steer' && streamingBehavior !== 'followUp') {
			throw new Error('Streaming behavior must be “steer” or “followUp”.');
		}
		const result = promptRuntime(
			requiredParam(params.runtimeId, 'Runtime'),
			optionalString(body.text, 'Message') ?? '',
			validatePromptAttachments(body.attachments),
			streamingBehavior as 'steer' | 'followUp' | undefined
		);
		return json(result);
	} catch (error) {
		return errorResponse(error);
	}
};
