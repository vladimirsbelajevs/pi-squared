import { describe, expect, it } from 'vitest';
import {
	GATEWAY_AUTH_HEADER,
	isLoopbackRequestAuthenticated,
	RENDERER_COOKIE
} from './loopback-auth.js';

describe('loopback authentication', () => {
	const environment = {
		PI_SQUARED_GATEWAY_SECRET: 'gateway',
		PI_SQUARED_RENDERER_SECRET: 'renderer'
	};

	it('accepts either independent internal credential', () => {
		expect(
			isLoopbackRequestAuthenticated(new Headers({ [GATEWAY_AUTH_HEADER]: 'gateway' }), environment)
		).toBe(true);
		expect(
			isLoopbackRequestAuthenticated(
				new Headers({ Cookie: `${RENDERER_COOKIE}=renderer` }),
				environment
			)
		).toBe(true);
	});

	it('rejects missing, malformed, and wrong-length credentials', () => {
		expect(isLoopbackRequestAuthenticated(new Headers(), environment)).toBe(false);
		expect(
			isLoopbackRequestAuthenticated(
				new Headers({ [GATEWAY_AUTH_HEADER]: 'gatewayx' }),
				environment
			)
		).toBe(false);
		expect(
			isLoopbackRequestAuthenticated(new Headers({ Cookie: 'other=renderer' }), environment)
		).toBe(false);
	});
});
