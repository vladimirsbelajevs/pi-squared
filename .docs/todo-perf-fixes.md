Yes. I reviewed the current `main` branch. This is a static code review rather than a browser profile, but there are several concrete performance problems.

One correction to my earlier update: **assistant text deltas do not rebuild the entire `timeline` derived array**. Tool-stream updates do. Assistant deltas still trigger the two more expensive paths: live Markdown rendering and `contentKey` serialization.

## Findings

| Pitfall                                                | Status                  |   Severity |
| ------------------------------------------------------ | ----------------------- | ---------: |
| Parse/highlight the whole streaming response per chunk | Present                 |       High |
| No event batching or frame throttling                  | Present                 |       High |
| Expensive scroll-change detection per chunk            | Present                 |       High |
| Raw stream separate from finalized history             | Mostly handled          |       Good |
| Virtualize long conversations                          | Missing                 |     Medium |
| Lazy-load tool output/diffs                            | Missing                 |     Medium |
| Store/index messages by ID                             | Partial                 |     Medium |
| Broad reactive session invalidation                    | Partial, but overstated | Low–medium |

## 1. The complete response is reparsed on every streamed chunk

This is the largest obvious rendering problem.

Every incoming `assistant_delta` immediately appends to reactive state:

```ts
chat.streamText += event.text ?? '';
chat.streamThinking += event.thinking ?? '';
```

There is no debounce, animation-frame buffer, or chunk accumulator.

`ChatTimeline.svelte` then executes:

```svelte
{@const markdown = renderAssistantMarkdown(chat.streamText)}
<div class="message-markdown">{@html markdown}</div>
```

for the growing response.

`renderAssistantMarkdown()` invokes `markdown.render(text)`, and MarkdownIt synchronously invokes Highlight.js for each recognized fenced code block. Therefore, as the response grows, the UI repeatedly reparses all prior Markdown and re-highlights complete code fences.

For a long answer containing code, this creates roughly this pattern:

```text
render 100 characters
render 200 characters
render 300 characters
...
render entire response
```

The cumulative work can become disproportionately expensive.

### Recommended fix

Separate:

- `streamText`: authoritative accumulated raw text
- `streamRenderedHtml`: UI representation updated less frequently

Use one of these approaches:

1. **Fastest:** display streaming output as escaped/plain text and run MarkdownIt once when the message finishes.
2. **Better appearance:** render Markdown every 50–100 ms, but disable syntax highlighting until completion.
3. **More complex:** incrementally process only stable completed blocks.

I would use option 2. Rendering once per animation frame is still unnecessarily frequent for Markdown; 50–100 ms is visually smooth enough.

## 2. Pi events are delivered one by one all the way to reactive state

The server maps every Pi `text_delta` and `thinking_delta` to an individual `assistant_delta`. The broker immediately invokes every subscriber, and the SSE endpoint immediately calls `controller.enqueue()` for each event. There is no batching anywhere in this pipeline.

That means the browser may receive and process many updates within one display frame.

### Recommended fix

Batch on the client. Keep the SSE protocol granular for replay correctness, but accumulate deltas before mutating Svelte state:

```ts
type PendingDelta = {
	text: string;
	thinking: string;
	frame?: number;
};

const pendingDeltas = new Map<string, PendingDelta>();

function queueAssistantDelta(chat: ChatTab, text = '', thinking = '') {
	let pending = pendingDeltas.get(chat.id);

	if (!pending) {
		pending = { text: '', thinking: '' };
		pendingDeltas.set(chat.id, pending);
	}

	pending.text += text;
	pending.thinking += thinking;

	if (pending.frame !== undefined) {
		return;
	}

	pending.frame = requestAnimationFrame(() => {
		const current = pendingDeltas.get(chat.id);
		if (!current) return;

		chat.streamText += current.text;
		chat.streamThinking += current.thinking;

		current.text = '';
		current.thinking = '';
		current.frame = undefined;
	});
}
```

Then throttle Markdown rendering separately. Frame-batching state updates and throttling parsing solve related but distinct problems.

