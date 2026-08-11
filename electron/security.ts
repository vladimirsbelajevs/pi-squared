export function exactOrigin(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const url = new URL(value);
		if (url.protocol !== 'http:' && url.protocol !== 'https:') {
			return undefined;
		}

		return url.origin;
	} catch {
		return undefined;
	}
}

export function isTrustedAppUrl(
	candidate: string | undefined,
	serverUrl: string | undefined
): boolean {
	const expectedOrigin = exactOrigin(serverUrl);

	return expectedOrigin !== undefined && exactOrigin(candidate) === expectedOrigin;
}

export interface TrustedFrameInput {
	senderId: number;
	expectedSenderId: number;
	frameUrl: string | undefined;
	mainFrameUrl: string | undefined;
	windowUrl: string | undefined;
	serverUrl: string | undefined;
}

export function isTrustedFrame(input: TrustedFrameInput): boolean {
	return (
		input.senderId === input.expectedSenderId &&
		input.frameUrl !== undefined &&
		input.frameUrl === input.mainFrameUrl &&
		input.frameUrl === input.windowUrl &&
		isTrustedAppUrl(input.frameUrl, input.serverUrl)
	);
}
