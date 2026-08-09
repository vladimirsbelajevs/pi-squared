import { goto } from '$app/navigation';

/** Navigate to a URL that has already been resolved with $app/paths. */
export function gotoResolvedHref(href: string): Promise<void> {
	// The workspace supplies a URL already resolved with $app/paths.
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	return goto(href);
}
