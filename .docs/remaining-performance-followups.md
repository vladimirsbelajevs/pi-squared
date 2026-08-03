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
| High | Long-conversation DOM growth | Closed |
| High | Eager hydration of restored chat tabs | Open |
| Medium | Live tool updates invalidate unrelated tool-group inputs | Closed |
| Medium | Project file autocomplete rescans the filesystem | Partially closed |
| Medium | Attachment files are read, decoded, and validated repeatedly | Open |
| Low | Stream presentation flushes are coupled to workspace/cursor persistence | Open |
| Low | Timeline-wide hover state and formatter allocation | Open |
| Low | Historical image previews are not browser-lazy | Open |
| Low | Finalized Markdown has no explicit cache | Measure first |

---

## 1. Long-conversation DOM growth

**Status:** Closed

**Priority:** High

### Implemented

- Added native CSS containment to finalized message rows, notices, stopped rows, and tool groups using `content-visibility: auto` with a `240px` intrinsic-size fallback.
- Added a Storybook 200-message profiling fixture with highlighted code blocks, attachments, notices, and tool groups.

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

**Status:** Closed  
**Priority:** High

### Current behavior

After projects, models, and sessions load, workspace startup restores tab metadata, opens the global SSE connection, and awaits `ensureChat()` for every restored chat. A valid persisted runtime ID is checkpointed with `GET`; a missing or stale ID creates a resumed `AgentSession`, binds extensions, and allocates a new server runtime. Routed content remains blocked until all restored chats finish hydrating.

`ensureChat()` single-flights ordinary startup/route calls by project and session, but SSE reset recovery and direct refresh paths call the underlying hydration method separately. Startup, route activation, recovery, and close can therefore overlap, apply stale completions, duplicate resume work, or leave a late-created runtime attached only to a removed tab object.

The current route must be authoritative. A direct chat URL can differ from persisted `activeTabId`; history, settings, and new-chat routes need no chat hydration. Runtime disposal is explicit: closing a chat tab disposes its runtime immediately, and a hydrated, settled chat that remains inactive for 30 minutes is disposed client-side. Streaming chats and chats with pending permissions or optimistic messages are retained; their timer begins only after they settle. Server idle cleanup remains opportunistic—it runs before runtime creation—as a secondary fallback.

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
- Keep the explicit client policy: dispose on tab close, and after 30 minutes of inactivity only for a settled chat with no pending permissions or optimistic messages. Do not dispose merely because a chat is backgrounded while streaming. Server cleanup remains an opportunistic secondary fallback.

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

**Status:** Closed
**Priority:** Medium

### Implemented

- Finalized `ToolGroup` instances receive their stable finalized tools and look up only their own live call IDs. The global replacement `streamsByCallId` map is removed.
- Live calls not yet represented in finalized history render in a separate live-only group, so they do not change historical group inputs.
- Incremental stream patches merge into the matching live-tool object in place, preserving the array and unrelated tool-object identities.
- Focused component and batcher tests cover owner-group updates, live-tool identity preservation, and live-to-final disclosure-state handoff.

### Relevant files

- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ChatTimeline.svelte`
- `src/routes/(workspace)/chat/[projectId]/[sessionId]/ToolGroup.svelte`
- `src/lib/harness/streaming-tools.ts`
- `src/lib/harness/timeline.ts`

### Acceptance criteria

- Updating tool `A` preserves the live-tool array and tool `B` object identities, while only the finalized group owning `A` updates.
- The finalized timeline builder is not called for tool lifecycle updates.
- Live-to-final tool handoff preserves disclosure state and does not duplicate a tool.
- Focused component and batcher identity tests cover unrelated tool groups.

---

## 4. Project file autocomplete rescans the filesystem

**Status:** Closed
**Priority:** Medium

### Implemented

- Added a bounded per-project index keyed by project ID and the canonical project root. Indexes retain at most 20,000 files, the cache retains at most 32 project/root indexes, and entries expire after the documented 30-second TTL.
- Concurrent first requests share one build. A request's abort signal only releases its waiter; traversal or the direct Git child is aborted when no waiter remains.
- Git projects use `git ls-files -z --cached --others --exclude-standard` through a directly spawned child with the canonical root as `cwd` and no shell. NUL-delimited output is parsed incrementally and stops at the 20,000-candidate bound. Tracked files remain eligible even when a later ignore rule matches them; ignored untracked files remain excluded. Deleted tracked files, symlinks, absolute paths, escaping paths, missing entries, and non-files are validated out before exposure.
- Non-Git roots retain the ignore-aware, non-symlink-following traversal as a cached fallback. Ranked candidates are revalidated immediately before each response so TTL-cached paths cannot expose newly missing or symlinked entries. Cache entries are evicted on project removal or when a registry edit changes the canonical root.
- The files endpoint forwards `request.signal`. The composer keeps its debounce/abort/stale-result behavior and suppresses completed project/query requests while the client-side 30-second result is fresh.

### Remaining findings

#### Effective freshness can approach 60 seconds

**Severity:** Medium

The server expires an index 30 seconds after it is built, but the composer independently caches a response for 30 seconds after it is received. A response obtained just before server-index expiry can therefore suppress a refresh until nearly 60 seconds after the underlying index was built.

**Implementation:**

1. Make the server's index age authoritative instead of starting a new client TTL when a response arrives.
2. Change `searchProjectFiles()` to return the files plus `freshForMs`, calculated immediately before returning as `max(0, PROJECT_FILE_INDEX_TTL_MS - (Date.now() - index.builtAt))`.
3. Include `freshForMs` in the files endpoint response and its client API type. Use a duration instead of a server timestamp so browser/server clock skew cannot extend freshness.
4. Store an absolute local `expiresAt` in each composer cache entry as `Date.now() + min(freshForMs, PROJECT_FILE_INDEX_TTL_MS)`. Do not extend `expiresAt` when an entry is read or moved to the LRU tail.
5. Reuse an identical completed project/query result only while `Date.now() < expiresAt`. If `freshForMs` is zero, show the returned response for the current interaction but do not retain it as a fresh cache entry.
6. Keep the existing debounce, abort, generation, and stale-active-token checks unchanged.

**Required tests:**

- Add a server test asserting that a response from a nearly expired index reports only its remaining freshness.
- Add a fake-timer component test that loads from an index near server expiry and proves the composer refetches when the server freshness ends, rather than 30 seconds after receipt.
- Add an integration-style test proving a newly created file becomes discoverable no later than 30 seconds after the underlying index was built.

#### A Git failure weakens ignore semantics

**Severity:** Medium

Every non-abort failure from `git ls-files` silently falls back to filesystem traversal. The fallback reads `.gitignore` files but does not honor `.git/info/exclude` or global Git excludes, so an operational Git failure can expose untracked paths that Git would exclude.

**Implementation:**

1. Separate repository detection from index listing. Add a directly spawned, no-shell Git probe such as `git rev-parse --is-inside-work-tree`, using the canonical root as `cwd`, bounded stdout/stderr, and the shared build's abort signal.
2. Return the filesystem traversal fallback only when the probe confirms that the root is not inside a Git work tree.
3. When the probe confirms a Git work tree, run the existing `git ls-files -z --cached --others --exclude-standard` path. Propagate any non-abort spawn, output-limit, parse, or non-zero-exit failure instead of falling back.
4. Treat an unavailable Git executable as an operational error when a `.git` file or directory is present in the root or an ancestor. This prevents a missing executable from silently changing ignore behavior. Preserve support for project roots inside a parent repository and Git worktree `.git` files.
5. Keep abort errors as `AbortError` and keep direct child termination when the shared build loses its final waiter.
6. Return a generic autocomplete failure to the client and log the bounded Git diagnostic server-side; do not expose arbitrary Git stderr in the HTTP response.

**Required tests:**

- Verify a non-Git directory still uses the cached traversal fallback.
- In a real Git fixture, exclude an untracked file through `.git/info/exclude`, force the listing command to fail, and assert that the search rejects rather than returning the excluded file through traversal.
- Cover a project rooted in a subdirectory of a parent repository and a Git worktree whose `.git` entry is a file.
- Cover Git executable/spawn failure, non-zero listing exit, and cancellation while probing and listing.

#### Concurrent build resources are not globally bounded

**Severity:** Low

The 32-entry limit applies only to completed indexes. Requests for many distinct projects can create an unbounded number of simultaneous Git children or traversals, each retaining up to the per-index candidate bound.

**Implementation:**

1. Add explicit constants for a small global active-build limit and a bounded queued-build limit, for example four active builds and 64 queued distinct keys.
2. Replace immediate `buildIndex()` startup in `getIndex()` with a FIFO scheduler. A build should have `queued`, `running`, or `finished` state; only the scheduler may move it to `running` and consume an active slot.
3. Keep same-project/root single-flight behavior: requests for an existing queued or running key attach as waiters instead of consuming another queue entry or active slot.
4. If every waiter aborts while a build is queued, remove it from the queue without spawning Git or traversing. If every waiter aborts while it is running, abort its controller as today.
5. Release the active slot in a `finally` block and immediately start the next live queued build. Ensure rejection or cancellation cannot strand a slot.
6. When the distinct-key queue is full, reject new builds with a stable server-side busy error; autocomplete may continue treating that failure as optional. Do not evict a queued build that still has waiters.
7. Extend `getProjectFileCacheStats()` with active and queued counts so tests and diagnostics can verify both limits.

**Required tests:**

- Start more distinct project builds than the active limit and assert that no more than the configured number enter Git/traversal concurrently.
- Verify queued builds start in FIFO order as active builds finish.
- Verify same-key waiters share one queued entry, aborting a queued final waiter prevents startup, and aborting one waiter does not remove work needed by another.
- Fill the pending queue and assert that one additional distinct build fails deterministically without increasing active or queued counts.

#### Invalidation cannot revoke a search already using a completed index

**Severity:** Low

Project removal or canonical-root changes evict cached indexes and abort in-flight builds, but a request that already holds a completed index can finish against the old root.

**Implementation:**

1. Maintain a per-project invalidation generation or opaque token alongside the cache. Capture it after resolving the canonical project root and before obtaining the index.
2. Advance/replace the token whenever `invalidateProjectFileCache()` runs and whenever `searchProjectFiles()` detects that the canonical root changed.
3. Recheck the token after `getIndex()`, during or after asynchronous candidate revalidation, and immediately before returning results. Reject a stale request with `AbortError` so the composer discards it through the existing optional-autocomplete path.
4. Ensure a root-changing request advances the token before starting the replacement-root build, so old-root requests cannot pass their final check while new-root requests proceed normally.
5. Keep token storage bounded. Remove state for a deleted project after its active searches/builds settle, or use opaque token identity that can be deleted while existing requests retain only their local reference.
6. Do not rely only on deleting the cached map entry: callers can retain the removed `FileIndex` object, which is why the final token check is required.

**Required tests:**

- Pause a cached query during candidate revalidation, remove the project, resume it, and assert that it rejects without returning old-root paths.
- Repeat the race with a canonical-root change and assert that the old request rejects while a new request returns only replacement-root paths.
- Verify ordinary cache eviction does not invalidate an already authorized request, while explicit project/root invalidation does.
- Verify generation/token bookkeeping is released after project removal and does not grow without bound.

### Relevant files

- `src/lib/components/ChatComposer/ComposerAutocomplete.svelte`
- `src/lib/components/ChatComposer/ChatComposer.svelte.spec.ts`
- `src/lib/server/project-files.ts`
- `src/lib/server/project-files.spec.ts`
- `src/lib/server/projects.ts`
- `src/routes/api/projects/[projectId]/files/+server.ts`

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

### Validation evidence

`src/lib/server/project-files.spec.ts` covers cache reuse and TTL freshness, concurrent build sharing and waiter cancellation, sole-waiter cancellation without an unhandled rejection, Git tracked/ignored semantics, streamed listings beyond the old 8 MiB buffer, absolute/escaping/missing/non-file/symlink validation, query-time revalidation, project-removal eviction, and cache bounds. Its representative measurement fixture creates 20,000 files in batches, records build and cached-query latency without wall-clock assertions, and one validation run recorded `indexed=20000`, `results=30`, `build-ms=329.09`, and `cached-query-ms=7.89`.

`ChatComposer.svelte.spec.ts` covers suppression of an identical completed query during selection synchronization. The full validation commands and unrelated repository failures are recorded in the implementation handoff.

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
