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

- [`setup.sh`](Linux/setup.sh) installs Pi, the required extensions, the permission configuration, and the project dependencies, then builds the application and initializes the server-side update reminder timestamp. After a successful build it asks whether to register the optional current-user systemd service `pi-squared.service`; an empty answer defaults to no.
- [`update.sh`](Linux/update.sh) pulls the latest repository version, updates Pi and its extensions, installs the current project dependencies, then rebuilds the application. If `pi-squared.service` is registered, it delegates the restart to [`restart-service.sh`](Linux/restart-service.sh); otherwise it leaves the current process alone.
- [`restart-service.sh`](Linux/restart-service.sh) requests a no-block restart of the registered `pi-squared.service` user unit and can be run manually from any directory.
- [`run.sh`](Linux/run.sh) starts the production build on port `3049`. Press **Esc** or **Ctrl+C** to stop a manually started server. When the user service is registered, normal invocation does not start a duplicate; use `Linux/run.sh --service` only from the service unit.
- [`uninstall.sh`](Linux/uninstall.sh) stops, disables, and removes `pi-squared.service` when it is installed. It does not remove the application or its data.

```sh
./Linux/setup.sh
./Linux/update.sh
./Linux/restart-service.sh
./Linux/run.sh
./Linux/uninstall.sh
```

When setup registers `pi-squared.service`, it writes an absolute repository path and the setup-time `PATH` to `~/.config/systemd/user/pi-squared.service`, then enables and starts it immediately. Manage it with:

```sh
systemctl --user status pi-squared.service
systemctl --user start pi-squared.service
systemctl --user stop pi-squared.service
systemctl --user restart pi-squared.service
```

This is a login-scoped user service: setup does not enable systemd lingering, so it runs when the current user has a normal user session. Moving the repository requires running setup again so the registered absolute paths are updated.

### Windows

Equivalent PowerShell scripts are available in [`Windows/`](Windows/):

- [`setup.ps1`](Windows/setup.ps1) installs Pi, the required extensions, the permission configuration, and the project dependencies, then builds the application and initializes the server-side update reminder timestamp. After a successful build it asks whether to register the optional hidden current-user Scheduled Task `Pi Squared`; an empty answer defaults to no.
- [`update.ps1`](Windows/update.ps1) pulls the latest repository version, updates Pi and its extensions, installs the current project dependencies, then rebuilds the application. If `Pi Squared` is registered, it delegates the restart to [`restart-service.ps1`](Windows/restart-service.ps1); otherwise it leaves the current process alone.
- [`restart-service.ps1`](Windows/restart-service.ps1) requests a replacement instance of the registered `Pi Squared` Scheduled Task and can be run manually from any directory. The setup-created `MultipleInstances StopExisting` policy performs the replacement.
- [`run.ps1`](Windows/run.ps1) starts the production build on port `3049`. Press **Esc** or **Ctrl+C** to stop a manually started server. When the task is registered, normal invocation does not start a duplicate; use `Windows/run.ps1 -ServiceMode` only from the task.
- [`uninstall.ps1`](Windows/uninstall.ps1) stops and unregisters the `Pi Squared` task when it exists. It does not remove the application or its data.

```powershell
.\Windows\setup.ps1
.\Windows\update.ps1
.\Windows\restart-service.ps1
.\Windows\run.ps1
.\Windows\uninstall.ps1
```

When setup registers `Pi Squared`, it uses the built-in ScheduledTasks cmdlets to create a hidden, current-user task that runs `Windows/run.ps1 -ServiceMode` immediately and at the current user's logon, without storing a password. Manage it with:

```powershell
Get-ScheduledTask -TaskName 'Pi Squared'
Start-ScheduledTask -TaskName 'Pi Squared'
Stop-ScheduledTask -TaskName 'Pi Squared'
Stop-ScheduledTask -TaskName 'Pi Squared'; Start-ScheduledTask -TaskName 'Pi Squared'
```

The task runs only for the interactive user who ran setup at logon. It has no execution time limit, can start and remain running on battery power, and replaces an existing instance when setup re-registers it. Moving the repository requires running setup again so the registered absolute paths are updated.

## In-app application updates

Settings includes an **Update application** action, and Pi Squared shows a persistent update reminder every five days. The reminder timestamp is shared by the server installation and stored in its Pi Squared data directory rather than in browser storage. Choosing **Yes** or **No** records the current server time and dismisses the reminder. Updates execute the platform update script, stream labeled stdout and stderr into an accessible dialog, and keep running if the browser disconnects.

After a successful update, the dialog offers **Restart app** when the native background registration exists. Linux requires the `pi-squared.service` user unit and Windows requires the `Pi Squared` Scheduled Task. Without either registration, updating still works but setup must be rerun with background registration enabled before the app can restart itself. A restart waits for the updated server to reconnect and then reloads the browser; a failed update retains its output and offers Retry instead of restart.

The UI invokes `Linux/update.sh --no-restart` or `Windows/update.ps1 -NoRestart`, so the update process can report completion before the current server is restarted. Manual restart commands are `./Linux/restart-service.sh` and `.\Windows\restart-service.ps1`.

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

Pi Squared stores its added-project registry and the server-side application update reminder state. These files are created in the data directory and are never bundled with the application.

| Platform | Default projects registry path                           |
| -------- | -------------------------------------------------------- |
| Linux    | `~/.config/pi-squared/projects.json`                     |
| macOS    | `~/Library/Application Support/pi-squared/projects.json` |
| Windows  | `%APPDATA%\\pi-squared\\projects.json`                   |

The application update reminder is stored beside the registry as `application-update-reminder.json`. Setup initializes it before registering a background process and persists the resolved absolute data directory in the registration, so custom `PI_SQUARED_DATA_DIR`, `XDG_CONFIG_HOME`, and paths containing spaces remain consistent between setup and the service.

Set `PI_SQUARED_DATA_DIR` to use a custom or portable data directory.

Pi owns credentials, settings, and session JSONL files under `~/.pi/agent/` by default. Closing a browser tab disposes its in-memory runtime but does not delete the Pi session.

## Trust And Security

Adding a project explicitly trusts its Pi project resources. Pi can then load that project's `.pi` settings, extensions, prompts, and skills. Pi has no built-in sandbox: its tools can read files, edit files, and execute commands with the permissions of the process running this application.

Only add projects you trust. For untrusted repositories or remote deployment, run the harness in a properly isolated container, VM, or sandbox with restricted files, credentials, and networking.
