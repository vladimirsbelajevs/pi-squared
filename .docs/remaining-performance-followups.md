# Remaining performance follow-ups

## Scope

This document tracks the performance issues from the review of commit `e42204b` that remain unresolved or only partially resolved after the timeline protocol rebuild.

It was revalidated against commit `045a9aa`. The validation was source- and test-based; no representative browser performance profile was run. Items whose priority depends on actual render or parsing frequency explicitly require measurement before a larger implementation.

The following major findings are already addressed and are not repeated as work items below:

- assistant and tool events are batched before presentation-state updates;
- streaming Markdown rendering is throttled and does not syntax-highlight code;
- the serialized `contentKey` auto-scroll path was replaced by frame-batched resize/scroll handling;
- persisted conversation progression uses revisioned incremental events rather than routine full snapshots;
- the client has normalized `itemsById` and `itemOrder` state with checkpoint recovery;
- finalized timeline construction uses `Set`/`Map` indexes;
- closed tool groups and result bodies are lazily mounted.

## Priority summary

| Priority | Issue | Current status |
| --- | --- | --- |
| Low | Stream presentation flushes are coupled to workspace/cursor persistence | Open |
| Low | Timeline-wide hover state and formatter allocation | Open |
| Low | Historical image previews are not browser-lazy | Open |

---

## 1. Stream presentation flushes are coupled to workspace/cursor persistence

**Status:** Open  
**Priority:** Low

### Current behavior

`StreamUpdateBatcher` invokes its `onFlush` callback for frame-batched assistant/tool presentation commits. The workspace wires that callback to `schedulePersist()`, causing repeated debounce-timer cancellation/rescheduling and, after a quiet period, full workspace serialization.

Stream text, rendered stream text, thinking, live tools, and normalized runtime projection state are not stored in `StoredWorkspaceV1`. The document does store the global opaque `lastEventId`, however, and every SSE envelope advances that cursor in memory. Stream flush persistence therefore provides incidental cursor durability; it is not entirely redundant.

That coupling is inconsistent: non-presentation events also advance the cursor without scheduling the same write, and `reset_required` clears the cursor only in memory. Removing the callback without a separate cursor policy would change reload/reconnect behavior.

### Relevant files

- `src/lib/harness/workspace.svelte.ts`
- `src/lib/harness/stream-update-batcher.ts`
- `src/lib/harness/types.ts`
- `src/lib/harness/api.ts`

### Recommended implementation

- Remove persistence scheduling from assistant/tool presentation flushes.
- Persist tab metadata, drafts, queue mode, runtime IDs, active-tab state, and other `StoredWorkspaceV1` fields explicitly at their mutation sites.
- Choose and document one cursor policy:
  - **durable cursor:** throttle cursor persistence independently at a much coarser interval, apply it consistently to every event kind, persist reset clearing, and flush at an appropriate lifecycle boundary; or
  - **non-durable cursor:** stop storing it and prove reconnect correctness through checkpoint hydration plus bounded replay/buffering.
- Consider storing a durable cursor separately if serializing the complete workspace document is unnecessary.
- Add workspace-level fake-storage tests; current batcher tests do not exercise workspace persistence.

### Acceptance criteria

- Assistant/tool frame flushes and Markdown preview timers cause no persistence timer, workspace serialization, or `localStorage.setItem` by themselves.
- Draft, tab metadata/order, runtime ID, queue mode, and active-tab changes still persist explicitly.
- Cursor behavior is explicit and tested:
  - if durable, write frequency is bounded independently of render frames, all event kinds advance it consistently, and reset clearing is persisted; or
  - if non-durable, reload/reconnect correctness is demonstrated without it.
- Reconnect tests cover same-epoch replay, expired or foreign-epoch reset, inactive/unhydrated tabs, and no duplicate or missing revisioned events.
- A representative long assistant/tool stream has a bounded, asserted storage-write count.

