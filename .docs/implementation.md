# Tool-call UI lifecycle and lazy-rendering plan

## Scope

This plan covers the performance finding **“collapsed tool groups are not lazily rendered”** from `.docs/todo-perf-fixes.md` and these related tool-call UI defects:

1. An expanded tool group collapses when the response finalizes.
2. Successful tool calls remain `running` and become `completed` only after the whole response finalizes.
3. Tool arguments are absent until the page is refreshed or the user leaves and returns to the tab.

The findings below come from tracing the current Svelte UI, client batching, SSE contract, server event normalization, and the installed Pi SDK (`@earendil-works/pi-coding-agent` 0.83.0). The existing focused suite passes, but it does not cover these transitions.

## Findings

| Issue | Finding | Severity |
| --- | --- | ---: |
| Collapsed groups eagerly render | Confirmed | High |
| Expansion is lost at finalization | Confirmed | High |
| Successful live tools cannot become completed | Confirmed | High |
| Arguments cannot arrive through the live event contract | Confirmed | High |
| The first guaranteed complete snapshot for an initial prompt is emitted after it settles | Confirmed | High |

### 1. Closed `<details>` elements still mount every tool body

`ChatTimeline.svelte:311-346` always creates:

- `.tool-list`;
- every `.tool-entry`;
- every arguments `<pre>`;
- every nested result `<details>`; and
- every result `<pre>` with its complete output string.

The outer `<details>` only hides those descendants. It does not defer DOM creation, text-node allocation, or Svelte reconciliation. A chat with many large tool outputs therefore pays most of the DOM and memory cost even when every group is closed.

The result disclosure has the same problem independently: its output `<pre>` is mounted while the result is closed.

### 2. Finalization replaces the live disclosure with a differently keyed disclosure

Expansion is currently browser-owned DOM state. Neither the group nor result `<details>` has controlled Svelte state (`ChatTimeline.svelte:315-345`).

The timeline is keyed by `entry.id` (`ChatTimeline.svelte:311`), but the same logical tool group has different IDs across its lifecycle:

- live-only group: `tools-live` (`ChatTimeline.svelte:139-145`);
- persisted group: `tools-${assistantItem.id}` (`ChatTimeline.svelte:105-115`).

When a snapshot arrives, `HarnessWorkspace.#applySnapshot()` replaces the snapshot and clears `chat.streamTools` (`workspace.svelte.ts:753-764`). Svelte removes the keyed `tools-live` node and creates a new persisted node, whose native `open` property defaults to `false`.

This directly explains why an expanded group collapses when the response finalizes. The stable identity available on both sides of the handoff is the tool-call ID, not the synthesized timeline-entry ID.

### 3. A successful execution end is indistinguishable from an execution update

`normalizePiEvent()` maps both `tool_execution_update` and `tool_execution_end` to the same `tool_update` event (`pi.ts:503-521`). The event contract contains only:

- tool-call ID;
- tool name;
- output text; and
- optional `isError`.

A successful end has no error and no terminal/completed marker. `StreamingTool` has the same limitation (`harness/types.ts:41-46`).

`toolStatus()` can return `completed` only when an authoritative snapshot contains a matching tool-result item. Otherwise, any non-error stream object is `running` (`ChatTimeline.svelte:167-177`). The UI therefore cannot mark a successful live tool completed, regardless of event ordering.

### 4. Arguments exist only in authoritative snapshot data

Persisted arguments are serialized from assistant `toolCall` content by `toolCallsFromContent()` (`pi.ts:143-166`) and exposed through `RuntimeSnapshot.items`. The live `tool_update` contract and `StreamingTool` contain no arguments field.

The installed Pi SDK already exposes the required data:

- `message_update.toolcall_end` contains the finalized tool call;
- `tool_execution_start` contains `toolCallId`, `toolName`, and `args`;
- `tool_execution_update` also contains `args`; and
- `tool_execution_end` is the explicit terminal event.

The application currently ignores `toolcall_end` and `tool_execution_start`. As a result, there is no production path by which arguments can appear in a live-only tool row.

### 5. Snapshot timing makes all three symptoms converge at prompt finalization

`attachSessionEvents()` publishes snapshots for `entry_appended` and `session_info_changed` (`runtimes.ts:202-204`). With the installed SDK, ordinary assistant/tool-result messages are persisted on `message_end`, but normal persistence does not emit the `entry_appended` event used by this listener.

