# Remaining performance follow-ups

## Purpose

This is an implementation handoff for the performance findings from commit `e42204b` that were still open after the timeline protocol rebuild. It was revalidated against commit `045a9aa`.

The intended implementer is expected to be able to follow the steps without making product or protocol decisions. Where the earlier review offered alternatives, this document now chooses a default implementation. Escalate before deviating from those choices.

No representative browser performance profile was run during the review. The rendering and image items therefore include measurement steps that must be completed before claiming a measured performance improvement.

The following major findings are already addressed and are not work items here:

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
| Low | Stream presentation flushes are coupled to workspace/cursor persistence | Closed |
| Low | Timeline-wide hover state and formatter allocation | Partially closed |
| Low | Historical image previews are not browser-lazy | Open |

## Cross-cutting implementation rules

- Implement these as three reviewable changes. Do not combine them with unrelated refactors.
- Preserve the existing revision/checkpoint protocol. None of these items requires a server protocol change.
- Treat `streamText`, `streamRenderedText`, `streamThinking`, `streamTools`, runtime projections, hydration buffers, notices, permission state, and pending user messages as runtime-only state.
- Do not introduce `$effect` for persistence, hover/focus handling, image loading, or derived state.
- Prefer deterministic attribute/state tests over timing assertions about browser heuristics.
- Run the Svelte autofixer on every changed `.svelte` file until it has no findings.

---

## 1. Decouple stream presentation from workspace and cursor persistence

**Status:** Closed
**Priority:** Low
**Primary files:**

- `src/lib/harness/workspace.svelte.ts`
- `src/lib/harness/stream-update-batcher.ts`
- `src/lib/harness/types.ts`
- `src/lib/harness/workspace.spec.ts`
- `src/lib/harness/stream-update-batcher.spec.ts`
- `src/lib/harness/api.ts` — inspect only; no API change is expected

### Goal

A frame commit or Markdown-preview refresh must never schedule or perform full workspace serialization. The SSE cursor must remain durable, but it must use its own coarse, event-kind-independent persistence path.

### Chosen design

Use a **durable cursor stored separately from `StoredWorkspaceV1`**.

Use these concrete defaults:

```ts
const EVENT_CURSOR_STORAGE_KEY = 'pi-squared:event-cursor:v2';
const CURSOR_PERSIST_THROTTLE_MS = 1_000;
```

The cursor value is opaque. Store and restore the string unchanged; do not parse, compare, increment, or otherwise interpret it on the client.

A trailing throttle may lose at most the final throttle window if the browser or process crashes. That is acceptable because same-epoch replay is revision-safe and expired/foreign cursors already trigger checkpoint recovery. Flush pending state on `pagehide` and connection disposal to cover normal reload and shutdown.

Do **not** choose the non-durable-cursor alternative in this change.

### Current call flow to understand first

1. `HarnessWorkspace.#restoreTabs()` reads `StoredWorkspaceV1.lastEventId` into `#lastEventId`.
2. `#connectEvents()` passes it to `openEventStream()`.
3. Every normal envelope updates `#lastEventId` before chat lookup or hydration checks. This includes notices, errors, duplicates, events for unknown runtimes, and events for inactive/unhydrated tabs.
4. Assistant/tool events also enter `StreamUpdateBatcher`.
5. The batcher's frame callback calls `onFlush`, which currently calls `workspace.schedulePersist()`.
6. The 150 ms workspace debounce eventually serializes every stored tab just to make the cursor durable.
7. `reset_required` clears only the in-memory cursor, so a reload can restore the stale cursor.

Keep step 3: the global cursor must advance for every envelope, even when that envelope is not applied to an active chat. Remove the coupling introduced by steps 5 and 6.

### Implementation steps

#### 1. Make `StreamUpdateBatcher` presentation-only

In `src/lib/harness/stream-update-batcher.ts`:

1. Remove the `onFlush` constructor parameter.
2. Remove the callback invocation from `flush(chatId)`.
3. Remove the callback invocation from the scheduled animation-frame commit.
4. Keep assistant/tool merge behavior, synchronous lifecycle-boundary flushes, preview throttling, discard behavior, and scheduler injection unchanged.
5. Update constructor argument order in tests in the same commit. The current fake scheduler helper passes `onFlush` as the second argument; after removal, timeout scheduler/canceller arguments move left.

