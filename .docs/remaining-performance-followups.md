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
| High | Long-conversation DOM growth | Open |
| High | Eager hydration of restored chat tabs | Open |
| Medium | Live tool updates invalidate unrelated tool-group inputs | Partially fixed |
| Medium | Project file autocomplete rescans the filesystem | Open |
| Medium | Attachment files are read, decoded, and validated repeatedly | Open |
| Low | Stream presentation flushes are coupled to workspace/cursor persistence | Open |
| Low | Timeline-wide hover state and formatter allocation | Open |
| Low | Historical image previews are not browser-lazy | Open |
| Low | Finalized Markdown has no explicit cache | Measure first |

---

## 1. Long-conversation DOM growth

**Status:** Open  
**Priority:** High

### Current behavior

`ChatTimeline.svelte` renders every finalized entry through one keyed `{#each}` block. Finalized message DOM, rendered assistant HTML, attachment components, metadata-row shells, and collapsed `ToolGroup` roots remain mounted.

`ToolGroup.svelte` conditionally mounts its tool list and result bodies, and message metadata content is mounted only while a row is hovered. Historical image elements are still inserted without native lazy-loading hints, and their data URLs are constructed eagerly. Exact image decode timing is browser-controlled.

Keying preserves component and DOM identity; it does not bound DOM size or prevent eager Markdown parsing and HTML construction.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- `src/lib/components/AttachmentPreview.svelte`
- `src/lib/components/WorkspaceScrollArea.svelte`

### Recommended rollout

1. Add a low-risk containment layer in each component that owns the affected element:

   ```css
   .message-entry,
   .timeline-notice,
   .stopped-row {
     content-visibility: auto;
     contain-intrinsic-size: auto 240px;
   }
   ```

   Apply the equivalent `.tool-group` rule inside `ToolGroup.svelte`; parent-scoped CSS cannot reliably style a child component's scoped class.

2. Treat containment only as a layout/paint optimization. It does not avoid Svelte component creation, MarkdownIt/Highlight.js work, `{@html}` DOM construction, or attachment data-URL construction.
3. Add a representative 100–200 message fixture with large highlighted code blocks, attachments, notices, and tool groups. Profile a production build/preview and record scripting, DOM-node count, layout, paint, and memory separately.
4. Extract a `MessageRow.svelte` boundary only if it is used to localize state, memoize row work, or support windowing. Component extraction alone is not a performance fix.
5. If scripting, DOM count, or memory remains excessive, add variable-height windowing for finalized history. Keep streaming content outside the finalized-history window.
6. Before windowing, extend scroll state from raw `scrollTop`/bottom pinning to a stable anchor item ID plus offset. Preserve the current pinned-to-bottom behavior.
7. Keep disclosure state outside windowed rows, keyed by stable tool-call IDs, so it survives unmount/remount.

### Acceptance criteria

- If containment is retained, production profiling demonstrates that it reduces off-screen layout/paint work.
- The 200-message fixture has documented scripting, DOM-count, layout, paint, and memory results.
- If containment is declared sufficient, the profile—not only the presence of CSS—supports that decision.
- If windowing is required, expensive off-screen rows are not mounted outside the configured overscan window.
- Appending a message while pinned remains pinned.
- Reading older history does not jump when rows above or below change height.
- If windowing is implemented, tool disclosure state survives rows leaving and re-entering the rendered window.

---

## 2. Eager hydration of restored chat tabs

**Status:** Open  
**Priority:** High

### Current behavior

After projects, models, and sessions load, workspace startup restores tab metadata, opens the global SSE connection, and awaits `ensureChat()` for every restored chat. A valid persisted runtime ID is checkpointed with `GET`; a missing or stale ID creates a resumed `AgentSession`, binds extensions, and allocates a new server runtime. Routed content remains blocked until all restored chats finish hydrating.

`ensureChat()` single-flights ordinary startup/route calls by project and session, but SSE reset recovery and direct refresh paths call the underlying hydration method separately. Startup, route activation, recovery, and close can therefore overlap, apply stale completions, duplicate resume work, or leave a late-created runtime attached only to a removed tab object.

The current route must be authoritative. A direct chat URL can differ from persisted `activeTabId`; history, settings, and new-chat routes need no chat hydration. The existing 30-minute server idle cleanup is opportunistic—it runs before runtime creation—not a periodic disposal policy.

### Relevant files

