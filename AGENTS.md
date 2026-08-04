## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, mcp,
  sveltekit-adapter, storybook ([Svelte component tests](https://svelte.dev/docs/svelte/testing#Component-tests-with-Storybook))

## Svelte Reactivity:

- Treat `$effect` as an escape hatch and avoid it by default.
- Never use `$effect` to synchronize or derive state; prefer `$derived`, event
  handlers, function bindings, or explicit methods instead.
- Prefer `{@attach}` for DOM lifecycle work and SvelteKit navigation hooks such
  as `afterNavigate` for route lifecycle work.
- Use `$effect` only when no declarative or lifecycle API expresses the required
  browser-side integration; keep any such effect narrowly scoped and do not
  write reactive state from it.

## Bits UI

- For Bits UI development, configuration, troubleshooting, or API questions,
  read and follow [`.agents/skills/bits-ui/SKILL.md`](.agents/skills/bits-ui/SKILL.md).

## Storybook component testing

- For UI component stories and Storybook component tests, read and follow
  [`.agents/skills/storybook-tests/SKILL.md`](.agents/skills/storybook-tests/SKILL.md).

## Temp files
Do not make temp files outside of the project directory. If you need to make temp files, use the `/tmp` directory in the project root and clean them up after use. Do not make temp files in the home directory or any other system directories.


## Code style

### General coding guidlines

Keep the code cohesive - keep closely related functionality together (unless it breaks common SvelteKit patterns, like `$lib/server`)

### Svelte code style

If .svelte files become larger than 300 lines (excluding `<style></style>` section) then
consider splitting component into smaller components.

Follow **smart parent / dumb child** pattern, but do not apply it as a rigid rule.

Here are some component guidlines guidlines:

- `+page.ts` / `+page.server.ts` for loading and server-side concerns
- page component for orchestration
- feature components for cohesive domain behavior
- small presentational components for reusable UI
- context or shared state only when props genuinely become cumbersome

Keep state in the lowest component that needs it, but lift it when another component or business operation must coordinate it.

### Performance

When implementing big features do keep in mind how it will perform.
Do not do computationaly expensive implementations

### Linting

- After making any edits, run `npm run lint` before responding. Report any
  failures and their cause.

---

You are able to use the Svelte MCP server, where you have access to
comprehensive Svelte 5 and SvelteKit documentation. Here's how to use the
available tools effectively:

## Available Svelte MCP Tools:

### 1. list-sections

Use this FIRST to discover all available documentation sections. Returns a
structured list with titles, use_cases, and paths. When asked about Svelte or
SvelteKit topics, ALWAYS use this tool at the start of the chat to find relevant
sections.

### 2. get-documentation

Retrieves full documentation content for specific sections. Accepts single or
multiple sections. After calling the list-sections tool, you MUST analyze the
returned documentation sections (especially the use_cases field) and then use
the get-documentation tool to fetch ALL documentation sections that are relevant
for the user's task.

### 3. svelte-autofixer

Analyzes Svelte code and returns issues and suggestions. You MUST use this tool
whenever writing Svelte code before sending it to the user. Keep calling it
until no issues or suggestions are returned.

### 4. playground-link

Generates a Svelte Playground link with the provided code. After completing the
code, ask the user if they want a playground link. Only call this tool after
user confirmation and NEVER if code was written to files in their project.

## Chrome MCP:

You have chrome MCP available, first check if you can connect.
If you cannot open flatpak chrome with remote debugging enabled and then connect to MCP

You can use chrome MCP for bug hunting and performance profiling

```
nohup setsid flatpak run com.google.Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.var/app/com.google.Chrome/cache/vscode-debug"
```