In `workspace.svelte.ts`, construct the batcher with presentation schedulers only. There must be no persistence callback reachable from the batcher.

The Markdown preview timeout already only assigns `streamRenderedText`; do not add a callback there.

#### 2. Add an independent cursor throttle

Add private state to `HarnessWorkspace` for:

- the latest in-memory opaque cursor (`#lastEventId` already exists);
- whether that value is dirty;
- one pending cursor timeout;
- one stable `pagehide` listener, registered at most once.

Implement helpers with the following responsibilities:

- `#scheduleCursorPersist()`
  - mark the cursor dirty;
  - if a cursor timer already exists, leave it in place;
  - otherwise schedule one write after `CURSOR_PERSIST_THROTTLE_MS`;
  - do not cancel/restart the timer for each envelope. This must be a throttle, not the draft-style debounce.
- `#flushCursorPersist()`
  - clear the pending timer if present;
  - return without writing if the cursor is not dirty;
  - write the latest `#lastEventId` to `EVENT_CURSOR_STORAGE_KEY`;
  - if the value is absent, remove the key instead of writing the string `"undefined"`;
  - clear the dirty flag only after the storage operation.
- `#clearPersistedCursor()`
  - set `#lastEventId` to `undefined`;
  - cancel the pending cursor timer;
  - clear the dirty flag;
  - immediately call `localStorage.removeItem(EVENT_CURSOR_STORAGE_KEY)` so a stale timer or reload cannot restore the rejected cursor.

In `#handleEvent()`:

- for a normal envelope, assign `message.id` and call `#scheduleCursorPersist()` **before** any return for missing, inactive, failed, hydrating, duplicate, notice, or error handling;
- for `reset_required`, call `#clearPersistedCursor()` before refreshing the active chat;
- keep the current policy of immediately refreshing only the active chat. Inactive tabs remain checkpoint-on-activation; do not fan out hydration across all tabs.

#### 3. Flush at lifecycle boundaries

Add one public or private orchestration method that flushes both independently pending concerns:

- if the 150 ms workspace timer is pending, cancel it and serialize the workspace once;
- flush the cursor timer/value independently.

Use it from:

- `pagehide`, which covers normal reload/navigation away;
- `disposeConnection()`, before the EventSource is closed.

Register the `pagehide` listener when the event connection becomes active and remove it in `disposeConnection()`. Repeated `start()` or reconnect calls must not add duplicate listeners.

Do not use `beforeunload`; `pagehide` is the intended browser lifecycle boundary here.

#### 4. Separate cursor migration from workspace serialization

`StoredWorkspaceV1` should describe only the workspace document going forward:

```ts
export interface StoredWorkspaceV1 {
  version: 1;
  activeTabId?: string;
  tabs: Array<StoredNewTab | StoredChatTab>;
}
```

Continue accepting an embedded string `lastEventId` while parsing old v1 JSON, but treat it as migration-only input. One straightforward implementation is for the parser to return an internal result such as:

```ts
type RestoredWorkspace = {
  workspace: StoredWorkspaceV1;
  legacyLastEventId?: string;
};
```

Restore in this order:

1. read `EVENT_CURSOR_STORAGE_KEY`, even when no workspace document exists;
2. if absent, use a legacy string `lastEventId` from the workspace JSON;
3. if the legacy value was used, write it to the separate cursor key;
4. on the next workspace write, omit `lastEventId` from the workspace JSON.

Cursor restoration must not be hidden behind an early return from `#restoreTabs()`; a separate cursor key is valid even when there are no stored tabs. Do not reject an otherwise valid old workspace because it has the extra field. Existing numeric v1 cursors remain invalid and must not be migrated.

No change is required in `api.ts`: `openEventStream(lastEventId, ...)` should continue receiving an optional opaque string.

#### 5. Audit every stored workspace mutation

After removing the stream callback, persistence must still happen where stored fields change.

