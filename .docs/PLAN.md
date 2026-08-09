# Subagent cards and timeline dialog

## Summary
Add one card per launched subagent child to the parent `ChatTimeline`. Cards will remain immediately after the activity group that contains the original `subagent` tool call (the raw tool row stays in that group), show an independent working spinner while the child is active, switch to a terminal status when it completes/fails/pauses/stops, and open a read-only dialog containing only the delegated child portion of that child’s timeline.

## Behavior and data model

- Introduce a browser-safe `SubagentRun` contract containing stable run/child identity, owning tool-call ID, agent name, optional task summary, status (`running`, `completed`, `failed`, `paused`, or `stopped`), and an opaque child session ID when available.
- Recognize all real launch modes exposed by `pi-subagents` (foreground/background single, parallel, chain, and scripted workflow children), while ignoring management calls such as list, status, doctor, wait, steer, resume, and stop.
- Derive launch and terminal information from structured `subagent` tool arguments/results and persisted `subagent-notify` custom messages rather than matching display text alone. Correlate child sessions by generated subagent session name/run identity and completion session path; retain conservative fallbacks for legacy 8-character run IDs.
- Preserve cards across live-to-persisted handoff by keying them with the owning tool call plus stable run/child identity.
- Status presentation:
  - `running`: the existing `PiWorkingSpinner`, an accessible “Working” label, and live styling.
  - `completed`: success icon and “Completed”.
  - `failed`: error icon and “Failed”.
  - `paused`/`stopped`: distinct non-spinning warning states.
- If a child is known but its session has not been created yet, the card is still shown and its dialog displays an initializing state. External-CLI children or runs without a persisted Pi session display “Timeline unavailable” rather than failing.

## Timeline placement and UI

- Extend finalized/live timeline projection so subagent cards are associated with the activity that owns their `subagent` tool call and emitted directly after that `activity-group`.
- Keep the existing raw `subagent` tool entry inside `ActivityGroup`, per the selected behavior; the new card is an additional purpose-built view.
- Add a focused presentational `SubagentCard` component and a `SubagentTimelineDialog` using Bits UI `Dialog` with properly scoped portal styles, accessible title/description, keyboard dismissal, focus handling, loading/error/empty states, and responsive/max-height scrolling.
- Clicking anywhere on a card opens the dialog. The dialog renders `ChatTimeline` only—never `ChatComposer`, permission controls, or runtime mutation controls.
- The dialog timeline starts after the generated child `session_info` marker, so forked parent history is omitted and the delegated `Task:` message is the first child item.
- Keep the dialog data fresh while the child is working using a narrowly scoped DOM attachment/polling lifecycle; stop polling when the run becomes terminal, the dialog closes, or the component unmounts. Do not use `$effect` for synchronization.

## Server/API changes

- Add a read-only project subagent endpoint with two projections:
  - lightweight run/card status for the parent session, including child-session resolution;
  - child timeline detail by opaque child session ID.
- The detail endpoint must verify that the requested session belongs to the project and has a generated subagent session name before opening it. It must not accept arbitrary filesystem paths from the browser.
- Read child sessions directly with `SessionManager` and `mapSessionEntry`; do not create an `AgentSession`, bind extensions, register a workspace tab, or expose composer/runtime mutation APIs.
- Keep the existing history exclusion unchanged: subagent sessions remain absent from `/history` and command-menu search but are intentionally resolvable through the parent card endpoint.
- Parse structured Pi data defensively. Unknown/new fields must degrade to an unavailable or run-level card rather than breaking the parent timeline.
- Cache short-lived project/session discovery results during active polling to avoid repeatedly reparsing the entire history directory.

## Public interfaces

- Add `SubagentRun` and read-only child timeline response types to `src/lib/contracts.ts`.
- Add typed harness API methods for fetching parent subagent status and child timeline detail.
- Extend timeline entry types with a dedicated subagent-card entry/association; do not encode cards as ordinary chat messages or notices.
- Add an optional `showSubagentCards`/read-only context boundary to `ChatTimeline` as needed so the same timeline renderer can be reused in the dialog without introducing composer behavior or accidental recursive runtime ownership.

## Tests and verification

- Server/parser unit tests:
  - foreground and async single launches;
  - parallel/chain/workflow children;
  - legacy short and current UUID run IDs;
  - management calls excluded;
  - completion, failure, pause, and stop notifications correlated correctly;
  - malformed/unknown details degrade safely;
  - child timeline slicing removes inherited parent entries and begins at the delegated task;
  - non-subagent and cross-project session IDs are rejected.
- Timeline/component browser tests:
  - card renders directly after its owning activity group while the raw tool remains inside the group;
  - multiple children get independently keyed cards;
  - running card has its own accessible spinner;
  - live card preserves identity when persisted;
  - terminal transitions remove the spinner and show the correct status;
  - click opens an accessible dialog containing the child timeline and no composer;
  - initializing, unavailable, empty, and fetch-error states;
  - dialog refreshes while running and stops polling on terminal state/close/unmount.
- Run Svelte MCP `list-sections`/relevant documentation before implementation and `svelte-autofixer` on every edited Svelte file until clean. Follow the project Bits UI skill and Dialog documentation.
- Run focused Vitest/browser tests, `npm run check`, and `npm run lint`; report the existing unrelated `src/routes/api/events/+server.ts` Prettier failure if it remains. Also run changed-file Prettier/ESLint and `git diff --check`.

## Assumptions and defaults

- “All launched runs” means one card per actual child where Pi exposes child identity; management operations never create cards.
- The original subagent tool row remains visible in the activity group, and cards follow that group.
- The popup is read-only and shows only the child-owned transcript, not inherited fork history.
- Active dialogs refresh approximately once per second, with short-lived server caching to limit filesystem work.
- Existing persisted parent sessions should produce cards after reload; no migration or session-file mutation is required.
