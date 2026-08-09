# Notification Sounds and System Notifications Plan

## Goal

Add opt-in notification sounds and browser/OS notification pop-ups for two live runtime events:

1. An agent finishes responding.
2. An agent requests user permission.

The feature must work in the existing SvelteKit browser client, remain safe during SSR, avoid duplicate notifications during runtime replay/recovery, and degrade gracefully when browser notification or audio APIs are unavailable.

## Existing integration points

- Live events enter the client through `HarnessWorkspace.#handleEvent()` and `#applyEnvelope()` in `src/lib/harness/workspace.svelte.ts`.
- Permission requests arrive as `permission_request` runtime mutations.
- Agent completion is represented by a transition of `RuntimeSnapshot.isStreaming` from `true` to `false`, usually through a `metadata_updated` event.
- Notification preferences belong alongside the existing browser-local display preferences in `src/routes/(workspace)/(utility)/settings/+page.svelte`.
- The supplied audio files currently exist at:
  - `static/agent-complete.mp3`
  - `static/permission-required.mp3`

## Intended behavior

### Defaults

- Notification sounds are disabled until the user enables them.
- System notifications are disabled until the user explicitly enables them and grants browser permission.
- Completion and permission notifications can be enabled independently.
- Preferences are stored in `localStorage`; the browser-owned `Notification.permission` value remains authoritative for system-notification access.

### Event behavior

- Play the completion sound and optionally show a system notification only on a real `isStreaming: true -> false` transition.
- Play the permission sound and optionally show a system notification only when a new `permission_request` mutation is successfully applied.
- Do not notify for initial checkpoints, restored session state, duplicate mutations, metadata that was already settled, or permission resolution.
- Sound may play whenever enabled. System pop-ups should be emitted when the document is hidden/unfocused or the event belongs to a non-active chat; the existing in-app UI remains the foreground notification.
- Notification titles should identify Pi Squared and the event. Bodies should use the chat title and a short permission title/message without exposing tool arguments or other sensitive details unnecessarily.
- Clicking a system notification should focus the window and navigate to the relevant chat.

## Implementation steps

### 1. Organize the static assets

Move the supplied files into a dedicated directory:

```text
static/sounds/agent-complete.mp3
static/sounds/permission-required.mp3
```

Resolve their URLs with `asset()` from `$app/paths` rather than hard-coding root-relative paths, so configured SvelteKit base paths continue to work.

### 2. Add a client notification service

Create `src/lib/client-notifications.ts` containing the browser integration and no reactive application state.

Responsibilities:

- Define the two notification event kinds: `agent-complete` and `permission-required`.
- Lazily create/cache `HTMLAudioElement` instances for the two sound files.
- Reset `currentTime` before playback so repeated events can replay the sound.
- Catch rejected `audio.play()` promises; autoplay blocking must not disrupt chat event processing.
- Report Notification API support and current permission as `unsupported`, `default`, `granted`, or `denied`.
- Request system-notification permission only from an explicit Settings-page user action.
- Create browser `Notification` instances only when permission is `granted`.
- Attach click and close handlers, focus the browser window, and invoke a navigation callback supplied by the workspace.
- Close or replace notifications using a stable tag per runtime/event kind to avoid stacking redundant pop-ups.
- Guard all browser globals (`window`, `document`, `Notification`, `Audio`) so importing the module during SSR or Node tests is safe.

Keep event-policy decisions in the workspace; the service should only perform a requested sound or system notification. Provide injectable/mocked browser adapters, or a small exported class/factory, so unit tests do not depend on real audio or OS notifications.

### 3. Add notification preference state to the workspace

In `src/lib/harness/workspace.svelte.ts`:

- Add a typed preferences shape, for example:
  - `soundsEnabled`
  - `systemNotificationsEnabled`
  - `notifyOnCompletion`
  - `notifyOnPermission`
- Add dedicated `localStorage` keys, following the existing theme/display-preference pattern.
- Restore preferences during `#initialize()` through explicit restore methods.
- Add public setter methods used by Settings; setters update state and persist immediately.
- Add a public method for requesting browser notification permission. Update the displayed permission status after the request resolves, but do not attempt repeated requests after denial.
- Add public “test completion sound” and “test system notification” methods. These are useful both for user feedback and for satisfying audio user-activation restrictions.

Do not use `$effect` for preference persistence or notification dispatch. Use explicit setters and the existing event handlers.

### 4. Detect and dispatch permission notifications

In `HarnessWorkspace.#applyEnvelope()`:

1. Let `applyRuntimeEvent()` validate/apply the event first.
2. Dispatch only when its result is `applied`, never for `duplicate` or `recovery`.
3. For `permission_request`, dispatch after the snapshot and `chat.permissionRequests` projection have been updated.
4. Pass the runtime/event identity, chat title, permission summary, chat URL, and current foreground/background status to a workspace notification helper.

Use the envelope ID and/or `runtimeId + request.id` as the deduplication identity. Keep a bounded in-memory set of recently dispatched identities to protect against repeated delivery without allowing unbounded growth.

### 5. Detect and dispatch completion notifications

Before applying a revisioned event, capture the authoritative previous `chat.runtime.metadata.isStreaming` value. After the event is successfully applied and the snapshot is refreshed:

- Dispatch completion only when the previous value was `true` and the new value is `false`.
- Do not infer completion from `items_appended` alone; the streaming metadata transition is the authoritative signal.
- Dispatch before transient stream display state is cleared, but never block cleanup on sound or Notification API failures.
- Use the event envelope ID as the deduplication identity.

