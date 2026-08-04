import { json, type RequestHandler } from '@sveltejs/kit';
import { validatePromptAttachmentsAtHttpBoundary } from '$lib/server/attachments';
import { errorResponse, optionalString, readObject, requiredParam } from '$lib/server/http';
import { promptRuntime } from '$lib/server/runtimes';

// 20 MiB decoded attachments expand to about 26.7 MiB of base64; leave JSON metadata headroom.
export const _MAX_PROMPT_BODY_BYTES = 32 * 1024 * 1024;

export const POST: RequestHandler = async ({ params, request }) => {
	try {
		const body = await readObject(request, _MAX_PROMPT_BODY_BYTES);
		const streamingBehavior = optionalString(body.streamingBehavior, 'Streaming behavior');
		if (streamingBehavior && streamingBehavior !== 'steer' && streamingBehavior !== 'followUp') {
			throw new Error('Streaming behavior must be “steer” or “followUp”.');
		}

		const result = promptRuntime(
			requiredParam(params.runtimeId, 'Runtime'),
			optionalString(body.text, 'Message') ?? '',
			validatePromptAttachmentsAtHttpBoundary(body.attachments),
			streamingBehavior as 'steer' | 'followUp' | undefined
		);

		return json(result);
	} catch (error) {
		return errorResponse(error);
	}
};
