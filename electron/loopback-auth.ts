import { timingSafeEqual } from 'node:crypto';

export const RENDERER_COOKIE = 'pi-squared-renderer';
export const GATEWAY_AUTH_HEADER = 'x-pi-squared-internal-auth';

export function constantTimeSecretEquals(
	expected: string | undefined,
	supplied: string | undefined
): boolean {
	if (!expected || !supplied) {
		return false;
	}

	const left = Buffer.from(expected);
	const right = Buffer.from(supplied);

	return left.length === right.length && timingSafeEqual(left, right);
}

export function parseCookieHeader(
	header: string | null | undefined,
	name: string
): string | undefined {
	if (!header) {
		return undefined;
	}

	for (const part of header.split(';')) {
		const separator = part.indexOf('=');
		if (separator === -1) {
			continue;
		}

		const cookieName = part.slice(0, separator).trim();
		if (cookieName === name) {
			return part.slice(separator + 1).trim();
		}
	}

	return undefined;
}

export function stripCookies(
	header: string | null | undefined,
	names: ReadonlySet<string>
): string | undefined {
	if (!header) {
		return undefined;
	}

	const kept = header
		.split(';')
		.map((part) => part.trim())
		.filter((part) => {
			const separator = part.indexOf('=');
			if (separator === -1) {
				return true;
			}

			return !names.has(part.slice(0, separator).trim());
		})
		.join('; ');

	return kept || undefined;
}

export function isLoopbackRequestAuthenticated(
	headers: { get(name: string): string | null },
	environment: NodeJS.ProcessEnv = process.env
): boolean {
	return (
		constantTimeSecretEquals(
			environment.PI_SQUARED_GATEWAY_SECRET,
			headers.get(GATEWAY_AUTH_HEADER) ?? undefined
		) ||
		constantTimeSecretEquals(
			environment.PI_SQUARED_RENDERER_SECRET,
			parseCookieHeader(headers.get('cookie'), RENDERER_COOKIE)
		)
	);
}

export function loopbackAuthHeaders(secret: string): Record<string, string> {
	return { [GATEWAY_AUTH_HEADER]: secret };
}
