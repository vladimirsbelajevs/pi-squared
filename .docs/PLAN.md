# Themed custom Electron titlebar

## Summary
Replace the native Electron frame on Windows and Linux with a fully custom, right-aligned window-control titlebar. The titlebar will use the app’s existing CSS theme variables and will not appear in source-web/browser mode.

## Behavior and UI
- Create the main `BrowserWindow` with `frame: false` while retaining normal resizing and minimum-size behavior.
- Add a compact titlebar above the existing app content containing Pi² branding, a draggable region, and accessible minimize, maximize/restore, and close buttons on the right.
- Use the current theme’s `--surface*`, `--border*`, `--text*`, and `--danger` variables so theme changes immediately restyle the titlebar without separate synchronization.
- Mark only the non-interactive titlebar area as draggable and mark controls as non-draggable. Keep controls keyboard focusable with visible themed focus/hover states; use a danger hover state for Close.
- Reflect the actual maximized state in the maximize/restore icon and accessible label, including changes caused outside the button (for example, double-clicking the draggable titlebar).
- Preserve existing close behavior: Close routes through the `BrowserWindow` close flow, which hides the app to the tray unless the application is quitting.
- Wrap root content in a full-height column shell so the titlebar occupies its own row and the workspace fills only the remaining height. Browser mode remains full-height with no titlebar or reserved gap.

## Electron bridge and interfaces
- Extend `PiSquaredDesktopApi` with a cohesive window-controls API supporting:
  - querying `{ maximized: boolean }`,
  - subscribing/unsubscribing to window-state changes,
  - minimizing,
  - toggling maximize/restore,
  - closing the window.
- Expose those operations from the sandboxed preload via narrowly scoped IPC channels; do not expose Electron objects to the renderer.
- Validate every new IPC invocation with the existing trusted-main-frame check.
- Emit state updates from Electron’s maximize/unmaximize events and clean up renderer listeners when the titlebar unmounts.
- Update the desktop API runtime guard and existing typed desktop API test fixtures for the expanded contract.

## Svelte implementation
- Add a focused presentational `DesktopTitlebar` component and mount it from the root layout only when `getDesktopApi()` confirms Electron mode during `onMount`.
- Use event handlers and `onMount` cleanup for bridge integration; do not introduce `$effect`-based state synchronization.
- Run the Svelte autofixer on all changed Svelte files until it reports no issues or suggestions.

## Tests and verification
- Add component tests confirming all three controls invoke the correct bridge methods, maximize/restore labels and icons follow initial and pushed state, and the state listener is removed on unmount.
- Verify source-web rendering does not show a titlebar and continues to consume the full viewport.
- Verify Electron IPC rejects untrusted senders and that maximize state notifications are wired to the main window.
- Run `npm run lint`, `npm run check`, relevant Vitest tests, and `npm run build:app`.
- Launch the Electron development build and manually verify dragging, edge resizing, double-click maximize/restore, each control, tray-hide behavior, and live styling across both dark and light app themes.

## Assumptions
- The current packaged targets remain Windows and Linux; both use the same right-aligned control layout.
- The titlebar displays Pi² branding rather than route/session-specific document titles.
- No custom application menu is added as part of this change.
