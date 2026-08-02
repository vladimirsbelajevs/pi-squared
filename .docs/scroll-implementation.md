# Scroll implementation

## Goal

Replace the current plain `#workspace-content` overflow container with a single Bits UI
`ScrollArea`, while restoring the two behaviours users need:

1. Each workspace tab returns to its last scroll position when it is reselected.
2. A tab that is at the bottom stays there while its content grows (streaming text,
   tool updates, image loads, and similar layout changes).

This must **not** reintroduce the deleted `contentKey` approach. In particular, no
scroll code may serialize the timeline, messages, attachment metadata, attachment
`data`, stream text, or tool output.

## Non-goals

- Do not implement message virtualization as part of this work.
- Do not parse or highlight streaming Markdown more frequently to support scrolling.
- Do not persist scroll positions to local storage. Positions are in-memory UI state
  for the currently open workspace tabs only.
- Do not call SvelteKit `disableScrollHandling()`. It is discouraged by SvelteKit and
  is unrelated to the inner Bits UI viewport.
- Do not add a second scroll container inside a route. `ScrollArea.Viewport` is the
  only workspace content scroller. Code blocks and select menus may retain their own
  local overflow where required.

## Constraints from `todo-perf-fixes.md`

The implementation must preserve these performance boundaries:

- Stream mutations must be batched before they reach reactive UI state. One model
  event must not cause one layout/scroll update.
- There must be no history-sized derived key and no `JSON.stringify()` in the scroll
  path.
- Scroll position is determined from native viewport geometry only: `scrollTop`,
  `scrollHeight`, and `clientHeight`.
- Geometry work is event-driven. It may occur for a user scroll, a route activation,
  an explicit user submission, or a coalesced content-size change; it must not run as
  a broadly reactive effect over chat data.
- The follow-to-bottom write must be coalesced to at most once per animation frame.
- Collapsed tool content, streaming Markdown, timeline indexing, and virtualization
  remain independent follow-up concerns described in the performance document.

## Bits UI structure and styling

Create `src/lib/components/WorkspaceScrollArea.svelte` as the one reusable wrapper
for workspace content. Use the documented Bits UI composition rather than styling a
bare `div`:

```svelte
<script lang="ts">
	import { ScrollArea } from 'bits-ui';
</script>

<ScrollArea.Root class="workspace-scroll-root" type="scroll">
	<ScrollArea.Viewport class="workspace-scroll-viewport">
		<div class="workspace-scroll-content">
			<!-- route content -->
		</div>
	</ScrollArea.Viewport>

	<ScrollArea.Scrollbar class="workspace-scrollbar" orientation="vertical">
		<ScrollArea.Thumb class="workspace-scroll-thumb" />
	</ScrollArea.Scrollbar>
	<ScrollArea.Corner />
</ScrollArea.Root>
```

`type="scroll"` gives the macOS-like behaviour used by the Bits UI documentation:
the scrollbar appears while scrolling, then hides after the default delay. Keep the
vertical scrollbar only. The workspace must wrap long text and let code blocks own
horizontal overflow, rather than offering a second, application-wide horizontal
scrollbar.

Style the primitives with the same visual structure as the Bits UI example, adapted
to the project tokens:

```css
.workspace-scroll-root {
	position: relative;
	min-height: 0;
	overflow: hidden;
}

.workspace-scroll-viewport {
	height: 100%;
	width: 100%;
}

.workspace-scrollbar {
	display: flex;
	width: 0.625rem;
	touch-action: none;
	user-select: none;
	border-left: 1px solid transparent;
	border-radius: 999px;
	background: var(--surface-muted);
	padding: 1px;
	transition:
		width 200ms ease,
		background 200ms ease,
		opacity 200ms ease;
}

.workspace-scrollbar:hover {
	width: 0.75rem;
	background: var(--surface-strong);
}

.workspace-scrollbar[data-state='hidden'] {
	opacity: 0;
}

.workspace-scroll-thumb {
	min-height: 2.75rem;
	flex: 1;
	border-radius: inherit;
	background: color-mix(in srgb, var(--text-muted) 70%, transparent);
}

.workspace-scroll-thumb:hover {
	background: var(--text-muted);
}
```

The wrapper must remain in normal component scope; these primitives are not portaled.
If a future Bits primitive is portaled, use a component-specific `data-*` attribute
and qualified `:global(...)` styles instead of unscoped global selectors.

The `ScrollArea.Root` replaces the current `.workspace-content { overflow: auto; }`
in `src/routes/(workspace)/+layout.svelte`. It must occupy the `minmax(0, 1fr)` grid
row below `WorkspaceTabs`, and the viewport receives `id="workspace-content"` if
existing selectors or tests still require that identifier.

## State ownership

Add non-persisted state to `HarnessWorkspace`:

```ts
export type ScrollState = {
	top: number;
	pinnedToBottom: boolean;
};

#scrollStates = new SvelteMap<string, ScrollState>();
```

Use a stable key per visible workspace surface:

- `tab:${tab.id}` for `NewTab` and `ChatTab` routes.
- `utility:/history` and `utility:/settings` for the utility surface, which does not
  have a `WorkspaceTab` object.

Do not use a reactive map to drive a render effect. The map is an imperative cache;
reading and writing it must not invalidate the timeline. Do not include it in
`StoredWorkspaceV1` or call `workspace.persist()` after a scroll event.

Expose narrow methods rather than leaking the map:

```ts
rememberScroll(key: string, state: ScrollState): void;
scrollState(key: string): ScrollState | undefined;
removeScrollState(key: string): void;
```

`closeTab` must call `removeScrollState(`tab:${tab.id}`)` after closing the tab.

## Viewport lifecycle

