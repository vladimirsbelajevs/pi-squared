# Pi Squared

Pi Squared is a web UI using [Pi SDK](https://pi.dev/docs/latest/sdk).

- Each chat tab owns an independent persistent Pi session.
- Projects, models, and reasoning levels are selected when creating a new tab.
- A pinned utility tab contains historical sessions and harness theme settings.
- Historical sessions reopen as ordinary, continuable chat tabs.

## Requirements

- Node.js `>=22.19.0`
- Pi CLI harness installed
- Pi provider credentials configured for the local user

## Setup and Local Use

### Linux

The scripts in [`Linux/`](Linux/) can be run from any directory:

- [`setup.sh`](Linux/setup.sh) installs Pi, the required extensions, the permission configuration, and the project dependencies, then builds the application.
- [`update.sh`](Linux/update.sh) pulls the latest repository version, updates Pi and its extensions, then rebuilds the application.
- [`run.sh`](Linux/run.sh) starts the production build on port `3049`. Press **Esc** or **Ctrl+C** to stop it.

```sh
./Linux/setup.sh
./Linux/update.sh
./Linux/run.sh
```

### Windows

Equivalent PowerShell scripts are available in [`Windows/`](Windows/):

- [`setup.ps1`](Windows/setup.ps1) installs Pi, the required extensions, the permission configuration, and the project dependencies, then builds the application.
- [`update.ps1`](Windows/update.ps1) pulls the latest repository version, updates Pi and its extensions, then rebuilds the application.
- [`run.ps1`](Windows/run.ps1) starts the production build on port `3049`. Press **Esc** or **Ctrl+C** to stop it.

```powershell
.\Windows\setup.ps1
.\Windows\update.ps1
.\Windows\run.ps1
```

The platform-specific installers and permission scripts used by these wrappers are in [`pi_setup/`](pi_setup/). The shared permission configuration is [`pi_setup/configs/permissions.json`](pi_setup/configs/permissions.json). Set `PI_CODING_AGENT_DIR` to use a different Pi agent directory, or `PI_PERMISSION_SYSTEM_CONFIG_PATH` to set the exact permission configuration destination.

Pi reads models and credentials from its standard locations, including `~/.pi/agent/auth.json` and `~/.pi/agent/models.json`. Configure a provider with Pi before starting a model-backed chat.

The app is designed for local, single-user use. Bind it to localhost unless an authentication and isolation layer is added.

## Development

Start the SvelteKit development server:

```sh
npm run dev
```

Open the printed local URL. Add a project from a new-chat tab, choose an authenticated model, select a reasoning level, and send an opening prompt.

## Data Locations

Pi Squared stores only its added-project registry. The registry is created on first use and is never bundled with the application.

| Platform | Default registry path                                    |
| -------- | -------------------------------------------------------- |
| Linux    | `~/.config/pi-squared/projects.json`                     |
| macOS    | `~/Library/Application Support/pi-squared/projects.json` |
| Windows  | `%APPDATA%\\pi-squared\\projects.json`                   |

Set `PI_SQUARED_DATA_DIR` to use a custom or portable data directory.

Pi owns credentials, settings, and session JSONL files under `~/.pi/agent/` by default. Closing a browser tab disposes its in-memory runtime but does not delete the Pi session.

## Trust And Security

Adding a project explicitly trusts its Pi project resources. Pi can then load that project's `.pi` settings, extensions, prompts, and skills. Pi has no built-in sandbox: its tools can read files, edit files, and execute commands with the permissions of the process running this application.

Only add projects you trust. For untrusted repositories or remote deployment, run the harness in a properly isolated container, VM, or sandbox with restricted files, credentials, and networking.
