import { json } from '@sveltejs/kit';

export function errorResponse(error: unknown, status = 400) {
	return json(
		{ error: error instanceof Error ? error.message : 'An unexpected server error occurred.' },
		{ status }
	);
}

export async function readObject(request: Request): Promise<Record<string, unknown>> {
	const value: unknown = await request.json();
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Expected a JSON object.');
	}
	return value as Record<string, unknown>;
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
