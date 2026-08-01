# Packaging Pi Squared as HTTP Server and Electron App

## Goal

Keep one Pi Squared application that can be used in either mode:

1. **HTTP server:** run on a machine and open it from a desktop browser or a phone.
2. **Electron desktop app:** launch the same server locally and open it in a native window.

Do **not** create a second renderer, duplicate API logic, or replace the API with Electron IPC. The existing browser UI, HTTP endpoints, and Server-Sent Events (SSE) are the shared application boundary.

## Current fit

Pi Squared already uses SvelteKit with `@sveltejs/adapter-node`. Its API routes run in Node and own the Pi SDK, filesystems, credentials, and persisted sessions. The browser UI communicates through `/api/*` and SSE.

This makes the intended deployment shape straightforward:

```text
Browser / Electron BrowserWindow
              |
          HTTP + SSE
              |
       SvelteKit Node server
              |
      Pi SDK, ~/.pi/agent, projects
```

## Preserve these boundaries

- Keep Pi SDK and filesystem access server-side.
- Keep the renderer as a normal web client. It must not need Electron APIs.
- Keep HTTP/SSE as the common transport for browser, Electron, and mobile clients.
- Store Pi credentials and extension state in the local user's existing Pi agent directory; never bundle them into an installer.
- Keep Electron as a launcher/window shell, not the application backend.

Electron IPC is only appropriate for genuinely desktop-only features, such as a native file picker, tray integration, notifications, or auto-updates. If introduced, expose it through a narrow preload API with context isolation enabled. Do not move the chat API to IPC.

## Phase 1: make the server launch explicit

First ensure that the normal production build can be started independently:

```sh
npm run build
HOST=127.0.0.1 PORT=3000 node build
```

`adapter-node` produces the `build/` server. Its `HOST` and `PORT` environment variables control the listener.

Add a documented production start command and a small Node launcher if cross-platform environment-variable handling is needed. Prefer a launcher over shell-specific `HOST=...` scripts for Windows support.

Use these modes deliberately:

| Mode                   | Bind address                      | Intended users                      |
| ---------------------- | --------------------------------- | ----------------------------------- |
| Default desktop/server | `127.0.0.1`                       | The local machine only              |
| LAN mode               | Explicit, configurable address    | Authenticated local-network devices |
| Electron               | `127.0.0.1` and an ephemeral port | The Electron window only            |

Do not bind to `0.0.0.0` by default. `adapter-node` otherwise defaults to that address.

## Phase 2: secure mobile/LAN access before enabling it

Pi Squared can load trusted-project resources and run Pi tools with the operating-system privileges of the server process. LAN access is therefore remote control of a privileged coding agent, not an ordinary unauthenticated dashboard.

Before shipping LAN mode, implement or deploy all of the following:

- Authentication with a strong, user-configured secret or device-pairing flow.
- HTTPS, with secure cookies and CSRF protection for state-changing requests.
- A clear opt-in LAN setting and a visible indication that remote access is active.
- Rate limiting and an audit trail for login and agent-control actions.
- Explicit behaviour for concurrent clients sending prompts or toggling MCP servers.

The simplest safe initial option is to keep the app bound to loopback and expose it through an authenticated private-network product such as Tailscale Serve, or an authenticated HTTPS reverse proxy such as Caddy. Do not expose it to the public internet.

A phone opens the same origin as a normal browser, for example `https://pi-squared.local/`. The phone and desktop will retain separate browser-local tab and draft state, but can access the same server-side project registry and Pi session files.

## Phase 3: add Electron as a thin wrapper

Add an Electron main-process entry point, for example `electron/main.ts`. Its responsibilities should be limited to:

1. Locate the packaged SvelteKit `build/` directory.
2. Select an unused loopback port.
3. Start the Node server with `HOST=127.0.0.1`, that port, and any required data-directory environment variables.
4. Wait for a health endpoint or successful HTTP response.
5. Create a `BrowserWindow` that navigates to the local server URL.
6. Stop the server gracefully when Electron exits.

Use secure BrowserWindow defaults:

```ts
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
}
```

If native Electron integrations are later needed, add a minimal preload script. Validate every IPC argument in the main process, and do not expose generic filesystem or shell APIs to the renderer.

### Runtime compatibility

Pi Squared currently requires a modern Node version and loads Pi extensions from the user's local Pi agent directory. Before selecting an Electron version or launch strategy, verify that Electron's embedded Node version satisfies Pi's requirement.

Possible launch strategies:

- Launch the server with Electron's Node mode (`ELECTRON_RUN_AS_NODE=1`) after compatibility testing.
- Ship a compatible Node runtime beside the Electron app and spawn it explicitly.
- Use a separately installed, supported Node runtime only if that dependency is acceptable for the desktop product.

Test extension loading, OAuth credentials, MCP adapters, and any native dependencies on every supported operating system. Packaging may require unpacking native modules from the Electron ASAR archive.

## Packaging layout

Keep the shared production server and Electron resources separate conceptually:

```text
application package
├── Electron main/preload code
├── SvelteKit build/ output
├── production node_modules required by build/
└── unpacked native modules, when required
```

The HTTP-server distribution needs the `build/` output, `package.json`, and production dependencies. The Electron distribution includes those same runtime assets plus Electron's main-process files.

Do not package or copy these user-specific files into either artifact:

- `~/.pi/agent/auth.json`
- `~/.pi/agent/models.json`
- Pi sessions, extensions, logs, or OAuth credentials
- the Pi Squared project registry

Document supported operating systems, the required Pi installation, and first-run setup separately from the installer.

## Validation plan

Add automated and manual checks as the work is implemented:

- `npm run lint`, `npm run check`, unit tests, and end-to-end tests.
- A production `node build` smoke test on loopback.
- An Electron smoke test that starts, loads, and shuts down the embedded server.
- A mobile browser test over the chosen HTTPS/private-network path.
- Tests for authentication, unauthenticated rejection, CSRF protection, and SSE reconnection.
- Manual tests for project loading, Pi permissions, model credentials, MCP enable/disable, session persistence, and clean shutdown.
- Cross-platform packaging tests for Linux, macOS, and Windows before claiming support.

## Suggested delivery order

1. Add and test a documented loopback-only production server command.
2. Add a health/readiness endpoint if one is needed by Electron.
3. Build the Electron proof of concept using the unchanged HTTP/SSE UI.
4. Package and test the proof of concept on one operating system.
5. Design and implement authenticated HTTPS/private-network access.
6. Test phone access and concurrent-client behaviour.
7. Add installers, signing/notarization, updates, and cross-platform support.

This order keeps the initial desktop wrapper small and prevents an insecure LAN feature from becoming the default deployment path.
