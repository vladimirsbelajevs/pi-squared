# Project Guidance

## Purpose

This project is a development workspace for extensions to the Pi agent harness. Its output is a Pi extension package, not a standalone application. Changes should add or improve harness capabilities through Pi's extension APIs while keeping the package small and easy to load locally.

## Repository Layout

- `extensions/` contains the extension source code.
- Give each extension its own directory with an `index.ts` entry point.
- `package.json` exposes `./extensions` through the `pi.extensions` field.
- `tsconfig.json` type-checks all TypeScript files under `extensions/`.

## Extension Conventions

- Write strict TypeScript and use ES modules.
- Export a default function that accepts `ExtensionAPI` and registers the extension's hooks, commands, tools, or other behavior.
- Prefer the public APIs from `@earendil-works/pi-coding-agent`; do not depend on its internal implementation or edit files in `node_modules/`.
- Keep extension behavior self-contained. Extract shared code only when multiple extensions genuinely need it.
- Choose clear, collision-resistant command and tool names, and include useful user-facing descriptions.
- Handle user input and failures explicitly. Surface actionable messages through the Pi context when appropriate.
- Avoid adding runtime dependencies unless the extension cannot reasonably be implemented with Pi APIs or Node.js built-ins.

## Validation

- Run `npm run typecheck` after changing TypeScript.
- Exercise changed commands, hooks, and tools in a local Pi session when behavior cannot be verified by type-checking alone.
- Add focused tests if a test setup is introduced; do not treat a successful typecheck as proof of runtime behavior.

## Change Discipline

- Keep changes scoped to extension development and update `README.md` when adding user-facing installation or usage requirements.
- Never commit generated output, local state, credentials, or `node_modules/`.
- Preserve the package's role as a collection of Pi harness extensions rather than introducing an unrelated application layer.
