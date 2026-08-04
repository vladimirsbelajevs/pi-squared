---
name: playwright-cli
description: Automates and verifies web user interfaces using Playwright CLI. Use for navigating applications, reproducing UI bugs, completing user flows, inspecting accessibility snapshots, testing forms, checking console and network activity, and capturing screenshots.
compatibility: Requires the playwright-cli command and an installed Playwright browser.
---

---

# Playwright CLI Browser Automation

Use Playwright CLI for functional browser interaction and UI verification.

## Appropriate tasks

Use this skill for:

- Reproducing frontend bugs
- Navigating and interacting with web applications
- Testing forms and complete user flows
- Verifying rendered content and application state
- Inspecting accessibility snapshots
- Capturing screenshots
- Inspecting browser console errors
- Inspecting network requests
- Verifying UI behavior after code changes

## Command availability

Confirm that Playwright CLI is available:

```bash
playwright-cli --version
```

Do not install packages, browser binaries, or operating-system dependencies unless the user explicitly requests installation.

## Repository configuration

Respect the repository's existing Playwright CLI configuration:

```text
.playwright/cli.config.json
```

Do not override browser, profile, launch, timeout, output, or network settings through command-line flags unless the task specifically requires it.

Inspect the effective configuration when troubleshooting:

```bash
playwright-cli config-print
```

## Sessions

Use a named session for each task. Choose a short, stable name derived from the repository or feature:

```bash
playwright-cli -s=account-dashboard open http://localhost:5173
```

Use the same `-s=<name>` argument for every subsequent command in that workflow:

```bash
playwright-cli -s=account-dashboard snapshot
playwright-cli -s=account-dashboard click e15
playwright-cli -s=account-dashboard close
```

Named sessions reduce interference with other browser automation tasks.

## Workflow

### 1. Establish the target

Before interacting:

1. Determine the application URL.
2. Determine the expected behavior or acceptance criteria.
3. Confirm that the application is reachable.
4. For bug fixes, reproduce the bug before changing code whenever practical.

Do not guess development-server ports. Inspect project configuration, package scripts, documentation, or existing terminal output.

### 2. Open the application

```bash
playwright-cli -s=ui-check open http://localhost:5173
```

When the session already exists, navigate within it:

```bash
playwright-cli -s=ui-check goto http://localhost:5173/settings
```

### 3. Inspect the current page

Start with a snapshot:

```bash
playwright-cli -s=ui-check snapshot
```

Use the returned element references for subsequent interactions.

For large pages, avoid repeatedly retrieving more page structure than the task requires. Focus inspection on the relevant component, dialog, form, or application region.

### 4. Target elements reliably

Prefer targets in this order:

1. Element references from the latest snapshot
2. Accessible roles and names
3. Test IDs
4. Stable selectors
5. Coordinates only as a last resort

Example using a snapshot reference:

```bash
playwright-cli -s=ui-check click e15
```

Element references may become stale after:

- Navigation
- Page reloads
- Modal changes
- Form submission
- List updates
- Significant DOM changes

Take another snapshot after the page changes substantially.

Never assume that an old reference still points to the same element.

### 5. Perform interactions

Common commands:

```bash
playwright-cli -s=ui-check click e15
playwright-cli -s=ui-check fill e20 "Example value"
playwright-cli -s=ui-check press Enter
playwright-cli -s=ui-check select e25 "option-value"
playwright-cli -s=ui-check check e30
playwright-cli -s=ui-check hover e35
```

After navigation, form submission, or a significant UI update, inspect the resulting state before issuing more actions.

### 6. Verify the result

A command completing successfully does not prove that the application behaved correctly.

Verify the expected outcome using the rendered page:

```bash
playwright-cli -s=ui-check snapshot
```

Also inspect browser errors when relevant:

```bash
playwright-cli -s=ui-check console
```

Inspect network activity when the flow depends on API calls:

```bash
playwright-cli -s=ui-check requests
```

Use JavaScript evaluation only when the required state cannot reasonably be verified through the user-facing interface:

```bash
playwright-cli -s=ui-check eval "() => document.title"
```

Do not use evaluation merely to bypass normal user interactions.

### 7. Capture visual evidence

Capture screenshots for:

- Confirmed bugs
- Successful fixes
- Visual regressions
- Unexpected states
- User-requested evidence

Use descriptive filenames:

```bash
playwright-cli -s=ui-check screenshot --filename=before-fix.png
playwright-cli -s=ui-check screenshot --filename=after-fix.png
```

When only one component matters, capture that element using its current snapshot reference when supported.

Do not claim that a visual issue is fixed solely from an accessibility snapshot. Inspect a screenshot when appearance is part of the acceptance criteria.

### 8. Diagnose failures

Inspect console output:

```bash
playwright-cli -s=ui-check console
```

Inspect network requests:

```bash
playwright-cli -s=ui-check requests
```

Use tracing when ordinary inspection is insufficient:

```bash
playwright-cli -s=ui-check tracing-start
# Reproduce the issue.
playwright-cli -s=ui-check tracing-stop
```

Before modifying application code, determine whether the failure is caused by:

- The development server not running
- An incorrect URL or port
- Authentication state
- Missing environment configuration
- A stale browser session
- A backend or API failure
- A genuine frontend defect

Identify the actual failure boundary first.

### 9. Re-test after code changes

After implementing a fix:

1. Reload or reopen the relevant page.
2. Repeat the original interaction sequence.
3. Verify the exact expected result.
4. Check for new console errors.
5. Check relevant failed network requests.
6. Capture visual evidence when appropriate.
7. Run relevant repository tests separately.

Browser inspection supplements repository tests. It does not replace unit, integration, or committed end-to-end tests.

### 10. Clean up

Close only the session created for the current task:

```bash
playwright-cli -s=ui-check close
```

Do not use `close-all` or `kill-all` when unrelated developer or agent sessions may be running.

Use `kill-all` only when stale daemon processes cannot otherwise be recovered:

```bash
playwright-cli kill-all
```

## Authentication and persistent state

Use isolated browser state by default.

Do not:

- Print authentication cookies
- Print access tokens from browser storage
- Reuse the user's personal browser profile
- Save authentication state inside committed repository files
- Commit browser storage, cookies, or generated secrets
- Enable persistent state without a concrete requirement

When authentication state must be preserved, store it in a gitignored location and avoid printing its contents.

## Destructive actions

Do not perform irreversible or externally consequential actions unless explicitly authorized.

This includes:

- Deleting accounts or data
- Submitting purchases
- Sending messages or emails
- Publishing content
- Changing production settings
- Accepting legal terms
- Triggering deployments
- Modifying billing information

When sufficient for verification, navigate up to the final confirmation step without completing the consequential action.

## Reporting

At the end of the task, report:

- The URL and user flow tested
- The session name used
- What behavior was verified
- Any console errors
- Any failed or suspicious network requests
- Screenshots or traces created
- Remaining limitations
- Whether the browser session was closed

State clearly when verification was incomplete. Do not describe a flow as passing when only part of it was exercised.