For an initial, nonqueued prompt, the first unconditional complete snapshot is `publishSnapshot(record)` in `promptRuntime().finally()` (`runtimes.ts:397-410`). It runs after that prompt/agent response settles. A prompt submitted while the SDK is already streaming is different: SDK 0.83.0 queues it and returns immediately, so that request's `finally()` can publish an **intermediate streaming snapshot**. The implementation must therefore distinguish `snapshot.isStreaming === true` from a terminal snapshot rather than treating every snapshot as final.

Consequences:

- live arguments remain unavailable until hydration or the final snapshot;
- successful tools remain `running` until the final snapshot supplies result items;
- the final snapshot replaces `tools-live`, which collapses the disclosure;
- refreshing or re-entering a tab calls runtime hydration and obtains persisted arguments/results, matching the reported workaround.

The SSE broker and endpoint do not strip fields. The missing information originates in the normalized event/domain schema before publication.

## Target behavior

```text
Pi toolcall_end / tool_execution_start
  -> live tool patch with ID, name, arguments, and status
  -> client merges the patch by tool-call ID
  -> tool group can show arguments before a final snapshot

Pi tool_execution_update
  -> live output patch, status running

Pi tool_execution_end
  -> live output patch, status completed or failed
  -> UI updates immediately, before the overall response settles

Authoritative snapshot
  -> persisted call/result data supersedes matching live data
  -> streaming snapshot retains live tools
  -> terminal snapshot clears the live lifecycle
  -> disclosure state remains keyed by tool-call IDs

Collapsed group
  -> summary only; no tool rows, arguments, or outputs in the DOM

Expanded group, closed result
  -> tool metadata and arguments mounted; result output still absent

Expanded result
  -> result output mounted
```

## Implementation plan

### 1. Represent the complete live tool lifecycle

**Files:**

- `src/lib/contracts.ts`
- `src/lib/harness/types.ts`
- `src/lib/server/pi.ts`

Add an explicit live status type:

```ts
type ToolStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
```

Extend the `tool_update` event and client representation with:

- `status`;
- optional serialized `arguments`;
- optional `text` so start/pending events do not need fake output.

Normalize SDK events as follows:

| Pi event | Live status | Arguments | Output |
| --- | --- | --- | --- |
| `message_update.toolcall_end` | `pending` | finalized call arguments | none |
| `tool_execution_start` | `running` | `event.args` | none |
| `tool_execution_update` | `running` | `event.args` | partial result |
| `tool_execution_end` | `completed` or `failed` | omitted/preserved | final result |

Do not stream every `toolcall_delta` in the first implementation. Publishing the finalized call and execution start makes arguments available before execution output without adding high-frequency JSON serialization and UI churn.

Use one shared argument serializer so snapshot and live formatting are identical. Tool arguments are expected to be JSON-compatible; if serialization unexpectedly fails, preserve the tool lifecycle event and use a safe fallback rather than dropping the call.

### 2. Merge patches without losing arguments or terminal status

**Files:**

- `src/lib/harness/stream-update-batcher.ts`
- preferably a new pure helper such as `src/lib/harness/streaming-tools.ts`

The current animation-frame map keeps only the last complete `StreamingTool` object for an ID. That would lose arguments when start and update/end events occur in the same frame.

Change tool batching to merge patches by ID:

- retain previously received arguments when a later patch omits them;
- retain the latest output text;
- advance status in source order;
- never regress `completed` or `failed` back to `running` from a late update;
- keep tools with distinct IDs isolated;
- continue committing at most once per animation frame.

Keep patch-merge rules in pure functions and unit-test them separately from Svelte state.

### 3. Preserve ordered live tools across streaming snapshots and clear them at terminal snapshots

**Files:**

- `src/lib/harness/stream-update-batcher.ts`
- `src/lib/harness/workspace.svelte.ts`

Do not add general ID-based reconciliation between HTTP snapshots and SSE events in this change. `RuntimeSnapshot` has no event revision, while only SSE envelopes have IDs; hydration and replay can arrive independently. Without a shared revision/high-water mark, arbitrary cross-source reconciliation cannot prove which side is newer.

Use the narrower lifecycle rule needed by this fix:

