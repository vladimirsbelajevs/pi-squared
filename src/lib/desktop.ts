import type { PiSquaredDesktopApi } from './desktop-contract';

export function getDesktopApi(): PiSquaredDesktopApi | undefined {
	if (typeof window === 'undefined') {
		return undefined;
	}

	return window.piSquaredDesktop;
}
