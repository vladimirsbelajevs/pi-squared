# Pi Squared

Pi Squared is a SvelteKit web UI for the [Pi SDK](https://pi.dev/docs/latest/sdk). Each chat tab owns an independent persistent Pi session, while projects, models, history, and themes are shared by the local server.

## Requirements

- Node.js `>=22.19.0` and npm
- A Pi provider credential configured for the local user (Pi owns authentication)
- Network access on first desktop launch to install the global Pi CLI/extensions

## Desktop app (Linux and Windows)

Desktop releases are distributed as a Linux AppImage/DEB or a per-user Windows NSIS installer. The app starts the existing adapter-node server on an ephemeral `127.0.0.1` port and opens it in a secured Electron window. The server is private to the desktop app; no systemd service, Scheduled Task, or automatic login startup is installed.

On first launch, Pi Squared checks Node.js, npm, the global `pi` command, the six required extensions, and the permission configuration. A blocking setup dialog runs the existing platform setup script and streams labeled output. Existing `~/.pi/agent` credentials, settings, models, packages, and sessions are preserved. Provider secrets are never collected by Electron.

Closing the window hides it in the system tray. **Show Pi Squared** restores it; **Quit** stops the local server and active runtimes. Tray availability is not an OS-login startup mechanism.

Windows installers are unsigned initially. Windows may display a SmartScreen warning; signing configuration is intentionally absent until a trusted certificate is available.

## Install and run from source (manual web server)

The source checkout remains a supported foreground web app. These scripts install Pi prerequisites/dependencies, build the app, and do not register background services/tasks:

```sh
./Linux/setup.sh
./Linux/run.sh
./Linux/update.sh
```

```powershell
.\Windows\setup.ps1
.\Windows\run.ps1
.\Windows\update.ps1
```

The foreground server listens on `http://127.0.0.1:3049`; stop it with Ctrl+C. `npm run start` is the cross-platform production start command. Do not expose this privileged coding-agent UI to a LAN or the public internet without authentication, HTTPS, CSRF protection, and an audit/rate-limiting layer.

## Desktop development and packaging

```sh
npm install
npm run dev                 # SvelteKit development server
npm run build:app           # SvelteKit + Electron TypeScript build
npm run electron:dev        # build and launch the Electron shell
npm run electron:package   # unpacked build for local smoke testing
npm run electron:dist      # Linux AppImage/DEB and Windows NSIS (on native runners)
```

`electron-builder.yml` packages the SvelteKit build, Electron code, production updater dependency, setup resources, and icon. User data is never included in an artifact. The Linux AppImage is the primary auto-update artifact; DEB is a convenience installer. Windows is per-user NSIS.

## Updates

In Electron, Settings says **Check for updates** and uses `electron-updater` against public GitHub Releases for `vladimirsbelajevs/pi-squared`. Checks run shortly after launch and every five days. Downloads require confirmation, report progress/errors in the accessible dialog, and finish with **Restart and install**. Electron application releases do not run `git pull`, npm builds, or service/task scripts; Pi package repair remains a separate first-run/setup operation.

In a source checkout, the same Settings action runs the update script and streams its output. A successful source build requires manually stopping and rerunning the foreground server. Source update endpoints are disabled in packaged desktop mode.

To publish a release, bump `package.json` and `package-lock.json` to the same version, commit, and push the matching `vX.Y.Z` tag. CI validates the tag, runs lint/check/tests, builds on Ubuntu and Windows, and publishes both platform artifacts and updater metadata to one GitHub Release. `workflow_dispatch` validates artifacts without publishing.

## Data locations

Pi Squared stores its project registry and update reminder under its application data directory:

| Platform       | Default project registry               |
| -------------- | -------------------------------------- |
| Linux source   | `~/.config/pi-squared/projects.json`   |
| Windows source | `%APPDATA%\\pi-squared\\projects.json` |
| Electron       | Electron `userData/projects.json`      |

Set `PI_SQUARED_DATA_DIR` for a source server. Electron sets it to its `userData` path. Pi credentials, settings, models, extension state, and sessions remain in the standard `~/.pi/agent/` directory (or `PI_CODING_AGENT_DIR`) and are not migrated or bundled.

## Development

```sh
npm run check
npm run lint
npm run test:unit -- --run
npm run dev
```

Adding a project explicitly trusts its Pi resources. Pi tools can read, edit, and execute commands with the permissions of the local process, so only add repositories you trust.