| Stored data | Current mutation seam | Required handling |
| --- | --- | --- |
| Active tab | `rememberTabForPathname()` | Keep the explicit write. |
| New/chat tab insertion and order | `createNewTab()`, `ensureChat()`, `startChat()` | Persist immediately after insertion/replacement and before awaiting hydration or prompt submission. A failed hydration/prompt must not leave the stored tab list stale. |
| Tab removal and fallback active tab | `closeTab()` | Keep the explicit write. |
| New-tab project/model/thinking/draft | workspace methods plus new-route composer callback | Keep immediate selector writes and the draft debounce. |
| Chat draft | chat-route composer callback | Keep the 150 ms workspace debounce. |
| Queue mode | chat-route callback | Prefer a workspace method such as `setQueueMode(chat, mode)` so mutation and persistence cannot be separated. |
| Chat title and runtime ID | `#applyCheckpoint()` | Compare old/new stored values and schedule workspace persistence only if `title` or `runtimeId` actually changed. Do not persist merely because runtime projection state changed. |
| Runtime ID removal | inactive runtime disposal | Keep the explicit write. |

Remove the unconditional `persist()` from the `#loadChat()` promise finalizer. `#applyCheckpoint()` must schedule a workspace write only when stored `title` or `runtimeId` changed; an unchanged checkpoint must produce no workspace-key write. Hydration state/error/projection changes are runtime-only.

In `ensureChat()`, persist immediately after pushing a newly created direct-route chat and before starting hydration. In `startChat()`, persist immediately after replacing the new tab with the checkpoint-backed chat and before awaiting `sendPrompt()`. A later draft restoration or other stored-field change may perform its own write.

Also make direct `persist()` cancel any already pending workspace timer. Otherwise a path that schedules a metadata write and then immediately persists can serialize twice.

Do not persist snapshots, normalized runtime state, stream fields, hydration buffers, notices, permissions, or pending user messages while doing this audit.

### Focused test plan

Extend `src/lib/harness/workspace.spec.ts`. Reuse its hoisted API mock and map-backed fake storage, but make `setItem`/`removeItem` spies so calls can be counted by key. Use fake timers and a manually captured animation-frame callback when a test must distinguish event receipt, frame commit, Markdown preview, cursor throttle, and lifecycle flush.

Add these test groups:

#### Presentation/storage isolation

- Hydrate one streaming chat.
- Deliver revision-contiguous assistant and tool events over many frame callbacks.
- Run the 100 ms Markdown preview timeout.
- Assert that neither frame commits nor preview callbacks call `localStorage.setItem` for `pi-squared:workspace:v1`.
- Advance one cursor throttle window and assert only the latest cursor is written to `EVENT_CURSOR_STORAGE_KEY`.
- For a burst contained in one throttle window, assert at most one cursor-key write.

Use a representative mixed burst rather than thousands of events; the important contract is that write count is bounded by throttle windows, not event/frame count.

#### Cursor consistency

Table-drive normal envelopes covering at least:

- assistant delta;
- tool update;
- a non-presentation revisioned mutation;
- notice;
- error;
- unknown runtime;
- inactive/unhydrated tab.

After one throttle window, assert that the last received envelope ID is the only persisted cursor value. An early return must not prevent advancement.

#### Cursor restoration and migration

Add tests proving all of these cases:

- the separate cursor key takes precedence over a different legacy embedded string;
- a legacy embedded string migrates to the separate key once;
- a numeric legacy cursor is ignored and not migrated;
- a separate cursor is restored and passed to `openEventStream()` when no workspace document exists;
- the next workspace write after migration omits `lastEventId`.

#### Reset handling

For both `foreign_epoch` and `expired_cursor`:

- seed the separate cursor key;
- leave a cursor write pending;
- deliver `reset_required`;
- assert the key is removed immediately;
- advance timers and assert the stale pending value is not rewritten;
- when an active chat exists, assert forced checkpoint hydration is requested.

#### Reload and replay correctness

Cover the following distinct cases:

1. **Same epoch, settled tab:** seed the separate cursor key and assert `openEventStream()` receives it. A replayed duplicate must not duplicate an item; the next revision must apply once.
2. **Event arrives during hydration:** defer `getRuntime()`, deliver an event, resolve a checkpoint, and prove checkpoint-covered events are skipped while newer events apply once.
3. **Inactive/unhydrated tab:** an event may advance the global cursor without being applied locally; activating the tab must load an authoritative checkpoint containing the change.
4. **Foreign/expired reset:** checkpoint state replaces stale local state, then the next revision applies once.
5. **Hydration buffer overflow:** preserve the existing 100-event bound and prove overflow causes another checkpoint rather than a partial suffix.

