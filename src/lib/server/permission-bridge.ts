import { randomUUID } from 'node:crypto';
import type { ExtensionUIContext } from '@earendil-works/pi-coding-agent';
import type { PermissionRequest, PermissionResponse, RuntimeEvent } from '$lib/contracts';

type PendingPermission = {
	request: PermissionRequest;
	resolve: (response: PermissionResponse) => void;
	signal?: AbortSignal;
	abort?: () => void;
};

type RequestOptions = { signal?: AbortSignal };

/** Bridges Pi extension dialogs to the browser's per-runtime approval UI. */
export class PermissionBridge {
	#pending = new Map<string, PendingPermission>();

	constructor(private readonly publish: (event: RuntimeEvent) => void) {}

	get pendingRequests(): PermissionRequest[] {
		return [...this.#pending.values()].map(({ request }) => ({
			...request,
			...(request.options ? { options: [...request.options] } : {})
		}));
	}

	get extensionUI(): ExtensionUIContext {
		return {
			select: (title, options, requestOptions) => this.select(title, options, requestOptions),
			confirm: (title, message, requestOptions) => this.confirm(title, message, requestOptions),
			input: (title, placeholder, requestOptions) => this.input(title, placeholder, requestOptions),
			notify: (message) => this.publish({ type: 'notice', message }),
			onTerminalInput: () => () => undefined,
			setStatus: () => undefined,
			setWorkingMessage: () => undefined,
			setWorkingVisible: () => undefined,
			setWorkingIndicator: () => undefined,
			setHiddenThinkingLabel: () => undefined,
			setWidget: () => undefined,
			setFooter: () => undefined,
			setHeader: () => undefined,
			setTitle: () => undefined,
			custom: async () => {
				this.publish({
					type: 'notice',
					message: 'This extension dialog is only available in the Pi terminal UI.'
				});

				return undefined;
			},
			pasteToEditor: () => undefined,
			setEditorText: () => undefined,
			getEditorText: () => '',
			editor: async () => undefined,
			addAutocompleteProvider: () => undefined,
			setEditorComponent: () => undefined,
			getEditorComponent: () => undefined,
			theme: undefined as never,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({ success: false, error: 'Themes are managed by the browser harness.' }),
			getToolsExpanded: () => false,
			setToolsExpanded: () => undefined
		} as ExtensionUIContext;
	}

	async select(
		title: string,
		options: string[],
		requestOptions?: RequestOptions
	): Promise<string | undefined> {
		const response = await this.#request(
			{ method: 'select', title, options },
			requestOptions?.signal
		);

		return 'value' in response ? response.value : undefined;
	}

	async confirm(title: string, message: string, requestOptions?: RequestOptions): Promise<boolean> {
		const response = await this.#request(
			{ method: 'confirm', title, message },
			requestOptions?.signal
		);

		return 'confirmed' in response ? response.confirmed : false;
	}

	async input(
		title: string,
		placeholder: string | undefined,
		requestOptions?: RequestOptions
	): Promise<string | undefined> {
		const response = await this.#request(
			{ method: 'input', title, placeholder },
			requestOptions?.signal
		);

		return 'value' in response ? response.value : undefined;
	}

	respond(response: PermissionResponse): void {
		const pending = this.#pending.get(response.requestId);
		if (!pending) {
			throw new Error('This permission request is no longer pending.');
		}

		if (!this.#isValidResponse(pending.request, response)) {
			throw new Error('The response does not match the pending permission request.');
		}

		this.#settle(response.requestId, response);
	}

	cancelAll(): void {
		for (const requestId of this.#pending.keys()) {
			this.#settle(requestId, { requestId, cancelled: true });
		}
	}

	#request(
		request: Omit<PermissionRequest, 'id'>,
		signal?: AbortSignal
	): Promise<PermissionResponse> {
		const id = randomUUID();
		const pendingRequest = { ...request, id };

		return new Promise((resolve) => {
			const abort = () => this.#settle(id, { requestId: id, cancelled: true });
			this.#pending.set(id, { request: pendingRequest, resolve, signal, abort });
			if (signal?.aborted) {
				abort();

				return;
			}

			signal?.addEventListener('abort', abort, { once: true });
			this.publish({ type: 'permission_request', request: pendingRequest });
		});
	}

	#settle(requestId: string, response: PermissionResponse): void {
		const pending = this.#pending.get(requestId);
		if (!pending) {
			return;
		}

		this.#pending.delete(requestId);
		if (pending.signal && pending.abort) {
			pending.signal.removeEventListener('abort', pending.abort);
		}

		this.publish({ type: 'permission_resolved', requestId });
		pending.resolve(response);
	}

	#isValidResponse(request: PermissionRequest, response: PermissionResponse): boolean {
		if ('cancelled' in response) {
			return response.cancelled;
		}

		if (request.method === 'select') {
			return 'value' in response && request.options?.includes(response.value) === true;
		}

		if (request.method === 'confirm') {
			return 'confirmed' in response;
		}

		return 'value' in response;
	}
}
