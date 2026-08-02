# Streaming Markdown rendering: implementation plan

## Decision

Keep raw assistant output as the authoritative streaming source, but render a **throttled lightweight Markdown preview** while output is in progress. The lightweight renderer must use the same safety policy as final rendering, but it must not invoke Highlight.js or create code-copy controls. When the authoritative final snapshot arrives, replace the preview with the existing full Markdown renderer, including syntax highlighting and code-copy controls.

This is the preferred balance between readable, formatted live output and bounded rendering cost:

- Markdown formatting (headings, emphasis, lists, links, and fenced-code structure) remains visible while Pi responds.
- MarkdownIt parses no more than once per configured throttle interval (start with **100 ms**, or at most 10 renders per second), rather than once per animation-frame state commit.
- Highlight.js runs **zero times** for a streaming response and once when its finalized assistant item is rendered.
- Raw text remains separate from the display snapshot, so the throttled preview can never become the source of truth.

The existing 25 ms server-side transport batching and client-side animation-frame batching remain useful, but neither solves the full-document parsing problem by itself: the current timeline still parses the accumulated response once for every client-visible commit.

## Current state

- `src/lib/server/assistant-delta-batcher.ts` batches append-only assistant deltas into 25 ms SSE batches.
- `src/lib/harness/stream-update-batcher.ts` batches client display-state mutations to one animation frame.
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte` currently calls `renderAssistantMarkdown(chat.streamText)` for each of those animation-frame commits.
- `renderAssistantMarkdown()` in `src/lib/markdown.ts` renders the entire accumulated document and invokes Highlight.js for recognized fenced code blocks.

The plan separates the high-frequency raw-text path from the lower-frequency live-Markdown path.

## Target data flow

```text
Pi text_delta
  → existing server 25 ms batch
  → existing client rAF batch
  → chat.streamText (authoritative raw accumulated text)
  → at most once per 100 ms: chat.streamRenderedText (preview snapshot)
  → renderStreamingMarkdown(streamRenderedText) (MarkdownIt, no Highlight.js)

snapshot (authoritative boundary)
  → discard pending rAF/timer work
  → snapshot.items final assistant message
  → renderAssistantMarkdown(item.text) (MarkdownIt + Highlight.js + copy controls)
  → clear streamText and streamRenderedText
```

`streamText` is intentionally not read by the live Markdown derivation. Updating raw text must not initiate a Markdown parse. It can still drive lightweight state such as the streaming-message shell and waiting indicator.

## Scope and non-goals

Included:

- Add a separate throttled display snapshot for live assistant text.
- Add a safe Markdown renderer with highlighting explicitly disabled for that snapshot.
- Render the live snapshot as Markdown without code-copy controls.
- Preserve the existing final Markdown/highlighting renderer and authoritative snapshot semantics.
- Add regression coverage for cadence, no live highlighting, and the preview-to-final transition.

Excluded:

- Changes to the SSE protocol, server 25 ms batching, tool update behavior, scroll handling, timeline indexing, virtualization, or `$lib/markdown.ts` sanitization policy.
- Incremental block-level Markdown parsing. A fixed-rate whole-document preview is simpler and should be measured before considering that complexity.

## Implementation steps

### 1. Create distinct full and streaming Markdown renderers

**File:** `src/lib/markdown.ts`

Refactor the current module-level MarkdownIt setup into a small factory that accepts two capabilities:

- `highlightCode`: whether the fence callback invokes Highlight.js.
- `includeCodeCopyAction`: whether the custom fence renderer injects the code-copy button.

Create two independent renderer instances with the **same** security settings:

| Renderer | MarkdownIt | Highlight.js | Copy button | Used for |
| --- | --- | --- | --- | --- |
| `renderAssistantMarkdown(text)` | full Markdown | enabled | enabled | finalized assistant items |
| `renderStreamingMarkdown(text)` | full Markdown | disabled | disabled | in-progress assistant preview |

Both instances must retain the existing protections: `html: false`, restricted link validation/normalization, disabled images, and escaped code content. The streaming renderer’s `highlight` callback should always return an empty string; MarkdownIt will render the fenced code as escaped plain code without Highlight.js spans.

Do not configure one mutable global MarkdownIt instance differently per call. Two independently configured instances avoid cross-render state, retain deterministic server rendering, and make the “no streaming highlighting” guarantee explicit.

Add a unit test in `src/lib/markdown.spec.ts` for `renderStreamingMarkdown()` that verifies ordinary Markdown is rendered, a typed fence is escaped but has no Highlight.js markup, no copy-button markup is emitted, and unsafe HTML/link behavior matches the existing final renderer’s policy.

### 2. Add a throttled live-render snapshot to chat state

**File:** `src/lib/harness/types.ts`

Add a transient field to `ChatTab`:

```ts
streamRenderedText: string;
```

Its contract is a recent display snapshot of `streamText`; it is not persisted and is not sent to the server.

Initialize it to `''` wherever a chat is created or restored:

- `HarnessWorkspace.#createChatTab()`
- `HarnessWorkspace.#fromStoredChat()`
- any test helper that constructs a `ChatTab`