Assertions should inspect item IDs/revisions, not only call counts, so duplicate and missing-event regressions are visible.

#### Stored-field persistence

Add focused assertions for:

- draft debounce;
- active tab;
- new tab creation and tab order after close;
- queue mode;
- title/runtime ID changes from a checkpoint;
- an unchanged checkpoint causing zero workspace-key writes;
- runtime ID clearing;
- insertion/replacement persistence when hydration or prompt submission rejects.

These tests protect against accidentally relying on the removed stream callback.

#### Lifecycle flush

- Leave a draft write and cursor write pending.
- Trigger the lifecycle flush directly and through `pagehide`.
- Assert one workspace write and one latest-cursor write.
- Call `start()`/connect repeatedly and prove `pagehide` does not produce duplicate writes.
- Assert `disposeConnection()` flushes before closing the mocked EventSource.

### Acceptance criteria

- `StreamUpdateBatcher` has no persistence callback or persistence knowledge.
- Assistant/tool frame commits and Markdown preview timers cause zero workspace-key writes.
- Workspace writes remain tied to stored workspace-field mutations.
- Cursor writes are tied to coarse throttle windows, not event count or render frames.
- Every normal envelope kind advances the durable cursor before an early return.
- `reset_required` clears durable state immediately and cannot be undone by a stale timer.
- Legacy embedded cursor values migrate once; new workspace JSON does not contain `lastEventId`.
- Same-epoch replay, reset recovery, inactive tabs, hydration buffering, and overflow have no duplicate or missing revisioned items.
- A lifecycle boundary flushes the latest draft/workspace document and cursor independently.

### Non-goals and risks

- Do not change `EventBroker`, SSE envelope shapes, replay-window size, or revision semantics.
- Do not hydrate every inactive tab after reset.
- A hard browser/process crash can lose up to one second of cursor progress; bounded replay/checkpoint recovery is the fallback.
- The cursor is global while checkpoints are per runtime. Events ignored for inactive tabs are intentionally recovered from that tab's checkpoint on activation.

---

## 2. Remove timeline-wide hover state and reuse timestamp formatters

**Status:** Partially closed
**Priority:** Low
**Primary files:**

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte.spec.ts`
- optional follow-up only: `src/routes/(workspace)/chat/[projectId]/[sessionId]/MessageRow.svelte`

### Goal

Hovering between finalized messages must not mutate timeline-level Svelte state. The copy action must exist in the tab order before pointer interaction, and timestamp formatting must reuse formatter instances.

### Chosen first implementation

Use a **CSS-only reveal with always-mounted metadata/action content** in `ChatTimeline.svelte` first.

Do not start by extracting `MessageRow.svelte`. The existing message branch owns extensive scoped Markdown, code-copy, reasoning, responsive, and role styling; moving it creates a large regression surface unrelated to the finding. Extract a row only if the long-history measurement shows a remaining parent invalidation problem or the always-mounted metadata DOM is unacceptable.

This choice intentionally leaves rare copy-success state (`copiedMessageId`) at timeline scope. This issue is about pointer traversal, which is frequent; copying a message is not. A later row extraction may localize copy state separately if profiling justifies it.

### Implementation steps

#### 1. Reuse formatter instances

Create exactly two formatter constants in the component script, outside the helper functions:

```ts
const shortTimeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: 'numeric',
  minute: '2-digit'
});
const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});
```

Update `formatTimestamp()` and `formatTimestampTitle()` to call those instances. Keep the current missing/invalid timestamp guard. Do not introduce an explicit locale or change options; the output must retain the user's runtime locale and current meaning.

A component-level allocation is sufficient because there is one timeline instance. Module-level constants are also acceptable, but are not required.

#### 2. Remove reactive hover state

Delete:

- `hoveredMessageId`;
- `showMessageMeta`;
- `onmouseenter` and `onmouseleave` handlers on `.message-entry`;
- the conditional block that mounts `.message-meta-content` only while hovered;
- `fly`/`fade` imports if no other markup in this component uses them.

Keep `.message-meta-row` and its reserved height so revealing metadata does not shift message layout.

#### 3. Always mount the action and reveal with CSS

Always render `.message-meta-content` for user and assistant messages. Keep the copy button conditional on `item.text`; empty messages should not gain a meaningless action.

Use CSS opacity/transform for visual hiding. Do not use `display: none`, `visibility: hidden`, `hidden`, `aria-hidden`, `inert`, or a conditional block for the only focusable action.

The intended behavior is:

```css
.message-meta-content {
  opacity: 0;
  pointer-events: none;
  transform: translateY(-0.15rem);
  transition:
    opacity 100ms ease,
    transform 100ms ease;
}