---

## 2. Timeline-wide hover state and repeated formatter allocation

**Status:** Open  
**Priority:** Low

### Current behavior

`hoveredMessageId` lives in `ChatTimeline.svelte`. Moving between rows changes timeline-level reactive state and makes every row compare its ID. Timestamp helpers also allocate new `Intl.DateTimeFormat` instances when evaluated.

The metadata/action content is absent from the DOM until pointer hover. As a result, `:focus-within` alone cannot reveal or focus the unmounted copy action, and current tests cover pointer hover but not keyboard access.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- prospective `src/routes/(workspace)/chat/[projectId]/[sessionId]/MessageRow.svelte`

### Recommended implementation

- Remove timeline-wide `hoveredMessageId`.
- Prefer CSS `.message-entry:hover` and `.message-entry:focus-within` for visual presentation where the interactive action remains mounted and keyboard reachable.
- Do not hide the only focusable action with `display: none` or `visibility: hidden`. If minimizing per-row DOM is more important, use a deliberate row-local focus/reveal interaction and test its tab order rather than relying on an unmounted control.
- If interactive row state remains necessary, move it into `MessageRow.svelte`.
- Reuse two component- or module-level `Intl.DateTimeFormat` instances: one for the short time and one for the full date/time title.
- Evaluate the always-mounted metadata/action DOM together with the long-history profile; avoid fixing parent invalidation by silently creating a larger unbounded row tree.

### Acceptance criteria

- Hovering one message does not update parent timeline state.
- Keyboard users can reach the message action, and focusing it visibly reveals the metadata/action row.
- A component test covers tab/focus behavior rather than pointer hover only.
- Timestamp output remains locale-aware and unchanged in meaning.
- The chosen metadata strategy is included in the long-history DOM/profile fixture.

---

## 3. Historical image previews are not browser-lazy

**Status:** Open  
**Priority:** Low

### Current behavior

`AttachmentPreview.svelte` serves both persisted history and newly selected composer drafts. Its `<img>` has neither `loading` nor `decoding` attributes, so both contexts use browser defaults. The inline data URL is constructed before rendering regardless of image loading policy.

### Relevant files

- `src/lib/components/AttachmentPreview.svelte`
- `src/lib/components/ChatComposer/ChatComposer.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`

### Recommended implementation

- Add an explicit image-loading policy prop to `AttachmentPreview`.
- Pass `loading="lazy"` and `decoding="async"` from historical `ChatTimeline` previews.
- Pass or default to `loading="eager"` for newly selected composer previews so feedback remains immediate.
- Treat native lazy loading as a browser hint. It does not avoid mounting the preview component or constructing the inline data URL.
- Keep the existing image-viewer flow independent of whether the thumbnail has completed decoding.

### Acceptance criteria

- Historical off-screen previews have `loading="lazy"` and `decoding="async"`.
- Newly selected composer previews explicitly remain eager.
- Caller-specific attribute tests cover history and composer usage.
- Opening the image viewer remains reliable before and after thumbnail decode.

---

## Suggested implementation order

1. Extract/localize message-row hover state and reuse timestamp formatters, measuring the DOM tradeoff.
2. Decouple stream presentation from an explicit cursor-persistence policy.
3. Add caller-specific lazy/eager image loading.

## Validation

For each completed item:

1. add focused unit/component tests for the stated identity, concurrency, cancellation, accessibility, or decode-count contract;
2. run `npm run check` and distinguish existing unrelated failures;
3. run the Svelte autofixer for every changed `.svelte` file until it reports no issues or suggestions;
4. run `npm run lint`;
5. run `npm run test:unit -- --run`;
6. profile a production build/preview—not only dev mode—for acceptance criteria concerning rendering, layout, scripting, memory, image decoding, or startup concurrency;
7. record the fixture, browser/runtime version, measurements, and before/after result so a CSS or cache change is not accepted by inspection alone.
