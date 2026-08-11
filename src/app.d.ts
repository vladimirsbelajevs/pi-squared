// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
import type { PiSquaredDesktopApi } from '$lib/desktop-contract';

declare global {
	interface Window {
		piSquaredDesktop?: PiSquaredDesktopApi;
	}

	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