- `src/lib/harness/workspace.svelte.ts`
- `src/routes/(workspace)/+layout.svelte`
- `src/routes/(workspace)/+page.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/+page.svelte`
- `src/lib/server/runtimes.ts`
- `src/routes/api/runtimes/+server.ts`

### Recommended implementation

- Restore tab metadata immediately without creating or checkpointing inactive runtimes.
- Model chat lifecycle explicitly as unhydrated, hydrating, ready, or failed rather than relying on `snapshot` plus a boolean alone.
- Treat the current route as authoritative:
  - hydrate no chat on history, settings, or new-chat routes;
  - when `/` redirects to the persisted active tab, hydrate the routed destination;
  - on a direct chat URL, hydrate that chat even when persisted `activeTabId` differs.
- Route startup activation, route activation, reset recovery, and explicit refresh through one per-project/session single-flight operation.
- Attach a generation/cancellation token to hydration. Ignore stale completions and dispose any runtime created after the tab was closed or superseded.
- Do not accumulate an unbounded SSE buffer for an unhydrated inactive tab. Rehydrate from a checkpoint on activation and retain only the events needed to close the checkpoint/subscription race.
- Optionally prefetch one likely next tab during idle time, with cancellation and a strict runtime budget.
- Either document the current opportunistic server cleanup or add a periodic/explicit inactive-runtime disposal policy.

### Acceptance criteria

- Ten restored chat tabs create/resume only the chat selected by the current route; history, settings, and new-chat routes create none.
- Restored titles, drafts, tab order, queue modes, and active-tab metadata are available without waiting for inactive chats.
- Switching to an inactive tab hydrates it once and shows a clear loading state.
- Repeated route activation, reset recovery, and refresh share one GET/resume operation per project/session.
- Closing or navigating away during hydration cannot apply a stale checkpoint or leak a newly created runtime.
- An inactive tab receiving SSE does not accumulate an unbounded buffer and opens at the latest checkpoint.
- Tests cover a direct deep link that differs from persisted `activeTabId`, stale runtime fallback, concurrent activation/reset, and close-during-hydration.

---

## 3. Live tool updates still invalidate unrelated tool-group inputs

**Status:** Partially fixed  
**Priority:** Medium

### Current behavior

Finalized timeline construction no longer depends on `chat.streamTools`, so a tool update does not rebuild historical timeline entries.

However, `ChatTimeline.svelte` derives a replacement global `streamsByCallId` map whenever any live tool changes. Every historical tool-group prop expression then calls `toolGroupTools()`, which reads that map through its default argument and returns a new array containing new tool objects. Unrelated `ToolGroup` instances therefore receive new `tools` identities and re-evaluate their derived inputs.

Existing tests cover live-to-final disclosure-state preservation, but not unrelated group invalidation or prop identity.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- `src/lib/harness/streaming-tools.ts`
- `src/lib/harness/timeline.ts`

### Recommended implementation

- Build a finalized `callId -> groupId` ownership index without making `buildFinalizedTimeline()` depend on live state.
- Replace the wholesale derived `Map` with one of these boundaries:
  1. a long-lived per-call reactive store whose entries are updated in place and whose reads are genuinely key-scoped; or
  2. memoized per-group view models that update only the group owning a changed call ID.
- Ensure each finalized group subscribes only to its own call IDs. A generic replacement map passed to every child does not satisfy this requirement.
- A dedicated live-only component may render calls absent from finalized history, but matched stream patches must still be routed to their owning finalized group for live-to-final handoff.
- Preserve tools-array identity for a group when neither its finalized tools nor its owned live patches changed.

### Acceptance criteria

- Updating tool `A` does not recreate the tools array or tool objects for a group containing only tool `B`.
- The finalized timeline builder is not called for tool lifecycle updates.
- Live-to-final tool handoff preserves disclosure state and does not duplicate a tool.
- A focused render/invalidation or view-model identity test covers unrelated tool groups.

---

## 4. Project file autocomplete rescans the filesystem

**Status:** Open  
**Priority:** Medium

### Current behavior

The browser debounces file autocomplete by 180 ms, aborts the previous fetch, and rejects stale results. The server nevertheless creates a fresh ignore matcher and traverses up to 20,000 filesystem entries for every request.

The client deduplicates an in-flight request key but does not suppress an already-loaded identical key, so later selection/click synchronization can issue the same request and scan again.

Client cancellation stops consuming a response but does not stop server work: the endpoint does not forward `request.signal`, and `searchProjectFiles()` accepts no signal.

### Relevant files