.message-entry:hover .message-meta-content,
.message-entry:focus-within .message-meta-content {
  opacity: 1;
  pointer-events: auto;
  transform: none;
}
```

Also add a coarse-pointer/no-hover rule that leaves the metadata visible, so touch users do not need to discover an invisible target:

```css
@media (hover: none), (pointer: coarse) {
  .message-meta-content {
    opacity: 1;
    pointer-events: auto;
    transform: none;
  }
}
```

Under `prefers-reduced-motion: reduce`, remove the metadata transition along with the existing animation accommodation.

Do not add `tabindex` to the message `role="group"`; the copy button should be the tab stop. `pointer-events: none` does not remove the button from sequential keyboard focus. When Tab focuses the button, `:focus-within` reveals the row before the focus indicator is presented.

#### 4. Preserve existing behavior

- Keep `role="group"` and role-specific accessible labels.
- Keep model fallback resolution, thinking-level display, `<time datetime>`, localized title, copy labels, clipboard behavior, and the shared copy error alert.
- Keep delegated finalized-code copying and streaming Markdown behavior unchanged.
- Do not alter tool groups, notices, stopped rows, live tools, or the streaming response as part of this item.

### Focused component tests

Replace the pointer-only assumptions in `ChatTimeline.svelte.spec.ts`.

The existing test currently expects zero `.message-meta-content` nodes before hover; remove that expectation. Add assertions for:

1. **Mounted controls:** two text messages produce two `Copy message` buttons before any hover.
2. **Keyboard order:** start from a known focus position, use `userEvent.tab()`, and assert focus reaches the first message copy action and then the second.
3. **Focus reveal:** after focus enters a row, wait for CSS transition completion if necessary and assert that row's metadata has visible opacity and the button has its focus-visible styling.
4. **Pointer isolation:** hovering one row reveals that row and not the other. This is a CSS behavior assertion; do not add render-count instrumentation.
5. **Copy behavior:** use the existing clipboard mock, activate a focused copy action, and assert exact copied text plus the `Copied message` label.
6. **Metadata semantics:** retain assertions for assistant model, thinking level, non-empty time text, `datetime`, and title. Do not assert an exact localized display string because CI browser locales can differ.

The source-level contract is that `hoveredMessageId` and row mouse handlers no longer exist. Component tests should prove behavior and access, not Svelte internals.

### Long-history measurement fixture

Use a dedicated `200-message performance fixture` in the application preview or a maintained browser test harness.

Before profiling:

- create a fixture-only change that adds timestamps to representative user and assistant messages so formatter/title and `<time>` DOM are exercised;
- retain mixed Markdown, large code blocks, notices, closed tool groups, and six images;
- collect the baseline from the old implementation with that fixture-only change applied;
- apply the hover/formatter implementation without changing fixture data, then collect the candidate profile;
- update the fixture assertions in the selected test harness to include the expected metadata and copy-action counts after the controls become always mounted.

The baseline and candidate must render byte-for-byte-equivalent fixture data. Do not compare the current untimestamped fixture against a timestamped candidate; that would confound formatter and DOM costs with the implementation change.

Profile a production application preview, not the dev server. Record:

- commit/build identifier;
- Chrome version and OS;
- viewport and CPU throttling;
- fixture item/message/image counts;
- total DOM node count;
- initial scripting, style, and layout time;
- pointer traversal across alternating rows;
- keyboard traversal across several copy actions;
- JS heap after the fixture settles.

Capture at least three runs before and after and compare medians. The purpose is to ensure that eliminating timeline-wide reactive hover updates did not introduce a worse initial-render or DOM cost.

If the always-mounted metadata causes a clearly material regression in the 200-row fixture, stop and escalate before merging. The fallback is a `MessageRow.svelte` with row-local reveal state while keeping the copy button permanently mounted and keyboard reachable; do not silently restore timeline-wide hover state or unmount the only action.

### Implementation and measurement outcome — 2026-08-04

This item is **partially closed**. The implementation completed the formatter reuse and removed timeline-level hover writes, but the selected always-mounted metadata strategy produced a material long-history DOM and memory regression. The fallback `MessageRow.svelte` extraction was escalated and explicitly not pursued, so the item must not be treated as fully closed.

Completed behavior:

- `ChatTimeline.svelte` reuses exactly two component-level `Intl.DateTimeFormat` instances.
- `hoveredMessageId`, row enter/leave handlers, and transition-driven conditional metadata mounting were removed.
- Hover and focus reveal are CSS-only, with coarse-pointer visibility and reduced-motion handling.
- Copy actions are mounted before pointer interaction and remain keyboard reachable.
- The focused component suite passed 31 tests; the full unit suite passed 230 tests; `npm run check` completed with zero errors or warnings.
- The maintained `/demo/timeline-performance` fixture and its Playwright count assertions cover 200 conversational messages, four notices, five closed tool groups, five large fenced code blocks, six images, 200 timestamps, and 200 candidate copy actions.

#### Production-preview profile

Both builds used byte-identical fixture data. The baseline used the old `ChatTimeline.svelte`; the candidate used the CSS-only implementation.

- Repository baseline: `fa433a7fb882`
- Baseline component/fixture hash: `35938326371f08a570232d29a1d1ec6ce26e4737ad01a40e5d4fa514a79643f8`
- Candidate component/fixture hash: `2fc22890c1db9668ab4a05b1d3f8719e91bea2d1639ad662e338076a969ddd97`
- Chrome: `151.0.7922.71`, Linux x86_64
- Viewport: 1280 × 900
- CPU throttling: 4×; network unthrottled
- Runs: three full runs per build
- Per-run flow: reload, settle, hover ten alternating rows, traverse copy actions with nine Tab presses, then idle for one second
- Build caveat: both isolated profile copies made the unrelated invalid endpoint export `MAX_PROMPT_BODY_BYTES` non-exported so the production preview could build. No application source measurement difference was introduced between baseline and candidate by that workaround.

Heap values are `usedJSHeapSize` bytes.

| Build | Run | LCP | INP | Initial DOM | Initial heap | Post-interaction DOM | Post-interaction heap |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Baseline | 1 | 9,754 ms | 25 ms | 2,520 | 8,289,065 | 2,530 | 6,601,397 |
| Baseline | 2 | 9,125 ms | 34 ms | 2,520 | 8,308,572 | 2,530 | 6,604,681 |
| Baseline | 3 | 9,176 ms | 36 ms | 2,520 | 8,203,925 | 2,530 | 6,609,941 |
| **Baseline median** | — | **9,176 ms** | **34 ms** | **2,520** | **8,289,065** | **2,530** | **6,604,681** |
| Candidate | 1 | 9,912 ms | 27 ms | 4,220 | 8,592,337 | 4,220 | 7,272,264 |
| Candidate | 2 | 9,415 ms | 20 ms | 4,220 | 8,569,081 | 4,220 | 7,230,391 |
| Candidate | 3 | 14,471 ms | 27 ms | 4,220 | 8,571,207 | 4,220 | 7,283,432 |
| **Candidate median** | — | **9,912 ms** | **27 ms** | **4,220** | **8,571,207** | **4,220** | **7,272,264** |

Representative single startup traces, which are not three-run medians, produced:

| Main-thread event sum | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| `EvaluateScript` | 2.934 ms | 3.049 ms | +3.9% |
| `UpdateLayoutTree` / style-recalculation proxy | 8.330 ms | 11.906 ms | +42.9% |
| `Layout` | 18.393 ms | 18.402 ms | effectively flat |

Observed interaction behavior:

- The baseline started with no metadata, timestamps, or copy actions mounted. Hovering mounted one metadata block at a time and increased the DOM from 2,520 to 2,530 nodes during traversal.
- The candidate started with 200 metadata blocks, 200 timestamps, and 200 copy actions. Hover traversal kept the DOM at 4,220 nodes and changed only CSS opacity.
- Candidate keyboard focus revealed metadata after the 100 ms transition and Tab reached successive copy actions.
- No console errors, interaction-triggered network requests, broad Svelte invalidation, or candidate DOM churn were observed.
- Candidate median INP improved from 34 ms to 27 ms. Candidate median LCP was 736 ms slower, but LCP was render-delay dominated and included a 14.471-second outlier, so that difference is not attributed solely to this change.

#### Closure decision and remaining work

The candidate added 1,700 initial DOM nodes (**+67.5%**) and increased median post-interaction heap by approximately **10.1%**. The representative style-recalculation proxy also increased by **42.9%**. These results meet this handoff's material-regression escalation threshold even though pointer and keyboard interaction behavior improved.

The CSS-only strategy therefore closes the timeline-wide hover invalidation and formatter-allocation findings only partially. Full closure would require a separately approved implementation that preserves permanently mounted, keyboard-reachable copy actions without the measured metadata DOM overhead. The documented fallback remains a carefully scoped `MessageRow.svelte` extraction with row-local reveal behavior; it is not implemented at this time.

### Acceptance criteria

- `ChatTimeline.svelte` has no timeline-level hover state and no row enter/leave state writes.
- Hovering a row is handled by CSS only.
- The copy action is mounted and in sequential tab order before hover.
- Focusing the action visibly reveals the metadata/action row.
- Touch/coarse-pointer users receive a visible action without hover.
- Exactly two `Intl.DateTimeFormat` instances are reused by the timeline instance, and output remains locale-aware with the same options.
- Existing message copy, code copy, Markdown, attachments, reasoning, and image-viewer tests continue to pass.
- The updated long-history fixture and before/after production measurements are recorded with the implementation.

### Non-goals and risks

- Do not virtualize the timeline in this item.
- Do not change timestamp locale or wording.
- Opacity-hidden metadata remains in the DOM and accessibility tree by design so its action is reachable.
- Always-mounted metadata increases DOM size. This is why the production fixture comparison is mandatory.
- Do not perform a broad `MessageRow` extraction without accounting for Svelte scoped styles used by both finalized and streaming messages.

---

## 3. Add caller-specific image loading policy

**Status:** Open
**Priority:** Low
**Primary files:**

- `src/lib/components/AttachmentPreview.svelte`
- `src/lib/components/ChatComposer/ChatComposer.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/lib/components/ChatComposer/ChatComposer.svelte.spec.ts`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte.spec.ts`