Clear it wherever snapshot handling currently clears `streamText`, especially `HarnessWorkspace.#applySnapshot()`.

### 3. Throttle the preview snapshot in the existing stream batcher

**File:** `src/lib/harness/stream-update-batcher.ts`

Extend `StreamUpdateTarget` with `streamRenderedText`. Keep the existing request-animation-frame buffer as the raw-transport/display commit boundary, then add a second, injected timer-based throttle for the Markdown display snapshot.

Recommended behavior:

1. At the next animation frame, append queued assistant deltas to `chat.streamText` exactly as today.
2. If this is the first visible text for this stream, immediately copy `streamText` into `streamRenderedText`. This leading update avoids an initially blank streaming message.
3. For later changes, schedule one timer for 100 ms if one is not already scheduled. Additional rAF commits keep appending raw text but do not update `streamRenderedText` or parse Markdown.
4. When the timer fires, copy the complete current `streamText` into `streamRenderedText`, clear the timer, and allow the timeline to render one fresh lightweight Markdown preview.
5. If text continues arriving, repeat from step 3. This is a throttle, not a trailing debounce: continuous output still refreshes at a regular, bounded cadence.

Inject `setTimeout` and `clearTimeout` alongside the existing frame scheduler so cadence and cleanup are deterministic in unit tests. Keep separate pending-display tracking per chat, just as raw updates are already keyed by chat ID.

`discard(chatId)` and `discardAll()` must remove both queued rAF updates and queued preview updates. A timer may remain scheduled for another chat, but a discarded chat must never receive a delayed `streamRenderedText` write. Clearing a timer when it has no remaining pending previews is preferable.

The batcher must not mutate finalized snapshot items. `streamText` remains the complete raw stream, while `streamRenderedText` is only the last value offered to the renderer.

### 4. Preserve snapshot ordering and finalization

**File:** `src/lib/harness/workspace.svelte.ts`

Retain the current authoritative snapshot sequence in `#handleEvent()` and `#applySnapshot()`:

1. On a `snapshot` event, call `this.#streamUpdates.discard(chat.id)` before installing the snapshot.
2. Install `chat.snapshot`.
3. Clear `streamText`, `streamRenderedText`, `streamThinking`, and `streamTools`.

No `$effect` is needed; the throttle is an event-driven batching concern, not derived-state synchronization.

The existing server `publishRuntimeEvent()` flushes pending assistant deltas before publishing a non-delta causal boundary. Combined with client-side `discard()`, this prevents either a queued rAF callback or a throttled preview timer from appending stale output after a final snapshot. Do not use a `state` event alone as a finalization signal: only the snapshot provides the authoritative completed message.

### 5. Render the throttled Markdown preview

**File:** `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`

In the streaming assistant branch:

- Keep the wrapper visible when `chat.streamText` is non-empty, even if a preview has not yet been committed.
- Render `chat.streamRenderedText` with `renderStreamingMarkdown()` and `{@html ...}` only when the display snapshot is non-empty.
- Use the existing Markdown container styling so the live preview is visually consistent with finalized messages.
- Do not attach `codeCopyControls` to the live container. The streaming renderer also must not emit a copy-button element.

