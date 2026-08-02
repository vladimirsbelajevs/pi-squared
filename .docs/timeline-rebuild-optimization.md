# Timeline rebuild optimization plan

## Scope

This plan covers the **longer-term protocol fix** from `.docs/todo-perf-fixes.md`, section **“7. Medium: snapshots and timeline construction rebuild too much.”**

The goal is to stop rebuilding, transferring, and replacing the complete conversation during normal progression while retaining full authoritative checkpoints for hydration and recovery.

## What is already implemented

The related work in `.docs/implementation.md` addressed part of the original finding, but not the longer-term protocol change.

Already implemented on `main`:

- `ChatTimeline.svelte` builds `Set`/`Map` indexes for called tool IDs, persisted results, and live tool state. This is the cheap `O(items + tools)` optimization proposed in `.docs/todo-perf-fixes.md`.
- Tool updates are merged by tool-call ID and frame-batched.
- Streaming snapshots retain live tools, while terminal snapshots clear them.
- Tool disclosure state is keyed by tool-call identity and tool bodies are lazily mounted.
- Persisted `ChatItem.id` values already come from Pi session-entry IDs and are suitable stable identities.

Still not implemented:

- `buildSnapshot()` still reads and maps the complete active branch.
- `publishSnapshot()` still sends the complete `RuntimeSnapshot` for routine changes and prompt settlement.
- The client still replaces `chat.snapshot` wholesale in `#applySnapshot()`.
- There are no incremental persisted-item events, normalized `itemsById`/`itemOrder` state, runtime revisions, or checkpoint cursors.
- HTTP hydration and SSE replay cannot be ordered reliably because snapshots do not say which stream events they include.
- Replay overflow and server restart are silent because the broker has a bounded numeric replay buffer but no epoch or reset response.
- A live tool update still invalidates the main timeline derivation because that derivation reads `chat.streamTools`, even though its joins are now linear.

`.docs/implementation.md` explicitly treated a snapshot revision/cursor protocol and incremental snapshots as follow-up work. Its current snapshot handling is a narrow tool-lifecycle rule, not a general solution to hydration, replay, or conversation replacement.

## Current hot path

```text
Pi session changes
  -> publishSnapshot(record)
  -> buildSnapshot()
  -> sessionManager.getBranch()
  -> map every visible entry to a new ChatItem
  -> serialize and send the complete RuntimeSnapshot
  -> client replaces chat.snapshot
  -> timeline walks the complete items array again
```

The keyed Svelte loop can preserve DOM nodes by ID, but it cannot avoid the server mapping, network transfer, JSON parsing, new object allocation, snapshot replacement, or timeline derivation work.

## Target behavior

```text
Initial hydration / recovery
  -> atomic checkpoint with full items, metadata, live stream state,
     runtime revision, and stream cursor

Normal persisted progression
  -> items_appended with only new ChatItem values
  -> item_updated only when a stable item changes
  -> items_replaced for branch/recovery/compaction ambiguity

Normal metadata progression
  -> revisioned metadata patches

Client
  -> itemsById + itemOrder
  -> preserve unaffected ChatItem references
  -> rebuild finalized timeline only when persisted items/order change
  -> apply live assistant/tool updates without rebuilding historical entries

Replay gap / server restart / revision mismatch
  -> explicit reset_required
  -> fetch a fresh checkpoint
  -> discard events included by the checkpoint
  -> apply only newer buffered events
```

Full checkpoints remain part of the design. Incremental events are an optimization and live-update mechanism, not the sole recovery source.

## Protocol invariants

The implementation should keep three identities separate:

1. **Transport cursor**: identifies an SSE envelope and detects replay gaps or broker restarts.
2. **Per-runtime revision**: orders mutations to one runtime projection and detects missing or out-of-order runtime events.
3. **Domain identity**: `ChatItem.id`, tool-call ID, and permission-request ID identify the actual entities.

Required invariants:

- A checkpoint cursor means every event for that runtime at or before that cursor is reflected in the checkpoint.
- A checkpoint captured during streaming includes the authoritative accumulated live text, thinking, and tool state. It must not claim streamed deltas that it does not represent.
- Projection mutation, revision assignment, and event publication occur synchronously in source order without an `await` between them.
- Incremental events apply only when `baseRevision` equals the client’s current runtime revision.
- Duplicate events are idempotent.
- A revision gap, expired replay cursor, or broker epoch change stops incremental application and triggers checkpoint recovery.
- Persisted Pi entry IDs remain message identities. SSE IDs and optimistic pending-message IDs must not replace them.
- Any active-branch change that cannot be proven to be a suffix append falls back to an authoritative replacement/checkpoint.

## Proposed contracts

Names can be adjusted during implementation, but the protocol needs equivalent information.

