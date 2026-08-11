# Ship Pi Squared as an Electron Desktop App

## Summary

Add a packaged Electron shell for Linux and Windows while retaining the manually started localhost web app. Remove the systemd/Scheduled Task installation model. Desktop builds will run the existing SvelteKit server privately on loopback, display it in a secured Electron window, remain available from the system tray when the window closes, bootstrap the global Pi CLI/extensions on first launch, and update from GitHub Releases.

## Desktop architecture

- Add Electron main/preload/server-entry code and TypeScript build configuration.
- Keep `@sveltejs/adapter-node`; do not convert the app to a static renderer because its API routes and long-lived Pi runtimes require Node.
- In packaged mode, launch a dedicated Node child process using Electron’s runtime and a custom HTTP entry around the adapter-node handler:
  - bind only to `127.0.0.1` on an OS-assigned port;
  - report the selected port to the Electron main process over IPC;
  - set `PI_SQUARED_DESKTOP=1` and use Electron’s `userData` path as `PI_SQUARED_DATA_DIR`;
  - load the window only after the health endpoint responds;
  - terminate the child cleanly on explicit Quit or update installation, with a forced timeout fallback.
- Enforce one desktop instance. A second launch focuses/restores the existing window.
- BrowserWindow security defaults: context isolation and sandbox enabled, Node integration disabled, a narrow preload API only, denied unexpected popups/navigation, and external HTTP(S) links delegated to the operating system browser.
- Closing the window hides it instead of quitting. Add a tray menu with **Show Pi Squared** and **Quit**; explicit Quit stops the local server and active runtimes. Do not add automatic OS-login startup.
- Package the current icon in Linux/Windows-compatible formats and use it for the window, tray, and installers.

## First-run Pi setup

- Add a blocking desktop onboarding dialog when required Pi setup is missing or incomplete. Existing configured users should pass detection without reinstalling anything.
- Through the preload/main IPC boundary, run the existing platform Pi setup logic from unpacked packaged resources and stream labeled output to the onboarding UI:
  - install/update the global Pi CLI;
  - install the six currently required Pi packages/extensions;
  - copy the shared permission configuration into the normal Pi agent directory;
  - preserve and share existing `~/.pi/agent` settings, credentials, models, packages, and sessions.
- Keep Node.js `>=22.19.0`, npm, network access, and provider credential configuration as setup prerequisites because the selected workflow installs a usable global `pi` command. Detect missing commands before starting and present actionable errors with Retry and Quit controls.
- Make bootstrap checks idempotent by inspecting Pi’s user package settings, permission configuration, and global CLI availability rather than relying only on an Electron marker file.
- Do not collect provider secrets in Electron. After bootstrap, explain that at least one provider must be configured with Pi; existing credentials continue to work.
- On successful bootstrap, restart the desktop server before enabling normal use so newly installed extensions are loaded consistently.

## Desktop updates

- Use `electron-updater` against public GitHub Releases for `vladimirsbelajevs/pi-squared`.
- In desktop mode:
  - check for a newer release shortly after launch and on the existing five-day cadence;
  - change Settings to **Check for updates**;
  - only show an update prompt when a newer version exists;
  - use `autoDownload = false`, download only after user confirmation, report download progress/errors in the existing accessible update dialog, and offer **Restart and install** when ready;
  - install via Electron’s updater and relaunch without querying systemd or Scheduled Tasks.
- Keep the source/web updater for manual repository users, but update its messaging and completion state to require manually stopping and rerunning the server after a successful git/npm build.
- Disable the script-based update/restart endpoints in packaged desktop mode so a local HTTP caller cannot invoke repository scripts from an installed app.
- Keep Electron app updates and global Pi package updates distinct: app releases update bundled application code; first-run/setup repair owns required global Pi packages. Do not run `git pull` or rebuild npm dependencies inside an installed desktop app.

## Packaging and commands

- Add Electron, `electron-builder`, `electron-updater`, and minimal process-coordination/build dependencies.
- Add npm commands for:
  - Electron development against Vite with managed startup/shutdown;
  - compiling SvelteKit plus Electron code;
  - creating unpacked desktop builds for local testing;
  - producing platform installers without publishing;
  - publishing tagged releases from CI.
