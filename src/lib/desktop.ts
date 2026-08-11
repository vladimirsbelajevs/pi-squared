import { isPiSquaredDesktopApi, type PiSquaredDesktopApi } from './desktop-contract';

export function getDesktopApi(): PiSquaredDesktopApi | undefined {
	if (typeof window === 'undefined') {
		return undefined;
	}

	const api = window.piSquaredDesktop;

	return isPiSquaredDesktopApi(api) ? api : undefined;
}