You also need to flush or discard pending deltas carefully when an authoritative snapshot arrives.

## 3. `contentKey` is unnecessarily expensive

This may be as damaging as Markdown rendering, particularly in chats containing images.

On every stream update, the route constructs a new object and applies `JSON.stringify()` to:

- all message IDs;
- all attachment metadata;
- attachment `data`;
- pending attachment `data`;
- the complete growing `streamText`;
- thinking text;
- every streamed tool result.

Including attachment `data` is particularly bad because it may be a large base64 string. None of that data needs to be serialized merely to detect whether scrolling should follow new content.

The resulting key then drives pre/post-render layout reads and writes:

```ts
scrollHeight
scrollTop
clientHeight
scrollTop = scrollHeight
```

This path runs for every changed key.

### Recommended fix

Delete the serialized content key.

Maintain explicit revisions instead:

```ts
interface ChatTab {
	// ...
	contentRevision: number;
}
```

Increment it only when a batched visual update is flushed:

```ts
chat.streamText += bufferedText;
chat.contentRevision++;
```

Better still, make scrolling event-driven:

- Track whether the user is pinned using a passive `scroll` listener.
- Put a sentinel element at the bottom of the timeline.
- After a batched stream render, call `bottomSentinel.scrollIntoView()`.
- Use `ResizeObserver` if asynchronous content such as images can change height.

At minimum, attachment `data` must not appear in `contentKey`.

## 4. Raw streaming and finalized history are separated correctly

This part is good.

`ChatTab` has separate `streamText`, `streamThinking`, and `streamTools` fields rather than mutating the authoritative snapshot message.

When a snapshot arrives, it becomes authoritative and the streaming fields are reset.

So you do not have the architectural mistake of repeatedly rebuilding finalized message objects from partial text.

The remaining issue is that raw stream text is **immediately converted into finalized-quality Markdown HTML on every delta**. The state separation exists; the rendering separation does not.

## 5. There is no conversation virtualization

The entire timeline is rendered through:

```svelte
{#each timeline as entry (entry.id)}
```

Every historical message, attachment, reasoning section, tool group, and result remains in the DOM.

There is also no virtualization dependency in `package.json`.

This is unlikely to matter for 20–50 ordinary messages, but coding-agent sessions can accumulate:

- hundreds of entries;
- very large tool outputs;
- multiple code blocks;
- shell logs;
- attachments.

### Recommended sequence

Do not jump immediately to a complicated variable-height virtualizer. Start with:

```css
.message-entry,
.tool-group {
	content-visibility: auto;
	contain-intrinsic-size: auto 240px;
}
```

Then measure.

If long sessions remain slow, either:

- render the most recent N turns and provide “Load earlier messages”;
- virtualize at the conversational-turn level rather than individual tool/message entries.

Turn-level virtualization is less fragile because assistant messages and their associated tools stay together.

## 6. Collapsed tool results are not lazily rendered

The tool groups use `<details>`, but the contained `<pre>` and its potentially enormous text are created even while the details element is closed:

```svelte
<details class="tool-detail tool-result">
	<summary>Result</summary>
	<pre>{tool.result?.text || tool.stream?.text || 'No output.'}</pre>
</details>
```

`<details>` only controls visibility. It does not defer DOM creation.

### Recommended fix

Move a tool into a separate keyed component with local open state:

```svelte
<script lang="ts">
	let { text }: { text: string } = $props();
	let open = $state(false);
</script>

<details bind:open>
	<summary>Result</summary>

	{#if open}
		<pre>{text}</pre>
	{/if}
</details>
```

For very large output, also render only the final portion initially:

```text
Showing last 500 lines · Show complete output
```

This matters more than lazily importing the component itself.

## 7. IDs are used for DOM keying, but state is not indexed

You correctly key timeline and tool loops by ID. That prevents Svelte from blindly replacing every DOM row.

However, timeline construction repeatedly scans arrays:

```ts
items.find(...)
chat.streamTools.find(...)
calledIds.includes(...)
```