- Configure `electron-builder` with application ID/version metadata and explicit packaged resources. Include the SvelteKit build, production dependencies, Electron code, setup/config assets, sounds, and icons; keep executable setup resources outside ASAR where required.
- Linux output: AppImage as the auto-updatable primary artifact and a `.deb` installer as an additional convenience artifact.
- Windows output: per-user NSIS installer with the updater metadata required by `electron-updater`.
- Windows artifacts are intentionally unsigned initially; document SmartScreen warnings. Keep signing configuration absent rather than implying trust, while structuring builder configuration so signing can be added later.

## Release automation

- Add a GitHub Actions workflow for version tags, with separate current Ubuntu and Windows jobs using `npm ci` and the project’s supported Node version.
- Validate that the tag matches `package.json` version, run lint/check/tests, build platform artifacts, and publish both jobs’ files to the same GitHub Release using the repository token.
- Generate and upload updater metadata alongside AppImage/NSIS artifacts. Also support manual workflow dispatch for non-publishing artifact validation.
- Document that a release is created by bumping `package.json`/lockfile version and pushing the matching tag.

## Existing script and documentation changes

- Simplify Linux and Windows `setup` scripts to install Pi prerequisites/dependencies and build the manual web app without offering systemd/Scheduled Task registration.
- Simplify `run` scripts to run only the foreground manual server; remove service/task duplicate detection and service-mode arguments.
- Make source `update` scripts build without attempting a service/task restart.
- Remove the service/task restart and uninstall scripts and their service-specific server logic/tests.
- Rewrite README setup, desktop installation, local packaging, release, update, tray lifecycle, data location, prerequisites, unsigned Windows warning, and manual-web sections. Clearly distinguish desktop updates from source checkout updates.

## Interfaces and behavior changes

- Add a typed, minimal `window.piSquaredDesktop` preload contract for environment detection, bootstrap status/start/progress, desktop update status/start/progress, restart-and-install, and app version. Validate IPC senders and payloads in the main process.
- Refactor the update UI behind source-web and Electron update providers so ordinary browser use never depends on Electron globals.
- Replace `nativeRegistration`/service-specific status semantics with an explicit runtime/update mode (`source-web` or `electron`) and mode-appropriate restart capability.
- Preserve existing project/session/data formats and the standard Pi agent directory; no data migration is required.

## Tests and verification

- Unit-test desktop bootstrap detection, required package lists, progress/error normalization, packaged/source mode selection, update state transitions, and removal of service/task registration behavior.
- Component-test onboarding and updater states: already configured, missing prerequisite, install progress, failure/retry, update unavailable, update available, download progress, downloaded/restart, and source-mode manual restart messaging.
- Test Electron IPC handlers with mocked BrowserWindow, child process, tray, and updater objects, including sender validation and cleanup timeouts.
- Run existing unit and browser suites, `npm run check`, and required `npm run lint`; run the Svelte autofixer on every changed Svelte component until it reports no issues.
- Add Electron smoke verification for both unpacked development and packaged builds: one-instance behavior, server startup, project selection, window hide/restore from tray, explicit Quit cleanup, denied popup/navigation, and persistence across restart.
- Validate generated Linux AppImage/DEB and Windows NSIS contents on their native CI runners. Exercise updater behavior against a draft/test release before publishing a production tag.

## Acceptance criteria

- A user can install and launch Pi Squared from AppImage/DEB or NSIS without registering a background service/task.
- First launch can install the global Pi CLI and required extensions with visible progress and useful recovery errors; existing Pi credentials/data are reused.
- Closing the window leaves the app available in the tray, while Quit fully stops its local server.
- Packaged applications detect, download, and install matching GitHub Releases without git/npm rebuilding or service/task scripts.
- Manual foreground web usage remains supported and documented, with no remaining systemd/Scheduled Task installation prompt.

## Assumptions

- GitHub Releases for `vladimirsbelajevs/pi-squared` are publicly accessible to updater clients.
- Linux and Windows are the only initial desktop targets; macOS is out of scope.
- Windows signing is out of scope for the first release.
- Node/npm remain prerequisites for the selected global Pi CLI bootstrap, even though Electron supplies the application’s own Node runtime.
- Provider authentication remains owned by Pi and is not added to this feature.