This transition-based check prevents completion sounds during initial hydration, checkpoint application, settled-session restoration, and unrelated metadata updates.

### 6. Add Settings UI

Extend `src/routes/(workspace)/(utility)/settings/+page.svelte` with a **Notifications** card using the existing `Switch` component and visual language.

Controls:

- Enable notification sounds.
- Notify when agents complete.
- Notify when permission is required.
- Test completion sound.
- Enable system notifications / show current browser permission status.
- Test system notification when permission is granted.

UI rules:

- The system-notification enable button directly calls `Notification.requestPermission()` so it runs under user activation.
- Explain that denied permission must be changed in browser/site settings.
- Show an unsupported message when the API is absent.
- Disable the system test button unless permission is granted and the preference is enabled.
- Keep completion/permission event toggles shared by sound and system delivery unless product requirements later call for a full per-channel matrix.
- Ensure controls have explicit accessible labels and status text exposed to assistive technology.

Run the Svelte autofixer on the modified component until it returns no issues or suggestions.

### 7. Navigation and foreground policy

Add a focused helper in the workspace to determine whether a system pop-up is useful:

- Treat `document.visibilityState !== 'visible'` or `!document.hasFocus()` as background.
- Also allow a pop-up when the event belongs to a chat other than the active routed chat.
- Suppress only the system pop-up in the active foreground chat; do not suppress enabled sounds.

For notification clicks:

- Focus the current window.
- Navigate with the existing SvelteKit routing approach to `workspace.chatHref(projectId, sessionId)`.
- If direct `goto()` ownership would couple the service to routing, pass an `onClick` callback from the workspace/layout rather than importing navigation into the low-level service.

### 8. Unit tests

Add `src/lib/client-notifications.spec.ts` covering:

- Safe no-op behavior without browser APIs.
- Audio URL selection and replay behavior.
- Rejected audio playback is swallowed/reported without throwing.
- Permission status mapping and explicit permission requests.
- No system notification unless permission is granted.
- Notification title/body/tag and click cleanup/focus behavior.

Extend `src/lib/harness/workspace.spec.ts` with mocked notification delivery covering:

- One permission notification for a newly applied request.
- No permission notification for duplicate delivery or permission resolution.
- One completion notification for `true -> false`.
- No completion notification for `false -> false`, hydration checkpoints, or unrelated mutations.
- Preference restoration and setter persistence.
- Per-event toggles.
- Foreground system-pop-up suppression and background/non-active-chat delivery.
- Notification failures do not interrupt SSE state application.

Keep notification tests deterministic by injecting the service into `HarnessWorkspace` or mocking the service module; do not construct real browser notifications in Vitest.

### 9. Component and end-to-end tests

Add or extend Settings component/browser tests to verify:

- Notification controls render with accessible names.
- Toggling sound and event preferences updates `localStorage`.
- The permission button calls the stubbed Notification API from a click.
- Granted, denied, and unsupported statuses render correctly.
- Test buttons enable/disable correctly.

Extend `src/routes/page.svelte.e2e.ts` only for the user-visible Settings flow. Stub `window.Notification` and audio playback with `page.addInitScript()`; OS notification rendering itself should not be asserted in Playwright.

### 10. Validation

Run:

```sh
npm run lint
npm run check
npm run test:unit -- --run
npm run test:e2e
npm run build
```

Manually verify in at least Chromium and one additional supported browser:

1. Enable sounds and play each test sound.
2. Grant system notifications from Settings.
3. Start an agent response, background the tab, and confirm one completion sound/pop-up.
4. Trigger a permission request while backgrounded and confirm one permission sound/pop-up.
5. Click each pop-up and confirm the correct chat opens and the window focuses.
6. Reconnect the event stream/reload a settled chat and confirm no stale duplicate notification.
7. Deny browser permission and confirm the app remains functional with clear Settings guidance.

## Browser and deployment constraints

- Browser notifications generally require a secure context (`https://`) except for loopback origins such as `localhost`.
- Browser policy may block audio until the user interacts with the page. The Settings enable/test actions provide that interaction, but playback failures must still be non-fatal.
- The Notification API can notify while the page is open, backgrounded, or minimized. It cannot notify after the browser/app is fully closed.
- Closed-app notifications would require a separate Web Push/service-worker design, including subscriptions and server-side push delivery; that is outside this implementation.
- A future Electron wrapper may replace the system-pop-up adapter with native Electron notifications while retaining the same workspace event policy and sounds.

## Non-goals

- Web Push or notifications while the application is closed.
- Service-worker registration.
- Server-side OS notification commands.
- Electron IPC/native notifications in this change.
- Uploading or selecting custom sound files.
- Synchronizing notification preferences across browsers/devices.

## Acceptance criteria

- The supplied sounds are served from `static/sounds/` and resolve correctly under SvelteKit base paths.
- Users can independently opt into sounds, system notifications, completion events, and permission events from Settings.
- A live agent completion emits at most one configured notification.
- A new live permission request emits at most one configured notification.
- Initial hydration, history restoration, event duplicates, and reconnect recovery do not emit stale notifications.
- Denied/unsupported browser notification APIs and blocked audio never break runtime event handling.
- System-notification clicks focus the app and open the relevant chat.
- Settings are accessible, persisted locally, and covered by automated tests.
- Lint, type checks, unit tests, end-to-end tests, and production build pass.