This happens while walking all items and tool calls.

For `N` entries and `T` tool calls, parts of this become approximately `O(N × T)`. Tool-stream updates cause the timeline derivation to run again because it reads `chat.streamTools`.

### Recommended fix

Build indexes once per derivation:

```ts
const calledIds = new Set<string>();
const resultByToolCallId = new Map<string, ChatItem>();
const streamByToolCallId = new Map(
	chat.streamTools.map((tool) => [tool.id, tool])
);

for (const item of items) {
	for (const call of item.toolCalls ?? []) {
		calledIds.add(call.id);
	}

	if (item.role === 'tool' && item.toolCallId) {
		resultByToolCallId.set(item.toolCallId, item);
	}
}
```

Then lookups are constant-time:

```ts
result: resultByToolCallId.get(call.id),
stream: streamByToolCallId.get(call.id)
```

You do not necessarily need a globally normalized Redux-style message store. Local indexes inside the timeline derivation are enough initially.

## 8. The broad `ChatTab` object is not itself a serious problem

Passing the full `chat` object into `ChatTimeline` looks coarse, but Svelte 5 proxy reactivity can track nested properties. Merely using one object does not mean every field invalidates the whole component.

The actual coarse boundaries are:

- the large `timeline` derived computation;
- full live Markdown generation;
- serialized `contentKey`;
- eager tool-result DOM;
- the absence of batching.

I would not spend time splitting every `ChatTab` property into separate stores. That would add complexity without addressing the measured hot paths.

Extracting a keyed `MessageRow.svelte` component is still useful, primarily to isolate finalized Markdown rendering and cache it by message ID/text—not because the `ChatTab` object is inherently wrong.

## Recommended implementation order

1. **Remove `contentKey` JSON serialization**, especially attachment data.
2. **Batch assistant deltas with `requestAnimationFrame`.**
3. **Throttle live Markdown rendering and skip highlighting while streaming.**
4. **Index tool calls/results with `Map` and `Set`.**
5. **Lazy-mount tool output when expanded.**
6. Add `content-visibility`.
7. Only implement real virtualization after profiling a representative long session.

The first three should produce the largest visible improvement. I would fix them before adding further UI features.

Yes. **Your current UI contains the exact streaming-render pitfall we discussed, plus an additional scrolling implementation that may be even more expensive.** Pi may be token-efficient and fast, but the frontend can erase that advantage once responses become long.

This is a static review of the current `main` branch, not a runtime Chrome profile.

## Verdict against the checklist

| Concern                                           | Status                         |                Priority |
| ------------------------------------------------- | ------------------------------ | ----------------------: |
| Parse/highlight the entire response on each token | **Present**                    |                Critical |
| No batching of Pi stream events                   | **Present**                    |                Critical |
| Expensive broadly reactive scroll tracking        | **Present**                    |                Critical |
| Separate streaming state from finalized messages  | **Mostly handled correctly**   |                    Good |
| Virtualize long conversations                     | **Not implemented**            |                  Medium |
| Lazy-render tool output/details                   | **Not implemented**            | High with large outputs |
| Store/index messages by ID                        | **Not implemented end-to-end** |                  Medium |
| Entire app invalidated by one session mutation    | **Mostly not a problem**       |                     Low |

## 1. Critical: full Markdown and syntax highlighting on every text delta

The complete path is:

```text
Pi text_delta
  → assistant_delta SSE event
  → EventSource callback
  → chat.streamText += delta
  → renderAssistantMarkdown(chat.streamText)
  → markdown-it parses the complete accumulated response
  → Highlight.js highlights every completed code block
  → Svelte replaces the generated HTML
```

`normalizePiEvent()` emits an individual `assistant_delta` for each Pi `text_delta`. The SSE endpoint immediately sends each event, and the client immediately mutates `chat.streamText`; there is no batching stage.

Then `ChatTimeline.svelte` does this for the live message:

```svelte
{@const markdown = renderAssistantMarkdown(chat.streamText)}
<div class="message-markdown">{@html markdown}</div>
```

