/// <reference types="vitest/config" />
import { timingSafeEqual } from 'node:crypto';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import adapter from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import type { Plugin } from 'vite';

const GATEWAY_AUTH_HEADER = 'x-pi-squared-internal-auth';
const RENDERER_COOKIE = 'pi-squared-renderer';

function sameSecret(expected: string | undefined, supplied: string | undefined): boolean {
	if (!expected || !supplied) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(supplied);
	return a.length === b.length && timingSafeEqual(a, b);
}

function cookieValue(header: string | undefined, name: string): string | undefined {
	return header
		?.split(';')
		.map((part) => part.trim())
		.map((part) => {
			const index = part.indexOf('=');
			return index === -1 ? undefined : [part.slice(0, index).trim(), part.slice(index + 1).trim()];
		})
		.find((part) => part?.[0] === name)?.[1];
}

function authenticated(request: { headers: Record<string, string | string[] | undefined> }): boolean {
	const gateway = Array.isArray(request.headers[GATEWAY_AUTH_HEADER])
		? request.headers[GATEWAY_AUTH_HEADER][0]
		: request.headers[GATEWAY_AUTH_HEADER];
	const cookie = Array.isArray(request.headers.cookie)
		? request.headers.cookie.join('; ')
		: request.headers.cookie;
	return (
		sameSecret(process.env.PI_SQUARED_GATEWAY_SECRET, gateway) ||
		sameSecret(process.env.PI_SQUARED_RENDERER_SECRET, cookieValue(cookie, RENDERER_COOKIE))
	);
}

function electronDevAuthPlugin(): Plugin | undefined {
	if (process.env.PI_SQUARED_DESKTOP !== '1') return undefined;
	return {
		name: 'pi-squared-electron-dev-auth',
		enforce: 'pre',
		configureServer(server) {
			server.middlewares.use((request, response, next) => {
				if (authenticated(request)) {
					next();
					return;
				}
				response.statusCode = 401;
				response.setHeader('Cache-Control', 'no-store');
				response.end('Unauthorized');
			});
			server.httpServer?.prependListener('upgrade', (request, socket) => {
				if (authenticated(request)) return;
				socket.write('HTTP/1.1 401 Unauthorized\\r\\nConnection: close\\r\\n\\r\\n');
				socket.destroy();
			});
		}
	};
}

export default {
	plugins: [
		electronDevAuthPlugin(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter()
		})
	].filter((plugin): plugin is Plugin => !!plugin),
	test: {
		expect: {
			requireAssertions: true
		},
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'client',
					browser: {
						enabled: true,
						provider: playwright(),
						instances: [{
							browser: 'chromium',
							headless: true
						}]
					},
					include: ['src/**/*.svelte.{test,spec}.{js,ts}'],
					exclude: ['src/lib/server/**']
				}
			},
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'electron/**/*.spec.ts'],
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}']
				}
			}
		]
	}
};