### Goal

Historical thumbnails should advertise lazy loading and asynchronous decoding, while newly selected composer thumbnails should remain explicitly eager. Opening the full image viewer must not depend on the thumbnail loading or decoding first.

### Chosen prop API

Add native-attribute-shaped props to `AttachmentPreview.svelte`:

```ts
type Props = {
  attachment: Attachment;
  onOpen: (image: PreviewImage) => void;
  onRemove?: () => void;
  removeLabel?: string;
  loading?: 'eager' | 'lazy';
  decoding?: 'sync' | 'async' | 'auto';
};
```

Use compatibility defaults:

```ts
loading = 'eager';
decoding = 'auto';
```

Forward them directly to the thumbnail:

```svelte
<img ... {loading} {decoding} />
```

Do not replace these with a vague boolean such as `lazy`. Do not add an `IntersectionObserver`, `$effect`, load state, or a call to `img.decode()`.

### Caller changes

In historical `ChatTimeline.svelte` attachments, pass both attributes explicitly:

```svelte
<AttachmentPreview
  {attachment}
  onOpen={openImageViewer}
  loading="lazy"
  decoding="async"
/>
```

In composer draft attachments, pass eager loading explicitly:

```svelte
<AttachmentPreview
  {attachment}
  onOpen={openImageViewer}
  loading="eager"
  ...
/>
```