`WorkspaceScrollArea` owns all DOM measurements and DOM writes. The workspace layout
supplies the active scroll key and delegates stored states to `HarnessWorkspace`.
The chat route must not query `document.getElementById('workspace-content')` and must
not own a separate scroll effect.

Bind refs to the Bits primitives:

```svelte
<script lang="ts">
	import { ScrollArea } from 'bits-ui';
	import type { Attachment } from 'svelte/attachments';

	let viewport = $state<HTMLDivElement | null>(null);
	let content = $state<HTMLDivElement | null>(null);
	let pendingFrame: number | undefined;
	let restoring = false;
</script>

<ScrollArea.Viewport bind:ref={viewport} {@attach observeViewport}>
	<div bind:this={content} class="workspace-scroll-content">
		{@render children()}
	</div>
</ScrollArea.Viewport>
```

Use an attachment for DOM lifecycle work. It must:

1. Attach a passive native `scroll` listener to the viewport.
2. Observe the inner `content` element with `ResizeObserver`.
3. Remove the listener, disconnect the observer, and cancel a queued animation frame
   when the viewport is destroyed or replaced.

The listener is the sole regular source of position updates:

```ts
const BOTTOM_EPSILON = 24;

function readState(viewport: HTMLElement): ScrollState {
	const remaining = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
	return {
		top: viewport.scrollTop,
		pinnedToBottom: remaining <= BOTTOM_EPSILON
	};
}
```

The listener should queue one `requestAnimationFrame` and save `readState(viewport)`
for the active key in that frame. `scroll` is non-cancelable, but use
`{ passive: true }` explicitly for the native listener. Never write reactive state
from this listener.

The resize observer must do no synchronous scrolling. It only calls the same frame
scheduler. On the next frame, if the active key's last state has `pinnedToBottom:
true`, write:

```ts
viewport.scrollTop = viewport.scrollHeight;
```

Use an immediate assignment, never smooth scrolling. This avoids queued animations
and preserves normal user-controlled scrolling. The observer covers timeline growth
from a batched stream update, lazy tool expansion, and delayed image dimensions
without watching or serializing application data.

A scheduled follow operation must recheck all of these before writing:

- the component is still mounted;
- the key is still active;
- the saved state is still pinned;
- no restoration is in progress.

If the user scrolls upward before the frame runs, the scroll event updates
`pinnedToBottom` to `false`, and the queued operation must become a no-op.

## Restoring a tab

Capture the outgoing viewport state in `beforeNavigate` and restore the incoming
key in `afterNavigate`. `beforeNavigate` avoids losing the last position when a user
clicks a tab before the queued scroll-listener frame executes.

For restore, distinguish two cases:

| Saved state             | Restore operation                                     |
| ----------------------- | ----------------------------------------------------- |
| `pinnedToBottom: false` | Restore `viewport.scrollTop = top`.                   |
| `pinnedToBottom: true`  | Restore `viewport.scrollTop = viewport.scrollHeight`. |

Set a local `restoring` guard before the write so the resulting native scroll event
does not overwrite the desired saved state. Clear it after the scheduled write.

Route content can hydrate or animate after `afterNavigate`, so keep a
`pendingRestore` record only during activation. The `ResizeObserver` may retry the
same restore in a coalesced animation frame while `pendingRestore` exists. Clear it
when either:

- a non-bottom saved position has been reached; or
- a bottom restore has run after the new content's first resize.

This bounded retry handles asynchronous chat snapshots without introducing a general
content watcher. A manual user scroll cancels `pendingRestore` immediately.

For a first visit with no saved state, do not programmatically scroll. Let the
browser start at its normal position. This prevents a historical session from
jumping to the bottom just because its initial loading placeholder fit the viewport.

## Making bottom follow sticky

Sticky behaviour is opt-in state, not a reaction to every message field:

- A physical user scroll records whether the viewport is within `BOTTOM_EPSILON` of
  the bottom.
- Before an explicit user action that adds a message, read the viewport once and
  store that state. If the viewport was at the bottom (including content that fits),
  subsequent content-size changes follow the bottom.
- If the user scrolls away, `pinnedToBottom` becomes `false`; streaming must never
  pull them back down.
- If they return within the epsilon, it becomes `true` and future size changes follow
  again.

The send path should call a narrow `captureScrollBeforeContentChange(activeKey)`
method immediately before `workspace.sendPrompt(...)`. This is a single geometry
read per user submission, not per SSE delta. It also establishes sticky behaviour
for a freshly created chat whose initial content fit the viewport.

The stream implementation must first batch assistant deltas as described in
`todo-perf-fixes.md`. Once those batched commits alter the timeline, the content
`ResizeObserver` schedules at most one bottom write per rendered frame. No
`contentRevision`, `$effect.pre`, `$effect`, `tick()` pair, or route-level
`scrollHeight` calculation is required for ordinary stream updates.

## Integration steps

1. Add `WorkspaceScrollArea.svelte` with the Bits UI root, viewport, vertical
   scrollbar, thumb, refs, attachment, and resize observer.
2. Replace the layout's plain `#workspace-content` div with the wrapper. Preserve the
   existing loading/error rendering inside its children.
3. Add the in-memory `ScrollState` map and narrow methods to `HarnessWorkspace`.
4. In the layout, derive the active scroll key from `page.url` and workspace tabs;
   capture in `beforeNavigate` and restore in `afterNavigate`.
5. Remove nested route-level `overflow: auto` declarations so the Bits viewport is
   the workspace's only content scroller.
6. Call `captureScrollBeforeContentChange` from the explicit chat send handler.
7. Implement client-side SSE batching before enabling or testing long streaming
   conversations. The scrolling wrapper then observes its actual rendered size.
8. Remove a tab's in-memory scroll state when it closes.
