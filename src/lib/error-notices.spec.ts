import { describe, expect, it, vi } from 'vitest';
import { errorNotices, registerErrorNoticeHost } from './error-notices';

describe('errorNotices', () => {
	it('does nothing during server-side rendering', () => {
		const register = vi.fn();

		errorNotices.show('This must not be queued on the server.');
		const unregister = registerErrorNoticeHost(register);

		expect(register).not.toHaveBeenCalled();
		unregister();
	});
});