The composer may use the `decoding="auto"` default. Do not pass the history's lazy policy into `ImageViewer`; opening a viewer is a direct user request and remains independent/eager.

### Behavior that must remain unchanged

`attachmentDataUrl(attachment)` still constructs the inline URL synchronously before render. Native lazy loading may defer browser fetch/decode work, but it does not defer:

- mounting `AttachmentPreview`;
- evaluating the `$derived` URL;
- constructing/retaining the data-URL string;
- creating list/card DOM;
- retaining attachment data in memory.

The thumbnail button must continue to call `onOpen({ name, src })` immediately. Do not wait for `load`, `complete`, or `decode()`; otherwise an off-screen lazy thumbnail could block its own viewer.

### Focused tests

Update existing caller tests rather than adding a component-only policy test.

In `ChatTimeline.svelte.spec.ts`, extend `renders attachment cards below the message bubble...`:

- select `.attachment-preview-thumbnail`;
- assert `loading="lazy"`;
- assert `decoding="async"`.

In `ChatComposer.svelte.spec.ts`, extend `previews and sends an attachment-only image submission`:

- select `.attachment-preview-thumbnail`;
- assert `loading="eager"`;
- only assert `decoding="auto"` if the implementation intentionally emits the default attribute and the browser test exposes it consistently.