`renderAssistantMarkdown()` synchronously calls `markdown.render()`, whose fence handler synchronously invokes Highlight.js.

That produces approximately quadratic work in response length when deltas are small:

```text
parse 100 chars
parse 110 chars
parse 120 chars
...
parse 20,000 chars
```

It is particularly bad during generated code because the increasingly large code fence can be highlighted repeatedly.

### Recommended fix

The strongest implementation is:

- Keep accumulating raw stream text.
- Update visible stream text at most once per animation frame, or every 25–50 ms.
- Render the streaming response as escaped plain text.
- Parse Markdown and run Highlight.js once when the authoritative final snapshot arrives.

For example, the live rendering could initially be:

```svelte
{#if chat.streamText}
	<pre class="streaming-text">{chat.streamText}</pre>
{/if}
```

```css
.streaming-text {
	margin: 0;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font: inherit;
}
```

That means raw Markdown markers are briefly visible during generation, which is a reasonable trade-off for a coding-agent UI.

A more polished compromise is to run Markdown parsing without syntax highlighting at approximately 10 updates per second, then perform full Markdown plus highlighting at completion. Do not use a normal trailing debounce, because continuous generation may prevent updates entirely; use a throttle.

## 2. Critical: the `contentKey` calculation is unnecessarily expensive

The chat page currently builds this derived value:

```ts
let contentKey = $derived.by(() => {
	return JSON.stringify({
		items: chat.snapshot.items.map(/* ... */),
		pendingMessages: chat.pendingUserMessages.map(/* ... */),
		streamText: chat.streamText,
		streamThinking: chat.streamThinking,
		streamTools: chat.streamTools.map(/* ... */)
	});
});
```

Most importantly, both historical and pending attachments include `attachment.data` inside the serialization. Every text delta changes `streamText`, so Svelte reruns the entire derivation, maps the complete history, traverses attachment payloads, and serializes the complete growing stream again.

The effects triggered by this key then:

1. Read `scrollHeight`, `scrollTop`, and `clientHeight` before the update.
2. Potentially write `scrollTop` after the DOM update.

That adds layout work to every text delta.

With an image attachment or a large conversation, this can become worse than the Markdown parser. There is no reason for attachment binary/string data to participate in deciding whether content height may have changed.

### Recommended fix

Replace the serialized content key with an integer revision:

```ts
type ChatTab = {
	// ...
	renderRevision: number;
};
```

Increment it once for each **batched visual update**, not once per raw Pi delta:

```ts
chat.streamText += pending.text;
chat.streamThinking += pending.thinking;
chat.renderRevision++;
```

The scroll effects would observe only:

```ts
let contentRevision = $derived(chat?.renderRevision);
```

Increment the revision when:

- a batched stream update is committed;
- a snapshot is applied;
- a pending user message is added or removed;
- a tool result changes;
- permission UI materially alters timeline height.

A `ResizeObserver` on the timeline element is another viable implementation. Either approach is much better than serializing application content.

As an immediate stopgap, remove both occurrences of `attachment.data` from `contentKey`. That does not solve the growing-string serialization, but it prevents attachment size from multiplying the problem.

## 3. Critical: stream mutations are not batched

`#handleEvent()` handles every SSE message synchronously:

```ts
if (event.type === 'assistant_delta') {
	chat.streamText += event.text ?? '';
	chat.streamThinking += event.thinking ?? '';
	return;
}
```

Tool updates are also applied immediately, including array searches and reactive property mutations.

The browser has no benefit from rendering more frequently than its refresh cycle. One model response might generate dozens or hundreds of transport events per second, but the UI only needs roughly 20–60 visual commits per second.

### Recommended structure

Buffer deltas by runtime or chat:

```ts
type PendingStreamUpdate = {
	text: string;
	thinking: string;
	tools: Map<string, StreamTool>;
};

#pendingUpdates = new Map<string, PendingStreamUpdate>();
#streamFrame: number | undefined;
```

For each incoming event:

```ts
#queueAssistantDelta(chat: ChatTab, text: string, thinking: string): void {
	const pending = this.#getPendingUpdate(chat.id);
	pending.text += text;
	pending.thinking += thinking;
	this.#scheduleStreamFlush();
}
```

Then commit at most once per frame:

```ts
#scheduleStreamFlush(): void {
	if (this.#streamFrame !== undefined) {
		return;
	}

	this.#streamFrame = requestAnimationFrame(() => {
		this.#streamFrame = undefined;
		this.#flushStreamUpdates();
	});
}
```

When a full snapshot arrives, discard any pending buffered delta for that chat before applying the snapshot. The snapshot is authoritative, and this prevents a scheduled frame from appending stale text after `#applySnapshot()` clears streaming state.

Client-side batching should come first. Later, you could also aggregate server-side SSE deltas into 20–30 ms chunks, reducing JSON encoding, EventSource dispatch, parsing, and replay-buffer pressure.

## 4. Good: streaming state is already separate from finalized state

You are doing this part correctly:

```ts
chat.snapshot
chat.streamText
chat.streamThinking
chat.streamTools
```

When a snapshot arrives, you replace the authoritative snapshot and clear transient streaming state:

```ts
chat.snapshot = snapshot;
chat.streamText = '';
chat.streamThinking = '';
chat.streamTools = [];
```

That is a good boundary between in-progress data and persisted session data.

I would retain this architecture. The missing layer is **separating raw stream state from expensive rendered HTML**.

A clean component split would be:

```text
ChatTimeline
├── FinalizedMessage
│   └── cached Markdown + highlighting
├── ToolGroup
│   └── lazy output rendering
└── StreamingMessage
    └── raw text or throttled lightweight Markdown
```

This also makes it harder to accidentally run final-message rendering logic on every stream update.

## 5. High: collapsed tool groups are not lazily rendered

Your tool groups use `<details>`, but all their descendants are still instantiated:

```svelte
<details class="tool-group">
	<summary>...</summary>

	<div class="tool-list">
		...
		<pre>{tool.arguments}</pre>

		<details class="tool-result">
			<summary>Result</summary>
			<pre>{tool.result?.text || tool.stream?.text}</pre>
		</details>
	</div>
</details>
```

`<details>` hides its contents visually; it does not prevent Svelte from creating the elements or inserting the potentially enormous strings into the DOM.

For tools producing command output, logs, file contents, or diffs, this will become a substantial DOM and layout cost even when everything is collapsed.

### Recommended fix

Track whether a group has ever been opened, and only instantiate its body after that:

```svelte
<details
	ontoggle={(event) => {
		const element = event.currentTarget as HTMLDetailsElement;
		if (element.open) openedGroups[entry.id] = true;
	}}
>
	<summary>{toolGroupSummary(entry.tools)}</summary>

	{#if openedGroups[entry.id]}
		<ToolGroupBody tools={entry.tools} />
	{/if}
</details>
```

Do the same for individual result bodies.

Also cap what is initially mounted. For example:

- Show the last 8–32 KiB while a tool is running.
- Show a short completed preview.
- Add “Show full output” for the complete result.
- Render specialized diff or terminal components only when expanded.

One additional item to verify: your server forwards `event.partialResult` as complete text on each `tool_execution_update`, and the client replaces `tool.text`. If Pi’s partial result is cumulative, large tool output also creates growing SSE payloads—not merely growing DOM updates.

## 6. Medium: no conversation virtualization

Every timeline entry is rendered by one full keyed loop:

```svelte
{#each timeline as entry (entry.id)}
	...
{/each}
```

The current dependency list also contains no virtualizer package.

However, I would **not add full dynamic-height virtualization first**. Markdown messages, code blocks, images, expandable reasoning, and tool groups make correct scroll anchoring difficult. A badly implemented virtualizer may create more bugs than it fixes.

Apply these first:

1. Batch streaming updates.
2. Stop parsing and highlighting while streaming.
3. Remove `contentKey` serialization.
4. Lazy-mount tool results.
5. Cap large output previews.

