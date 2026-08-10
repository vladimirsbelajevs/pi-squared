import { json } from '@sveltejs/kit';

/**
 * Mutating application-management routes are intentionally browser-local APIs.
 * Requiring an exact Origin keeps cross-origin forms and fetches from starting
 * an update or restarting the local server. The Fetch Metadata check catches
 * browsers that provide it even if an Origin header is rewritten by a proxy.
 */
export function isSameOriginRequest(request: Request, expectedOrigin: string): boolean {
	const origin = request.headers.get('origin');
	if (!origin || origin !== expectedOrigin) {
		return false;
	}

	const fetchSite = request.headers.get('sec-fetch-site');

	return fetchSite === null || fetchSite === 'same-origin';
}

export function errorResponse(error: unknown, status = 400) {
	return json(
		{ error: error instanceof Error ? error.message : 'An unexpected server error occurred.' },
		{ status }
	);
}

export async function readObject(
	request: Request,
	maxBytes?: number
): Promise<Record<string, unknown>> {
	const value: unknown =
		maxBytes === undefined ? await request.json() : await readBoundedJson(request, maxBytes);
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected a JSON object.');
	}

	return value as Record<string, unknown>;
}

async function readBoundedJson(request: Request, maxBytes: number): Promise<unknown> {
	const contentLength = request.headers.get('content-length');
	if (contentLength !== null) {
		const declaredLength = Number(contentLength);
		if (!Number.isSafeInteger(declaredLength) || declaredLength < 0) {
			throw new Error('Invalid Content-Length header.');
		}

		if (declaredLength > maxBytes) {
			throw new Error('Request body is too large.');
		}
	}

	const body = request.body;
	if (!body) {
		throw new Error('Expected a JSON object.');
	}

	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			totalBytes += value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				throw new Error('Request body is too large.');
			}

			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
}

export function requiredString(value: unknown, name: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${name} is required.`);
	}

	return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
	if (value === undefined) {
		return undefined;
	}

	if (typeof value !== 'string') {
		throw new Error(`${name} must be a string.`);
	}

	return value;
}

export function requiredParam(value: string | undefined, name: string): string {
	if (!value) {
		throw new Error(`${name} is required.`);
	}

	return value;
}