- `src/lib/components/ChatComposer/ComposerAutocomplete.svelte`
- `src/lib/components/ChatComposer/ComposerTextInput.svelte`
- `src/lib/server/project-files.ts`
- `src/routes/api/projects/[projectId]/files/+server.ts`
- `src/lib/harness/api.ts`

### Recommended implementation

- Build a bounded per-project path index and rank queries against it in memory.
- Key the index by project ID plus canonical project root. Evict inactive entries and invalidate when a project is removed or its canonical root changes.
- For Git projects, invoke Git without a shell and with the canonical root as `cwd`; use NUL-delimited output such as:

  ```text
  git ls-files -z --cached --others --exclude-standard
  ```

- Validate every indexed path before exposing it: reject absolute paths, `..` traversal, missing entries, non-files, and symlinks. `git ls-files --cached` can include deleted tracked entries and tracked symlinks.
- Explicitly document tracked-file ignore semantics. Git includes tracked files even if a later ignore rule matches them, while the current traversal can hide them.
- Preserve the existing 20,000-entry bound or define a replacement memory/entry bound.
- Use the current ignore-aware, non-symlink-following traversal as the non-Git fallback, but cache its result.
- Give indexes a short documented TTL and refresh or invalidate explicitly when files change.
- Share concurrent first builds for one project.
- Forward `request.signal` and cooperatively stop an unshared traversal or Git child process. For a shared build, track waiters and cancel only when no active requester still needs it.
- Avoid issuing a request when the same completed project/query key is already loaded and still fresh.

### Acceptance criteria

- Multiple queries in one project do not repeatedly walk the complete filesystem.
- Concurrent first queries share one index build.
- Untracked Git-ignored files remain excluded; tracked-file behavior is documented and tested.
- Absolute, escaping, missing, and symlinked paths are never returned.
- Newly created files become discoverable within the documented freshness window.
- Aborting one waiter does not cancel an index build still needed by another waiter.
- Cache size and index entry count are bounded.
- Large-project build and query latency are measured with a representative fixture.

---

## 5. Attachment work is repeated

**Status:** Open  
**Priority:** Medium

### Current behavior

For text attachments, composer preparation calls `File.arrayBuffer()` once for UTF-8 verification and again for base64 conversion. Adding each accepted file then deeply validates and re-decodes the accumulated attachment array, and submission validates the complete array again.

On the server, the prompt route validates and decodes every attachment, `promptRuntime()` validates and decodes the normalized result again, and `promptWithAttachments()` decodes text attachments a third time to inject their UTF-8 contents into the persisted prompt. Images are currently decoded twice server-side; text attachments are decoded three times.

At the 20 MiB decoded limit, base64 alone is roughly 26.7 MiB before JSON overhead. Each validation performs regex checks, base64 decoding, byte copying, signature checks, and/or UTF-8 decoding. This demonstrably processes tens of megabytes per pass, but profiling is still required to quantify the user-visible stall. `request.json()` also allocates the complete body before decoded-byte limits are enforced.

### Relevant files

- `src/lib/components/ChatComposer/attachment-draft.ts`
- `src/lib/components/ChatComposer/ChatComposer.svelte`
- `src/lib/attachments.ts`
- `src/lib/prompt-attachments.ts`
- `src/routes/api/runtimes/[runtimeId]/prompt/+server.ts`
- `src/lib/server/runtimes.ts`
- `src/lib/harness/workspace.svelte.ts`

### Recommended implementation

- Read each selected `File` into one `Uint8Array`.
- Perform candidate classification, UTF-8 verification, image-signature feedback, and base64 encoding from that one buffer.
- Enforce cumulative browser limits from trusted local byte lengths without deeply revalidating every previously accepted draft after each addition or again at submit.
- Keep browser checks for fast feedback only; retain authoritative validation at the HTTP trust boundary.
- Have the HTTP-boundary validator return an opaque server-only validated value containing normalized metadata plus retained decoded bytes and, for text, decoded UTF-8 text.
- Pass that validated value to `promptRuntime()` and `promptWithAttachments()` so neither function validates or decodes base64 again. Preserve the original base64 only where the Pi image API requires it.
- Enforce a request-body limit before or during JSON/multipart parsing. Continue to use decoded byte length—not the client-declared `size`—for authoritative per-file and total limits.
- If composer drafts move to `File`/`Blob` plus object URLs, revoke URLs on removal, replacement, successful handoff, and component destruction. Ensure optimistic pending messages retain usable preview data after composer state clears.
- Consider multipart upload or temporary blob storage only if the single-read/single-decode path and body limit do not make JSON/base64 acceptable.