```ts
interface StreamCursor {
  epoch: string;
  sequence: number;
}

interface RuntimeLiveState {
  text: string;
  thinking: string;
  tools: StreamingTool[];
}

interface RuntimeCheckpoint {
  protocolVersion: 2;
  cursor: StreamCursor;
  revision: number;
  snapshot: RuntimeSnapshot;
  live: RuntimeLiveState;
}

type RevisionedRuntimeEvent =
  | {
      type: 'items_appended';
      baseRevision: number;
      revision: number;
      afterId?: string;
      items: ChatItem[];
    }
  | {
      type: 'item_updated';
      baseRevision: number;
      revision: number;
      item: ChatItem;
    }
  | {
      type: 'items_replaced';
      baseRevision: number;
      revision: number;
      items: ChatItem[];
      reason: 'branch' | 'compaction' | 'recovery';
    }
  | {
      type: 'metadata_updated';
      baseRevision: number;
      revision: number;
      patch: RuntimeMetadataPatch;
    };
```

Existing state-bearing events—assistant deltas, tool updates, streaming state, MCP status, and permission lifecycle events—also need revision semantics because they are represented by a checkpoint. Transient notices and errors may remain transport-only if they are intentionally not recoverable state.

Use an opaque SSE event ID such as `epoch:sequence`. The browser and local storage should treat it as a string rather than parse it as a globally durable numeric revision.

## Implementation plan

### Phase 1: Add protocol and replay foundations without removing snapshots

**Files:**

- `src/lib/contracts.ts`
- `src/lib/server/event-broker.ts`
- `src/routes/api/events/+server.ts`
- `src/lib/harness/api.ts`
- `src/lib/harness/types.ts`

Implement:

1. Add protocol-version, stream-cursor, runtime-revision, checkpoint, and reset-control types.
2. Give each broker process a random epoch and monotonically increasing sequence.
3. Change SSE IDs and persisted workspace cursors from `number` to opaque strings.
4. Make broker subscription distinguish:
   - valid replay;
   - a cursor older than the retained replay head;
   - a cursor from a previous epoch.
5. Emit an explicit connection-level `reset_required` control message for expired or foreign cursors. Do not silently replay only the retained suffix.
6. Add a synchronous broker API for reading/reserving the current cursor so checkpoint capture can be atomic with publication ordering.
7. Keep legacy full `snapshot` events during this phase so behavior does not change before recovery semantics are tested.

Persisted workspace data needs a schema migration. Old numeric `lastEventId` values should be discarded safely, not interpreted as protocol-v2 cursors.

### Phase 2: Introduce a server-side runtime projection and atomic checkpoints

**Files:**

- `src/lib/server/runtimes.ts`
- `src/lib/server/pi.ts`
- `src/lib/server/assistant-delta-batcher.ts`
- `src/lib/server/permission-bridge.ts`
- runtime GET/create/mutation API routes

Add a materialized projection to each `RuntimeRecord` containing:

- ordered persisted items and the current source leaf ID;
- model, thinking level, session name, streaming state, MCP status, token/context usage, fallback message, and permissions;
- accumulated live assistant text/thinking/tools;
- the current per-runtime revision.

Centralize runtime publication in one operation:

```text
flush an earlier delayed delta when required
-> mutate the server projection
-> increment the runtime revision
-> publish the revisioned event
```

Checkpoint capture must:

1. synchronously flush the assistant delta batcher;
2. snapshot the projection, including live state;
3. capture the current broker cursor;
4. return `{ checkpoint }` without an `await` inside that critical section.

Change runtime creation and GET hydration endpoints to return checkpoints. Model, thinking, and MCP mutation endpoints may also return checkpoints initially; these operations are infrequent and an authoritative response is safer than an unversioned snapshot.

Do not remove `buildSnapshot()` yet. Use it as the authoritative initializer and as a shadow-equivalence oracle while the projection is introduced.

### Phase 3: Emit persisted-item changes safely

**Files:**

- `src/lib/server/runtimes.ts`
- `src/lib/server/pi.ts`
- `src/lib/server/pi.spec.ts`
- `src/lib/server/runtimes.spec.ts`

Pi’s installed SDK notifies session listeners of `message_end` before it appends the ordinary user, assistant, or tool-result message to `SessionManager`. Therefore, reading the branch directly inside that listener is too early.

Implement a coalesced post-persistence projection refresh, for example with a microtask scheduled from `message_end`. The refresh should:

1. read the current leaf and walk parents back to the projection’s known source leaf;
2. if the known leaf is reached, reverse and map only the new suffix;
3. emit one `items_appended` event containing all newly visible items;
4. update the source leaf even when an entry does not map to a visible `ChatItem`;
5. if the old leaf is not an ancestor, rebuild the active order and emit `items_replaced` or require a checkpoint;
6. retain a terminal prompt-settlement refresh as a correctness fallback.

