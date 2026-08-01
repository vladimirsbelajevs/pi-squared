## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, vitest, playwright, tailwindcss, mcp,
  sveltekit-adapter

## Svelte Reactivity:

- Treat `$effect` as an escape hatch and avoid it by default.
- Never use `$effect` to synchronize or derive state; prefer `$derived`, event
  handlers, function bindings, or explicit methods instead.
- Prefer `{@attach}` for DOM lifecycle work and SvelteKit navigation hooks such
  as `afterNavigate` for route lifecycle work.
- Use `$effect` only when no declarative or lifecycle API expresses the required
  browser-side integration; keep any such effect narrowly scoped and do not
  write reactive state from it.

## Bits UI Documentation

- For Bits UI development, configuration, troubleshooting, or API questions,
  read and follow [`.agents/skills/bits-ui-docs/SKILL.md`](.agents/skills/bits-ui-docs/SKILL.md).

## Validation

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