After those changes, profile realistic sessions. If conversations commonly reach hundreds of mounted blocks, then add windowing. Before a full virtualizer, experimenting with `content-visibility: auto` on finalized message and tool-group wrappers may provide a cheaper improvement, but test its interaction with your bottom-scroll logic.

## 7. Medium: snapshots and timeline construction rebuild too much

On every `entry_appended`, the server builds and publishes a full snapshot. `buildSnapshot()` retrieves the complete current branch and maps all entries into a new `items` array. The client then replaces `chat.snapshot` wholesale.

Within `ChatTimeline`, timeline construction repeatedly scans arrays:

```ts
const calledIds = items.flatMap(...);

result: items.find(...);
stream: chat.streamTools.find(...);

if (calledIds.includes(item.toolCallId)) {
	...
}
```

That is potentially `O(items × tool calls)` and can approach quadratic behavior in tool-heavy sessions.

### Cheap fix without changing the protocol

Build indices once per derivation:

```ts
const calledIds = new Set<string>();
const resultByCallId = new Map<string, ChatItem>();
const streamByCallId = new Map(chat.streamTools.map((tool) => [tool.id, tool]));

for (const item of items) {
	for (const call of item.toolCalls ?? []) {
		calledIds.add(call.id);
	}

	if (item.role === 'tool' && item.toolCallId) {
		resultByCallId.set(item.toolCallId, item);
	}
}
```

Then lookup becomes constant-time:

```ts
result: resultByCallId.get(call.id),
stream: streamByCallId.get(call.id)
```

### Longer-term protocol fix

Use the full snapshot for:

- initial hydration;
- reconnection;
- compaction or branch replacement;
- occasional authoritative checkpoints.

For normal progression, send incremental events such as:

```ts
{ type: 'entry_appended', item }
{ type: 'entry_updated', item }
{ type: 'entries_replaced', items }
```

The client can maintain:

```ts
itemsById: Map<string, ChatItem>
itemOrder: string[]
```

That preserves object identity for unaffected messages and avoids repeatedly transferring, parsing, proxying, and reconciling the full conversation.

## 8. Broad `$state` is not itself your main problem

I would not refactor the whole workspace store merely because `ChatTab` is a large reactive object. Svelte’s dependency tracking means that reading `chat.snapshot.isStreaming` does not automatically imply that every `chat.streamText` update must redraw every consumer. For example, the tab strip only reads each tab’s title and streaming status.

The actual broad invalidation is self-inflicted by `contentKey`, because it explicitly reads almost every size-relevant field and serializes them together.

So this would be a poor order of work:

```text
Normalize every store and rewrite state architecture
→ add virtualization
→ replace Markdown library
```

The correct order is:

```text
1. Remove contentKey serialization
2. Batch stream deltas
3. Avoid Highlight.js during streaming
4. Lazy-mount/cap tool outputs
5. Replace repeated array scans with maps and sets
6. Profile
7. Add incremental snapshots and virtualization only if measurements justify them
```

## Suggested performance regression scenario

Add a development benchmark containing:

- 100–200 historical messages;
- 20 tool groups;
- several 100–500 KiB tool outputs;
- at least one realistically sized image attachment;
- a 20,000-character assistant response;
- delivery in 1–10 character deltas at 100–200 events per second.

Instrument `renderAssistantMarkdown()` with a call counter and accumulated duration.

The target behavior should be:

```text
Raw SSE events:              unrestricted
Reactive stream commits:     <= 1 per animation frame
Streaming Highlight.js calls: 0
Final Highlight.js calls:     1 per newly finalized message
History-sized JSON.stringify: 0 per stream update
Collapsed output DOM:         summary/preview only
Timeline joins:               O(items + tools)
```

The biggest immediate issue is not Svelte versus Solid. **It is that the code currently performs work proportional to the full accumulated response—and, through `contentKey`, potentially the full conversation and attachment payloads—for each tiny model delta.** Fixing those three P0 items should produce a very noticeable difference before you need virtualization or a major state-store redesign.