1. When handling an **SSE snapshot envelope**, synchronously drain already queued lower-order tool patches for that chat before applying the snapshot. Continue discarding stale assistant preview timers/deltas as today.
2. If `snapshot.isStreaming === true`, retain `chat.streamTools`. This covers queued-prompt/intermediate snapshots that do not yet contain all calls/results.
3. If `snapshot.isStreaming === false`, clear `chat.streamTools`. A terminal snapshot ends the live lifecycle and prevents unexecuted calls from remaining live forever.
4. Persisted call arguments/results remain higher priority than retained stream fields in the timeline.

Do not use “snapshot has a matching result” as the only cleanup rule. SDK 0.83.0 can finalize an errored/aborted assistant message containing a tool call without executing it, so no tool-result item will ever appear for that call.

The pre-existing HTTP hydration versus SSE replay ordering problem should be recorded as a separate follow-up. Solving it correctly requires a server-provided snapshot revision/cursor and an explicit buffering/replay protocol; it should not be hidden inside tool-ID merge logic.

### 4. Derive status and arguments from authoritative-or-live data

**File:** `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`

Update the joined `ToolView` rules:

- arguments: persisted call arguments first, then streamed arguments;
- status: persisted result first, then explicit streamed status, otherwise `pending`;
- terminal orphan status: if the owning assistant item ended with `stopReason: 'aborted'` and has no result, show `cancelled`; if it ended in error, show `failed`;
- output: persisted result first, then streamed output;
- use nullish/explicit checks rather than `||`, so an authoritative empty result does not incorrectly fall back to stale streamed text.

As a cheap adjacent optimization, build `Set`/`Map` indexes once per timeline derivation for called IDs, results by call ID, and streams by call ID. This removes the current repeated `includes()`/`find()` scans during tool updates.

### 5. Extract and lazily render tool disclosures

**Files:**

- new `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- optionally a small `ToolEntry.svelte` if `ToolGroup.svelte` becomes large
- `ChatTimeline.svelte`

Move tool-group presentation out of the already large timeline component. Keep timeline construction/orchestration in `ChatTimeline`; keep disclosure markup and tool presentation in the extracted component.

Required lazy behavior:

- while the group is closed, render only its `<summary>`;
- mount reasoning, tool rows, and arguments only while the group is open;
- mount a result `<pre>` only while that individual result is open;
- unmount the group body again when it closes, reclaiming large DOM/text nodes;
- preserve result-open state while the outer body is unmounted so reopening the group restores the user’s disclosure choices.

Use event handlers and controlled disclosure state; do not add `$effect` for state synchronization.

### 6. Preserve disclosure state by tool-call identity

**Files:**

- `ChatTimeline.svelte`
- `ToolGroup.svelte`

Store group/result expansion by namespaced tool-call ID (for example, chat ID plus tool-call ID), not by `TimelineEntry.id` or object identity.

For a group:

- it is open when any contained tool ID is marked open;
- opening marks its current tool IDs;
- closing clears its current tool IDs.

This handles:

- `tools-live` becoming `tools-${assistantItem.id}`;
- cloned/replaced snapshot objects;
- live tools being merged into an existing persisted batch; and
- consecutive assistant tool batches being merged into one visual group.

Use Svelte’s reactive collection support or equivalent component state so toggles update declaratively. The official Svelte API supports controlling native disclosures through the `open` property/`bind:open`; the implementation should keep the DOM state and call-ID state consistent through explicit toggle handlers.

Changing the synthesized timeline key alone is not sufficient because group merging can change the first persisted entry. Call-ID-backed state is the durable boundary.

### 7. Add regression stories and tests

**Files:**

- `src/lib/server/pi.spec.ts`
- `src/lib/harness/stream-update-batcher.spec.ts`
- tests for the pure streaming-tool merge helper
- focused workspace/runtime boundary tests
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte.spec.ts`
- new `ChatTimeline.stories.svelte`

#### Server normalization

Cover:

- finalized tool-call arguments becoming a pending live event;
- start becoming running with arguments;
- update retaining running status and partial output;
- successful end becoming completed;
- failed end becoming failed;
- successful end being structurally distinguishable from an update.

#### Client merge and snapshot boundaries

Cover:

- start + update + end in one animation frame preserves arguments and completed status;
- terminal status cannot regress;
- two tools do not mix state;
- an intermediate `isStreaming: true` snapshot retains live tools;
- a terminal `isStreaming: false` snapshot clears live tools;
- queued patches are drained in SSE source order before a streaming snapshot, while a terminal snapshot safely clears the live lifecycle;
- an errored/aborted assistant tool call without a result does not remain `running` or `pending` forever;
- a queued prompt's immediate/intermediate snapshot is not mistaken for whole-agent finalization.

Keep direct component rerender tests for presentation, but add a focused workspace/runtime integration seam for snapshot handling; `ChatTimeline` tests alone cannot validate `#applySnapshot()` ordering.

#### Component behavior

Add browser component tests that assert DOM presence, not only visibility:

1. A closed group has no `.tool-list`, argument `<pre>`, or result output in the DOM.
2. Opening the group mounts arguments but not a closed result’s `<pre>`.
3. Opening the result mounts its output.
4. Closing the group removes the heavy body; reopening restores disclosure state.
5. A live-only expanded group remains expanded after rerendering with the final snapshot for the same tool ID.
6. A successful live end changes the summary and heading to `completed` before any final snapshot.
7. Live arguments are visible no later than execution start.
8. Failed, cancelled, and empty-output tools retain correct status and fallback behavior.

Add stories for collapsed, expanded/large-output, running-to-completed, and failed tool groups. Before creating the story, fetch the current Storybook story instructions. After UI implementation, preview the relevant stories and run Storybook story tests as required by the project workflow.

## Implementation order

1. Extend contracts and Pi event normalization.
2. Add patch merging and ordered streaming/terminal snapshot handling.
3. Update timeline status/argument precedence and indexes.
4. Extract `ToolGroup` and implement call-ID-backed controlled expansion.
5. Add lazy DOM mounting for group and result bodies.
6. Add component stories and regression tests.
7. Run focused tests, then full validation.

This order makes the UI component consume a stable lifecycle contract rather than embedding transport workarounds.

## Validation

During implementation, run:

1. focused server, merge-helper, batcher, and timeline component specs;
2. Svelte autofixer on every changed/new `.svelte` file until it reports no issues;
3. `npm run check`;
4. Storybook previews for every affected story and `run-story-tests` through the Storybook MCP workflow;
5. `npm run lint`;
6. `npm run test:unit -- --run`.

Manual runtime scenario:

1. Start a tool that has recognizable arguments and streamed output.
2. Confirm arguments appear when execution starts.
3. Expand its group and result while it is running.
4. Confirm a successful end changes to `completed` while the assistant continues.
5. Confirm final response settlement does not close either disclosure.
6. Close the group and verify its large body is removed from the DOM.
7. Refresh and confirm the authoritative snapshot produces the same arguments, result, and status.

## Acceptance criteria

- Collapsed tool groups do not mount tool rows, arguments, reasoning bodies, or result bodies.
- Closed result disclosures do not mount output text.
- Closing an opened group releases its heavy body from the DOM.
- Expansion survives live-to-final snapshot replacement for the same tool-call IDs.
- Successful and failed tool ends update immediately without waiting for the overall response to settle.
- Arguments appear in the live UI by `tool_execution_start` at the latest.
- Batched patches cannot lose arguments or regress a terminal status.
- Streaming snapshots do not erase live tool state; terminal snapshots end and clear it.
- Aborted/errored tool calls without results do not remain live indefinitely.
- Final snapshot data remains authoritative and does not duplicate tool rows.
- Focused tests, Svelte checks, Storybook story tests, lint, and the unit suite pass.

## Non-goals and follow-ups

Not required for this fix:

- character-by-character rendering of tool-call JSON;
- full conversation virtualization;
- an incremental snapshot protocol for every persisted message;
- a snapshot revision/cursor protocol that fully orders HTTP hydration against SSE replay;
- truncating or paging very large tool output.

After lazy mounting is measured, consider a separate output-preview policy (for example, a bounded tail plus “Show full output”) if expanded multi-megabyte results still cause unacceptable memory or layout cost.

Also track the hydration/replay race separately: `RuntimeSnapshot` currently has no broker revision, so a complete fix needs an atomic server snapshot cursor plus client buffering rules, not heuristic tool-ID reconciliation.
