# Remaining performance follow-ups

## Scope

This document tracks the performance issues from the review of commit `e42204b` that are still unresolved or only partially resolved after the timeline protocol rebuild.

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
| Medium | Finalized Markdown is not cached | Open |
| Low | Stream-only presentation flushes schedule workspace persistence | Open |
| Low | Timeline-wide hover state and formatter allocation | Open |
| Low | Historical image previews are not browser-lazy | Open |

---

## 1. Long-conversation DOM growth

**Status:** Open  
**Priority:** High

### Current behavior

`ChatTimeline.svelte` still renders the complete finalized timeline through one keyed `{#each}` block. Keying preserves component/DOM identity, but every historical Markdown tree, attachment card, metadata row, and tool-group shell remains mounted.

Lazy tool bodies reduce the largest hidden text nodes, but ordinary message DOM and decoded attachment previews still grow with conversation length.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- `src/lib/components/AttachmentPreview.svelte`
- `src/lib/components/WorkspaceScrollArea.svelte`

### Recommended rollout

1. Add a low-risk containment layer to finalized rows:

   ```css
   .message-entry,
   .tool-group,
   .timeline-notice {
     content-visibility: auto;
     contain-intrinsic-size: auto 240px;
   }
   ```

2. Extract finalized message rendering into a `MessageRow.svelte` component so row-local state and invalidation are isolated.
3. Profile representative 100–200 message sessions with large code blocks and attachments.
4. If containment is insufficient, add variable-height windowing for finalized history.
5. Preserve scroll position by stable item ID plus an offset, not only raw `scrollTop`.
6. Keep streaming content outside the virtualized finalized-history window.

### Acceptance criteria

- Off-screen historical rows do not require full layout/paint work.
- A 200-message fixture does not mount expensive off-screen message contents eagerly, or profiling demonstrates containment is sufficient.
- Appending a message while pinned remains pinned.
- Reading older history does not jump when rows above or below change height.
- Tool disclosure state survives rows leaving and re-entering the rendered window.

---

## 2. Eager hydration of restored chat tabs

**Status:** Open  
**Priority:** High

### Current behavior

Workspace startup restores persisted tabs and calls `ensureChat()` for every restored chat inside `Promise.all`. Each restored tab can create or resume an `AgentSession`, load project resources/extensions, and capture a checkpoint even if the user never opens it.

This makes startup latency and server memory scale with the number of restored tabs.

### Relevant files

- `src/lib/harness/workspace.svelte.ts`
- `src/routes/(workspace)/+layout.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/+page.svelte`
- `src/lib/server/runtimes.ts`

### Recommended implementation

- Restore tab metadata immediately without creating runtimes.
- Hydrate only the active chat during initialization.
- Hydrate an inactive chat when it becomes active or its route is visited.
- Optionally prefetch one likely next tab during idle time, with cancellation.
- Keep SSE handling safe for tabs that have metadata but no runtime.
- Dispose inactive server runtimes according to the existing idle policy.

### Acceptance criteria

- Startup with ten restored chat tabs creates/resumes only the active runtime.
- Switching to an inactive tab hydrates it once and shows a clear loading state.
- Concurrent route/tab activation cannot create duplicate runtimes for one tab.
- Restored drafts, titles, and tab order remain available before hydration.

---

## 3. Live tool updates still invalidate unrelated tool-group inputs

**Status:** Partially fixed  
**Priority:** Medium

### Current behavior

Finalized timeline construction no longer depends on `chat.streamTools`, so a tool update does not rebuild all historical timeline entries.

However, `ChatTimeline.svelte` derives a new global `streamsByCallId` map whenever any live tool changes. Each historical `ToolGroup` then calls `toolGroupTools(...)`, reading that map and creating a new tools array and tool objects. Unrelated historical groups therefore still receive new prop identities.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- `src/lib/harness/streaming-tools.ts`

### Recommended implementation

Choose one of these boundaries:

1. Pass finalized tools and a reactive live-tools-by-ID collection separately to `ToolGroup`; each group resolves only its own IDs.
2. Maintain memoized per-group view models keyed by the finalized group ID and update only the group owning the changed tool ID.
3. Split live-only tools into a dedicated component and avoid sending the global live map through historical group prop expressions.

Do not reintroduce live state as a dependency of `buildFinalizedTimeline()`.

### Acceptance criteria

- Updating tool `A` does not recreate the tools array for a historical group containing only tool `B`.
- The finalized timeline builder is not called for tool lifecycle updates.
- Live-to-final tool handoff preserves disclosure state and does not duplicate a tool.
- A focused render/invalidation test covers unrelated tool groups.

---

## 4. Project file autocomplete rescans the filesystem

**Status:** Open  
**Priority:** Medium

### Current behavior

The browser debounces and aborts stale autocomplete requests, but `searchProjectFiles()` performs a new traversal for each query and can scan up to the configured entry limit. Client cancellation stops consuming the result but does not stop the server traversal.

### Relevant files

- `src/lib/components/ChatComposer/ComposerAutocomplete.svelte`
- `src/lib/server/project-files.ts`
- `src/routes/api/projects/[projectId]/files/+server.ts`

### Recommended implementation

- Build a per-project path index and search that in memory.
- Prefer `git ls-files --cached --others --exclude-standard` for Git projects.
- Use a cached, ignore-aware traversal fallback for non-Git projects.
- Associate indexes with project root and a freshness policy.
- Invalidate explicitly or refresh in the background after a short TTL.
- Propagate request cancellation where practical so abandoned index builds can stop.
- Keep result ranking and project-relative path safety unchanged.

### Acceptance criteria

- Multiple queries in one project do not repeatedly walk the complete filesystem.
- Git-ignored files remain excluded.
- Newly created files become discoverable within the documented freshness window.
- Concurrent first queries share one index build.
- Large-project search latency is measured with a representative fixture.

---

## 5. Attachment work is repeated

**Status:** Open  
**Priority:** Medium

### Current behavior

For text attachments, composer preparation reads the file once for UTF-8 verification and again for base64 conversion. The browser then deeply validates accumulated attachment payloads. The prompt route validates again, and `promptRuntime()` validates the already-validated result again.

Base64 decoding, byte copying, signature checks, and large JSON payloads can create noticeable stalls near the total attachment limit.

### Relevant files

- `src/lib/components/ChatComposer/attachment-draft.ts`
- `src/lib/attachments.ts`
- `src/routes/api/runtimes/[runtimeId]/prompt/+server.ts`
- `src/lib/server/runtimes.ts`

### Recommended implementation

- Read each selected `File` into bytes only once.
- Perform UTF-8 verification and base64 encoding from that one buffer.
- Keep `File`/`Blob` plus object URLs in composer-only draft state where possible.
- Separate cheap browser feedback validation from authoritative server validation.
- Perform deep server validation once, at the HTTP trust boundary.
- Pass a typed validated value from the route to `promptRuntime()` without re-decoding it.
- Consider multipart upload or temporary blob storage if large JSON/base64 payloads remain costly.

### Acceptance criteria

- A text file is read once during composer preparation.
- Each submitted attachment is base64-decoded at most once on the server.
- Invalid MIME signatures and invalid UTF-8 remain rejected authoritatively.
- Existing size/count/total-size limits remain enforced.
- Attachment-only prompts and optimistic previews continue to work.

---

## 6. Finalized Markdown rendering is not cached

**Status:** Open  
**Priority:** Medium

### Current behavior

Streaming Markdown is throttled and syntax highlighting is disabled, which fixes the critical streaming path. Finalized assistant messages still call `renderAssistantMarkdown(item.text)` from the component whenever the row is evaluated. There is no cache keyed by stable message ID and text revision/content.