Session entries are currently append-only, so `item_updated` may be rare. Keep it in the protocol for browser-safe representation changes and forward compatibility, but do not invent updates when append/replacement is sufficient.

For metadata:

- publish `isStreaming`, MCP status, permissions, model, thinking level, session name, token/context usage, and fallback-message changes as revisioned projection patches;
- avoid publishing a full item list for metadata-only changes;
- compare patches against the materialized projection so unchanged values do not generate events.

During this phase, compare the materialized projection with `buildSnapshot()` at terminal boundaries in tests or development assertions. Do not cut over until they remain equivalent across normal, queued, tool-heavy, aborted, and compacted turns.

### Phase 4: Add a pure normalized client reducer and correct hydration ordering

**Files:**

- new `src/lib/harness/runtime-state.ts`
- new `src/lib/harness/runtime-state.spec.ts`
- `src/lib/harness/types.ts`
- `src/lib/harness/workspace.svelte.ts`
- `src/lib/harness/pending-user-messages.ts`

Represent authoritative conversation state as:

```ts
interface RuntimeConversationState {
  revision: number;
  itemsById: Map<string, ChatItem>;
  itemOrder: string[];
  metadata: RuntimeMetadata;
  live: RuntimeLiveState;
}
```

Keep reducer logic pure. Adapt it to Svelte state at the workspace boundary using reactive collections or assignments; do not use `$effect` to synchronize duplicate state.

Reducer behavior:

- `items_appended`: assert `afterId`, insert only unknown suffix IDs, and keep every unaffected object reference.
- `item_updated`: replace only the matching item and preserve its position.
- `items_replaced`/checkpoint: replace membership and order, but reuse existing `ChatItem` references when values are unchanged.
- metadata patch: change only supplied fields.
- duplicate revision: ignore when already applied.
- wrong `baseRevision`: enter recovery state instead of guessing.
- incremental append/replacement: run pending-user-message reconciliation against the affected authoritative state.

Correct startup and rehydration ordering:

1. open SSE and buffer events for chats that are hydrating;
2. fetch an atomic runtime checkpoint;
3. apply the checkpoint and its exact runtime revision;
4. discard buffered events from the same epoch at or before the checkpoint cursor;
5. apply newer buffered events in sequence;
6. continue live application;
7. on `reset_required` or a revision gap, buffer new events, fetch another checkpoint, and repeat.

State-bearing events should update the pure raw runtime projection immediately. Existing animation-frame batching and Markdown throttling can remain a separate presentation layer, so visual rendering stays bounded without delaying protocol revision advancement.

Retain a temporary compatibility accessor for consumers that still expect `RuntimeSnapshot`/ordered `items`. Remove wholesale `chat.snapshot = snapshot` replacement once all consumers use the normalized state.

### Phase 5: Separate finalized timeline construction from live overlays

**Files:**

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- optionally new `src/lib/harness/timeline.ts`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`

Extract finalized timeline construction into a pure helper and make its dependencies only:

- ordered persisted items;
- pending user messages;
- finalized display options such as `showModelChanges`.

Do not read `streamText`, `streamThinking`, or the complete `streamTools` collection while building finalized historical entries.

Normalize live tools by ID and preserve their order separately. A persisted tool group should resolve only the live IDs it owns, while a small live-only group renders stream tools not yet represented by persisted calls. This allows one tool update to change its tool group without rebuilding every historical item.

Expected invalidation boundaries:

| Change | Work allowed |
| --- | --- |
| Assistant text/thinking delta | Update streaming presentation only |
| One tool lifecycle update | Update that tool/live group only |
| Persisted suffix append | Add/recompute the new finalized suffix |
| Item update | Replace/recompute the affected entry/group |
| Metadata patch | Update only metadata consumers |
| Checkpoint/replacement | Full reconciliation allowed |

A full variable-height virtualizer is not part of this work. Optimize protocol and invalidation boundaries first, then profile long conversations again.

### Phase 6: Cut over and remove routine full snapshots

After checkpoint, reducer, and shadow-equivalence tests pass:

1. stop publishing a full snapshot for ordinary prompt settlement and routine entry progression;
2. retain checkpoints for initial/resumed hydration, explicit recovery, replay overflow/restart, active-branch replacement, and occasional authoritative verification;
3. remove the legacy `snapshot` SSE event after the migration window;
4. remove obsolete `#applySnapshot()` lifecycle work and compatibility state;
5. retain `buildSnapshot()` or an equivalent checkpoint builder for recovery, not for every normal event;
6. add instrumentation comparing bytes/events and timeline-builder calls before and after cutover.

## Testing plan

### Event broker

Add focused tests for:

- monotonic cursors within one epoch;
- exact replay after a valid cursor;
- cursor older than the retained head producing `reset_required`;
- previous-process epoch producing `reset_required`;
- subscription not losing an event between replay and listener registration;
- duplicate reconnect delivery remaining idempotent.

