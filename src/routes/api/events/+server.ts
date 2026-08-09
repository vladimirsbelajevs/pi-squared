import type { RequestHandler } from '@sveltejs/kit';
import { eventBroker } from '$lib/server/event-broker';

const encoder = new TextEncoder();

function formatEvent(event: unknown, id?: string): Uint8Array {
	return encoder.encode(
		`${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`
	);
}

export const GET: RequestHandler = ({ request, url }) => {
	const lastEventId =
		request.headers.get('last-event-id') ?? url.searchParams.get('lastEventId') ?? undefined;
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(': pi-squared stream\n\n'));
			unsubscribe = eventBroker.subscribe(
				lastEventId,
				(event) => controller.enqueue(formatEvent(event, event.id)),
				(control) => controller.enqueue(formatEvent(control))
			);
			heartbeat = setInterval(() => controller.enqueue(encoder.encode(': keepalive\n\n')), 20_000);
		},
		cancel() {
			unsubscribe?.();
			if (heartbeat) {
				clearInterval(heartbeat);
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'Content-Type': 'text/event-stream',
			'X-Accel-Buffering': 'no'
		}
	});
};