This can repeat Markdown parsing and Highlight.js work after checkpoint reconciliation, display-option changes, or unrelated parent updates.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/lib/markdown.ts`

### Recommended implementation

- Cache finalized rendered HTML using stable `ChatItem.id` plus the exact text value.
- Use a bounded cache or remove entries when finalized items leave authoritative state.
- Keep streaming rendering in its existing non-highlighted path.
- Ensure browser-safe representation updates invalidate the cache when text changes under the same ID.

### Acceptance criteria

- Re-rendering an unchanged finalized item does not rerun MarkdownIt/Highlight.js.
- Updating text under the same item ID invalidates the cached HTML.
- Removed/abandoned branch items do not cause unbounded cache growth.
- Existing Markdown sanitization and code-copy controls remain unchanged.

---

## 7. Stream-only presentation flushes schedule workspace persistence

**Status:** Open  
**Priority:** Low

### Current behavior

`StreamUpdateBatcher` invokes its `onFlush` callback for frame-batched assistant/tool presentation updates. The workspace wires that callback to `schedulePersist()`, even though stream text, stream thinking, stream tools, and normalized runtime projection contents are not stored in the workspace document.

The persistence call is debounced, so this is not a per-token storage write, but long streams still schedule unnecessary timer and serialization work.

### Relevant files

- `src/lib/harness/workspace.svelte.ts`
- `src/lib/harness/stream-update-batcher.ts`

### Recommended implementation

- Remove workspace persistence from stream presentation flushes.
- Persist only fields represented in `StoredWorkspaceV1` or a future schema.
- Trigger persistence explicitly for tab metadata, drafts, queue mode, runtime IDs, and cursor changes where required.
- Decide separately whether the opaque SSE cursor needs periodic durable persistence.

### Acceptance criteria

- Assistant/tool presentation updates do not call `localStorage.setItem` by themselves.
- Draft, tab, runtime ID, queue mode, active tab, and cursor persistence behavior remains correct.
- Reconnect behavior does not regress because a required cursor write was accidentally removed.

---

## 8. Timeline-wide hover state and repeated formatter allocation

**Status:** Open  
**Priority:** Low

### Current behavior

`hoveredMessageId` lives in `ChatTimeline.svelte`, so moving between rows changes parent reactive state and makes all message rows compare their IDs again. Timestamp formatting also creates new `Intl.DateTimeFormat` instances inside formatting functions.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`

### Recommended implementation

- Prefer CSS `:hover`/`:focus-within` for metadata visibility.
- If interactive row state is required, move it into `MessageRow.svelte`.
- Create module-level or component-level reusable timestamp formatter instances.

### Acceptance criteria

- Hovering one message does not update parent timeline state.
- Keyboard focus still reveals message actions.
- Timestamp output remains locale-aware and unchanged in meaning.

---

## 9. Historical image previews are not browser-lazy

**Status:** Open  
**Priority:** Low

### Current behavior

Attachment preview images do not specify `loading="lazy"` or `decoding="async"`. Long histories containing many persisted images can decode images before they approach the viewport.

### Relevant files

- `src/lib/components/AttachmentPreview.svelte`

### Recommended implementation

Add lazy loading for persisted/history previews while preserving eager behavior where immediate composer feedback needs it. If the same component serves both contexts, expose an explicit loading policy prop.

### Acceptance criteria

- Historical off-screen previews use `loading="lazy"` and `decoding="async"`.
- Newly selected composer previews still appear immediately.
- Opening the image viewer remains reliable after lazy loading.

---

## Suggested implementation order

1. Lazy-hydrate inactive restored tabs.
2. Add row containment and profile long histories.
3. Isolate live tool-group invalidation.
4. Cache project file paths.
5. Remove repeated attachment reads/decodes.
6. Cache finalized Markdown.
7. Remove stream-only persistence scheduling.
8. Localize hover state and reuse formatters.
9. Add lazy image loading.
10. Re-profile before committing to full variable-height virtualization.

## Validation

For each completed item:

1. run focused unit/component tests;
2. run `npm run check` and distinguish existing unrelated failures;
3. run the Svelte autofixer for every changed `.svelte` file until clean;
4. run `npm run lint`;
5. run `npm run test:unit -- --run`;
6. use browser profiling for changes whose acceptance criteria concern rendering, layout, memory, or startup concurrency.
