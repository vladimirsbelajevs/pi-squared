import { describe, expect, it, vi } from 'vitest';
import {
	registerApplicationUpdateStarter,
	requestApplicationUpdate
} from './application-updater.svelte.js';

describe('application update controller seam', () => {
	it('forwards a Settings request to the global updater host', () => {
		const start = vi.fn();
		const unregister = registerApplicationUpdateStarter(start);

		expect(requestApplicationUpdate()).toBe(true);
		expect(start).toHaveBeenCalledOnce();

		unregister();
		expect(requestApplicationUpdate()).toBe(false);
	});
});