The relevant derivation/render expression must read `chat.streamRenderedText`, not `chat.streamText`. The raw field may be read only for the wrapper’s visibility condition and other inexpensive status logic.

Finalized `entry.kind === 'item'` assistant messages must remain unchanged: they use `renderAssistantMarkdown(item.text)` and `{@attach codeCopyControls}`, so Markdown formatting, Highlight.js output, and code copying appear immediately once the snapshot replaces the preview.

### 6. Test the two rendering modes and throttle boundary

**Files:**

- `src/lib/markdown.spec.ts`
- `src/lib/harness/stream-update-batcher.spec.ts`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte.spec.ts`

Add or update coverage as follows.

#### Renderer tests

- The streaming renderer produces headings, emphasis, lists, links, and fenced-code structure.
- Streaming typed fences contain escaped source code but no Highlight.js spans/classes and no copy button.
- Both renderers retain the same XSS and unsafe-link protections.
- The final renderer retains highlighting and the copy-button markup.

#### Batcher tests

Using injected frame and timer schedulers:

- Raw deltas concatenate at the next animation frame.
- The first streamed text also produces an immediate preview snapshot.
- Subsequent raw updates within 100 ms change `streamText` but leave `streamRenderedText` unchanged.
- At 100 ms, `streamRenderedText` advances to the complete accumulated raw text.
- Continuous updates yield no more than one preview write per interval; this distinguishes throttling from a trailing debounce.
- `discard(chat.id)` and `discardAll()` make already scheduled frame/timer callbacks harmless.
- Separate chats do not mix raw or preview text.

#### Timeline component tests

Replace the current expectation that streaming output uses the final renderer with these expectations:

1. `## Streaming\n\n**Partial answer**` produces streaming `h2` and `strong` elements.
2. A streaming typed fence has no code-copy button and no Highlight.js markup.
3. A finalization transition first renders the typed fence as unhighlighted streaming Markdown, then rerenders with the same text as a finalized assistant snapshot and asserts Highlight.js markup plus the copy button only in the finalized view.
4. HTML-like streaming input is rendered according to the shared safe policy, never injected as arbitrary HTML.
5. Existing clipboard success/failure tests target finalized assistant content, because live code is intentionally not copy-enhanced.

## Validation

After implementation:

1. Run focused Markdown, stream-batcher, and `ChatTimeline` specs while iterating.
2. Run `npm run check` for Svelte and TypeScript diagnostics.
3. Run `npm run lint` (required by project guidance).
4. Run `npm run test:unit -- --run` before merge.
5. Manually inspect a response with headings, links, an incomplete fence, and a completed typed fence:
   - formatting appears during streaming but updates no more frequently than the selected interval;
   - live code is readable but unhighlighted and has no copy action;
   - the final snapshot immediately replaces the preview with highlighted, copyable code;
   - no stale preview appears after finalization.

## Acceptance criteria

- `chat.streamText` remains the complete raw streaming source; it is not passed directly to a Markdown-rendering expression.
- `renderStreamingMarkdown(chat.streamRenderedText)` runs at most once per 100 ms per active chat after the leading render.
- The streaming renderer never invokes Highlight.js and never emits/attaches code-copy controls.
- The final renderer continues to use the current Markdown safety policy, Highlight.js, and copy controls.
- Snapshot receipt cancels pending preview work and cannot be followed by a stale live update.
- Batcher and component tests cover cadence, isolation, cancellation, safe lightweight Markdown, and live-to-final rendering.
- `npm run check`, `npm run lint`, and the unit suite pass.

## Risks and follow-up

A 100 ms preview is normally smooth while substantially reducing repeated full-document parsing. The interval should be a named, tested constant so it can be tuned from profiling and product feedback; do not silently regress to rendering `renderAssistantMarkdown(chat.streamText)` on every rAF commit.

Even without Highlight.js, repeated full Markdown parsing is still proportional to accumulated response length. If profiling shows this remains material for unusually long responses, first increase the throttle interval modestly or apply a size-aware cadence. Only then consider incremental completed-block rendering, which has significantly greater correctness and maintenance cost for incomplete Markdown.
