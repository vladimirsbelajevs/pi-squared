import { describe, expect, it } from 'vitest';
import { exactOrigin, isTrustedAppUrl, isTrustedFrame } from './security.js';

describe('Electron URL and IPC trust checks', () => {
	it('compares parsed origins instead of accepting a startsWith prefix', () => {
		expect(exactOrigin('http://127.0.0.1:4321/workspace')).toBe('http://127.0.0.1:4321');
		expect(isTrustedAppUrl('http://127.0.0.1:4321.evil.test/', 'http://127.0.0.1:4321')).toBe(
			false
		);
		expect(isTrustedAppUrl('http://127.0.0.1:4321/chat/project', 'http://127.0.0.1:4321')).toBe(
			true
		);
	});

	it('requires the invoking frame to be the current trusted main frame', () => {
		const trusted = {
			senderId: 7,
			expectedSenderId: 7,
			frameUrl: 'http://127.0.0.1:4321/chat',
			mainFrameUrl: 'http://127.0.0.1:4321/chat',
			windowUrl: 'http://127.0.0.1:4321/chat',
			serverUrl: 'http://127.0.0.1:4321'
		};
		expect(isTrustedFrame(trusted)).toBe(true);
		expect(isTrustedFrame({ ...trusted, senderId: 8 })).toBe(false);
		expect(isTrustedFrame({ ...trusted, frameUrl: 'http://127.0.0.1:4321.evil.test/chat' })).toBe(
			false
		);
		expect(isTrustedFrame({ ...trusted, mainFrameUrl: 'http://127.0.0.1:4321/settings' })).toBe(
			false
		);
	});
});
