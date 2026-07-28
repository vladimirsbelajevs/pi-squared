# Pi Squared

Pi Squared is a local, tab-first web harness for the [Pi SDK](https://pi.dev/docs/latest/sdk).

- Each chat tab owns an independent persistent Pi session.
- Projects, models, and reasoning levels are selected when creating a new tab.
- A pinned utility tab contains historical sessions and harness theme settings.
- Historical sessions reopen as ordinary, continuable chat tabs.

## Requirements

- Node.js `>=22.19.0`
- Pi provider credentials configured for the local user

When Node is managed by `fnm`, run commands through it:

```sh
fnm exec --using 22.23.1 npm install
fnm exec --using 22.23.1 npm run dev
```

Pi reads models and credentials from its standard locations, including `~/.pi/agent/auth.json` and `~/.pi/agent/models.json`. Configure a provider with Pi before starting a model-backed chat.

## Local Use

Start the SvelteKit development server:

```sh
fnm exec --using 22.23.1 npm run dev
```

Open the printed local URL. Add a project only from a new-chat tab, choose one of the authenticated models, select a reasoning level, and send an opening prompt.

The app is designed for local, single-user use. Bind it to localhost unless an authentication and isolation layer is added.

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

## Verification

```sh
fnm exec --using 22.23.1 npm run check
fnm exec --using 22.23.1 npm run lint
fnm exec --using 22.23.1 npm run test:unit -- --run
fnm exec --using 22.23.1 npm run test:e2e
fnm exec --using 22.23.1 npm run build
```