Keep both existing image-viewer tests. Strengthen at least the persisted-history test so it clicks immediately after render, without dispatching or awaiting an image `load` event, and asserts that:

- the image-preview dialog opens;
- the viewer image uses the same data URL;
- closing and reopening still works after a synthetic `load` event.

Do not attempt to prove actual network deferral or decode timing in Vitest. Browser lazy-loading thresholds vary, and tiny `data:` fixtures may decode before test code runs. The deterministic contracts are the caller-specific attributes and viewer independence.

If the long-history fixture is already being edited for issue 2, also assert that all six fixture thumbnails have `loading="lazy"` and `decoding="async"`. Do not add a separate fixture-only change solely to duplicate the component assertions unless the fixture will be used for profiling.

### Production measurement

If the change is described only as adding the loading policy, tests are sufficient. If the PR claims fewer decodes, lower memory, or faster startup, profile a production build with realistic image sizes and record:

- browser/runtime version;
- viewport and scroll position;
- number and size of historical images;
- image decode/network activity before and after scrolling;
- memory before and after opening the viewer.

Do not infer decode-count savings from attribute inspection alone.

### Acceptance criteria

- Historical thumbnails render `loading="lazy"` and `decoding="async"`.
- Newly selected composer thumbnails render `loading="eager"` explicitly.
- `AttachmentPreview` defaults remain eager/auto for any unmodified future caller.
- The viewer opens before any thumbnail `load`/decode signal and still works afterward.
- The viewer itself is not made lazy as part of this change.
- No observer, effect, decode gate, or alternate data-URL construction path is introduced.

### Non-goals and risks

- Native lazy loading is a browser hint, especially for near-viewport and inline data URLs.
- This item does not reduce base64 parsing, URL-string allocation, component count, or retained attachment memory.
- A malformed image may still open the dialog but fail to display pixels; that pre-existing error behavior is out of scope.

---

## Suggested implementation order

1. **Image policy** — smallest change; establishes the caller-specific test pattern.
2. **Timeline hover/formatters** — accessibility-visible and requires production fixture measurement.
3. **Persistence/cursor separation** — largest correctness surface; implement only after the replay/reset tests are understood.

Prefer one commit per item. If issue 2 and issue 3 both update the long-history fixture, they may share a final fixture-only commit, but their source/test changes should remain reviewable separately.

## Validation checklist

For each completed item:

1. add the focused unit/component tests listed above;
2. run the Svelte autofixer for every changed `.svelte` file until it reports no issues or suggestions;
3. run focused tests for the changed area;
4. run `npm run check` and distinguish existing unrelated failures;
5. run `npm run lint`;
6. run `npm run test:unit -- --run`;
7. for rendering, layout, scripting, memory, or image-decode claims, run a production build/preview rather than dev mode;
8. record fixture, browser/runtime version, commands, measurements, and before/after result in the PR or an adjacent performance note.

Suggested focused commands:

```bash
npm run test:unit -- --run src/lib/harness/stream-update-batcher.spec.ts src/lib/harness/workspace.spec.ts
npm run test:unit -- --run 'src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte.spec.ts'
npm run test:unit -- --run src/lib/components/ChatComposer/ChatComposer.svelte.spec.ts
npm run check
npm run lint
npm run test:unit -- --run
```

When a performance acceptance criterion depends on browser behavior, attach the trace or measurement table. Do not close the item based only on source inspection.