### Acceptance criteria

- A selected file calls `arrayBuffer()` once during composer preparation.
- Adding or submitting a draft does not re-decode previously accepted browser attachments.
- Every submitted attachment is base64-decoded exactly once on the server, at the HTTP trust boundary.
- Text used by `promptWithAttachments()` comes from the HTTP-boundary validation result rather than another base64 decode.
- Invalid MIME signatures and invalid UTF-8 remain rejected authoritatively.
- Existing count, per-file, total decoded-size, filename, MIME, kind, and declared-size checks remain enforced.
- Oversized request bodies are rejected before an unbounded JSON/base64 allocation.
- Attachment-only prompts, optimistic previews, and persisted attachment metadata continue to work.

---

## 6. Finalized Markdown has no explicit cache

**Status:** Measure first
**Priority:** Low

### Current behavior

Finalized assistant rows directly derive HTML with `renderAssistantMarkdown(item.text)`, and there is no explicit cache. That call performs MarkdownIt parsing and Highlight.js work for supported fenced-code languages.

The previous rationale overstated how often it repeats. Svelte 5 uses fine-grained render effects, finalized timeline entries preserve their underlying `ChatItem` references, and normalized checkpoint reconciliation reuses structurally equal items. Unrelated hover updates, incremental appends, and equal checkpoints therefore already avoid many reruns.

Parsing can still repeat when an item is genuinely replaced under the same keyed row, when the timeline remounts, or when future windowing unmounts and remounts rows. The remaining frequency should be measured before adding cache retention and invalidation complexity.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/lib/harness/runtime-state.ts`
- `src/lib/harness/timeline.ts`
- `src/lib/markdown.ts`

### Recommended implementation

1. Add an invocation-count test or instrumentation around finalized Markdown rendering and profile checkpoint reconciliation, display-option changes, tab remounts, and the proposed history-windowing behavior.
2. When extracting `MessageRow.svelte`, pass stable primitive `id`/`text` inputs and derive rendered HTML within that row to retain Svelte's fine-grained memoization.
3. Add an explicit cache only if measurement shows meaningful repeated parsing.
4. If needed, use a chat/component-scoped `Map<ChatItem.id, { text, html }>` or another bounded cache. Reuse an entry only when the exact text matches, invalidate same-ID text changes, and prune items leaving authoritative state.
5. Do not use an unbounded process-wide cache that retains conversation text across requests or chats.

### Acceptance criteria

- An invocation-count test documents current behavior and whether an explicit cache is justified.
- If a cache is added, reevaluating an unchanged finalized item does not rerun MarkdownIt/Highlight.js.
- If a cache is added, updating text under the same item ID invalidates the cached HTML.
- If a cache is added, removed/abandoned branch items and closed chats do not cause unbounded retention.
- Existing safe Markdown/link policy, highlighting, and code-copy controls remain unchanged.

---

## 7. Stream presentation flushes are coupled to workspace/cursor persistence

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

## 8. Timeline-wide hover state and repeated formatter allocation

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

## 9. Historical image previews are not browser-lazy

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

1. Lazy-hydrate inactive restored tabs and unify hydration single-flight/cancellation.
2. Cache project file paths with bounded lifecycle and safe Git semantics.
3. Remove repeated attachment reads, validations, and server decodes.
4. Add the long-history fixture, containment, and production profiling.
5. Isolate live tool-group invalidation.
6. Extract/localize message-row hover state and reuse timestamp formatters, measuring the DOM tradeoff.
7. Decouple stream presentation from an explicit cursor-persistence policy.
8. Add caller-specific lazy/eager image loading.
9. Measure finalized Markdown invocation frequency and add a bounded cache only if justified.
10. Re-profile before committing to full variable-height virtualization.

## Validation

For each completed item:

1. add focused unit/component tests for the stated identity, concurrency, cancellation, accessibility, or decode-count contract;
2. run `npm run check` and distinguish existing unrelated failures;
3. run the Svelte autofixer for every changed `.svelte` file until it reports no issues or suggestions;
4. run `npm run lint`;
5. run `npm run test:unit -- --run`;
6. profile a production build/preview—not only dev mode—for acceptance criteria concerning rendering, layout, scripting, memory, image decoding, or startup concurrency;
7. record the fixture, browser/runtime version, measurements, and before/after result so a CSS or cache change is not accepted by inspection alone.
