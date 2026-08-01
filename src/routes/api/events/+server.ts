import type { RequestHandler } from '@sveltejs/kit';
import { eventBroker } from '$lib/server/event-broker';

const encoder = new TextEncoder();

function formatEvent(event: unknown, id?: number): Uint8Array {
	return encoder.encode(
		`${id === undefined ? '' : `id: ${id}\n`}data: ${JSON.stringify(event)}\n\n`
	);
}

export const GET: RequestHandler = ({ request, url }) => {
	const lastEventHeader = request.headers.get('last-event-id');
	const headerEventId =
		lastEventHeader && /^\d+$/.test(lastEventHeader) ? Number(lastEventHeader) : undefined;
	const queryEventId = url.searchParams.get('lastEventId');
	const lastEventId =
		headerEventId ??
		(queryEventId && /^\d+$/.test(queryEventId) ? Number(queryEventId) : undefined);
	let unsubscribe: (() => void) | undefined;
	let heartbeat: ReturnType<typeof setInterval> | undefined;

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(encoder.encode(': pi-squared stream\n\n'));
			unsubscribe = eventBroker.subscribe(lastEventId, (event) =>
				controller.enqueue(formatEvent(event, event.id))
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
