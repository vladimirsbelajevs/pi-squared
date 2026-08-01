import { browser } from '$app/environment';

type ErrorNoticeHost = (message: string) => void;

let host: ErrorNoticeHost | undefined;
let pending: string[] = [];

/**
 * Registers the mounted notification host and returns a cleanup function.
 * Notifications raised before the host mounts are delivered in FIFO order.
 */
export function registerErrorNoticeHost(register: ErrorNoticeHost): () => void {
	if (!browser) {
		return () => {};
	}

	host = register;
	for (const message of pending) {
		register(message);
	}

	pending = [];

	return () => {
		if (host === register) {
			host = undefined;
		}
	};
}

function messageFor(notice: string | Error): string {
	return notice instanceof Error ? notice.message : notice;
}

/** Client-only facade for displaying application error notifications. */
export const errorNotices = {
	show(notice: string | Error): void {
		if (!browser) {
			return;
		}

		const message = messageFor(notice);
		if (host) {
			host(message);
		} else {
			pending.push(message);
		}
	}
};