### Checkpoint and projection

Cover:

- an event before the checkpoint cursor being represented by the checkpoint;
- an event after the cursor being buffered/replayed;
- a streaming checkpoint containing the complete accumulated text, thinking, and tools;
- assistant batching being flushed before checkpoint capture;
- ordinary `message_end` becoming an append only after SDK persistence;
- multiple newly persisted entries being coalesced into one append;
- model/thinking/session info and compaction entries;
- branch divergence falling back to replacement;
- terminal projection equivalence with `buildSnapshot()`;
- aborted/error turns and tool calls without results.

### Client reducer and hydration races

Use table-driven tests for:

- SSE arriving before HTTP hydration completes;
- HTTP checkpoint arriving before SSE;
- duplicate replay;
- stale checkpoint response;
- runtime revision gap;
- replay expiration and epoch change;
- permission request/resolution around a checkpoint;
- model/MCP metadata changes around a checkpoint;
- no missing or duplicated streaming prefix;
- optimistic user-message reconciliation after an append.

### Timeline regression and performance

Cover:

- appending one item preserves `===` identity for all previous items;
- updating one item preserves order and unrelated references;
- replacement removes abandoned items;
- a tool update does not rerun the finalized timeline builder;
- finalized tool disclosure state survives append/checkpoint reconciliation;
- existing lazy-rendering and live-to-final tool tests remain green.

Add a representative benchmark fixture with 100–200 persisted messages and many tool groups. Record:

- bytes sent for one appended item;
- number of `mapSessionEntry()` calls;
- number of finalized timeline-builder calls during assistant and tool streaming;
- checkpoint/recovery duration.

## Validation order

During implementation, run:

1. focused broker, projection, reducer, and timeline tests;
2. `npm run check`;
3. Svelte autofixer on every changed `.svelte` file until no issues or suggestions remain;
4. `npm run lint`;
5. `npm run test:unit -- --run`;
6. targeted Playwright/Storybook tests only if presentation behavior changes.

## Acceptance criteria

- Normal persisted progression sends only appended/updated items or a bounded metadata patch, not the complete history.
- `buildSnapshot()` is not called for each ordinary persisted message or terminal prompt boundary.
- Initial hydration and recovery still use a complete authoritative checkpoint.
- HTTP hydration cannot overwrite newer SSE state.
- Hydrating during streaming cannot lose the already-generated assistant/tool prefix.
- Replay overflow and server restart are detected explicitly and recover through a checkpoint.
- Per-runtime revision gaps never apply heuristically.
- Unaffected `ChatItem` object references survive appends, updates, and checkpoint reconciliation.
- Assistant deltas do not rebuild finalized history.
- A live tool update does not rebuild every historical timeline entry.
- Branch or compaction ambiguity safely falls back to replacement/checkpoint behavior.
- Existing pending-message, tool lifecycle, lazy rendering, permission, model, and MCP behavior remains correct.

## Risks and mitigations

### Pi SDK persistence timing

`message_end` listeners run before ordinary message persistence. Reading the branch synchronously in that callback will miss the new entry.

**Mitigation:** use a coalesced post-persistence refresh and lock the installed SDK ordering into an integration test.

### False checkpoint atomicity

Building a snapshot and reading the broker cursor in separate asynchronous steps recreates the hydration race.

**Mitigation:** centralize projection mutation/publication/checkpoint capture and prohibit `await` inside the critical section.

### Missing streaming prefixes

A persisted-items-only checkpoint cannot claim a cursor that includes prior assistant/tool deltas.

**Mitigation:** materialize live state server-side and include it in streaming checkpoints.

### Branch and compaction behavior

Pi session history is append-only, but the visible active path can change.

**Mitigation:** assert ancestry/tail identity for appends and fall back to authoritative replacement on any mismatch.

### Client state duplication

Keeping both normalized state and a mutable snapshot as authorities would introduce synchronization bugs.

**Mitigation:** use one normalized authority and only a temporary read-only compatibility projection during migration. Do not synchronize copies with `$effect`.

### Multi-process deployment

The current runtime map and broker are process-local. Epoch/revision semantics do not create cross-process ordering by themselves.

**Mitigation:** document single-process ownership as an explicit assumption. A shared durable event log or sticky runtime owner is a separate deployment project.

## Non-goals

- Full conversation virtualization.
- Incremental Markdown parsing or changes to the current Markdown throttle.
- Large tool-output truncation or paging.
- Replacing Pi’s session-entry IDs or JSONL storage model.
- Making optimistic UI IDs equal future Pi entry IDs.
- Adding session-tree/branch-navigation UI.
- Cross-process durable replay or offline event history.
- Removing authoritative full checkpoints.
