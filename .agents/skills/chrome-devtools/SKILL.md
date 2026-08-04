---
name: chrome-devtools
description: Debugs, tests, inspects, and profiles web applications using the Chrome DevTools MCP server. Use for browser-based verification, reproducing frontend bugs, inspecting console errors and network requests, testing interactions, checking responsive layouts, taking screenshots, running Lighthouse audits, and analyzing performance traces. Prefer this skill when the task requires observing the application in a real browser rather than reasoning only from source code.
compatibility: Requires a connected Chrome DevTools MCP server exposing browser navigation, snapshot, console, network, screenshot, Lighthouse, and performance tools.
---

# Chrome DevTools

Use the `chrome-devtools` MCP tools to inspect and verify web applications in
a real Chrome browser.

Do not claim that a frontend fix works solely because the code looks correct.
When the application can be run locally, verify the relevant behavior in Chrome.

## Preconditions

Before browser work:

1. Confirm that the Chrome DevTools MCP server is available.
2. Confirm that the application is running.
3. Determine the correct application URL.
4. Reuse an existing relevant browser page when possible.
5. Never navigate away from a page containing unrelated or sensitive user data.

If you cannot connect to the MCP server, open flatpak chrome with remote debugging enabled and then connect to MCP

```
nohup setsid flatpak run com.google.Chrome \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port=9222 \
  --user-data-dir="$HOME/.var/app/com.google.Chrome/cache/vscode-debug"
```

If the MCP server is unavailable, report that clearly. Do not simulate browser
results or invent console, network, accessibility, Lighthouse, or performance
findings.

## Default workflow

For most browser tasks:

1. Call `list_pages`.
2. Reuse and select the relevant page with `select_page`, or create one with
   `new_page`.
3. Navigate using `navigate_page`.
4. Wait for identifiable application content using `wait_for`.
5. Call `take_snapshot` to obtain the current page structure and element UIDs.
6. Perform the required interactions.
7. Take a fresh snapshot after navigation, modal changes, rerenders, or other
   substantial DOM changes.
8. Inspect console messages and failed network requests.
9. Use a screenshot when visual verification is relevant.
10. Report observed evidence, remaining problems, and any unverified assumptions.

Follow this dependency order even when independent MCP calls may otherwise be
executed concurrently:

`navigate -> wait -> snapshot -> interact -> inspect -> verify`

## Choosing inspection tools

Use `take_snapshot` for:

- Finding interactive elements
- Reading accessible names and semantic page structure
- Selecting elements for clicking, typing, or form filling
- Efficient non-visual verification

Use `take_screenshot` for:

- Layout and styling problems
- Responsive design checks
- Overflow, clipping, alignment, and spacing
- Rendering artifacts
- Visual confirmation requested by the user

Use `evaluate_script` only when the required information cannot be obtained
reliably from snapshots, console messages, or network tools.

Do not use arbitrary JavaScript evaluation as the first choice for normal page
interaction.

## Element interaction

Element UIDs belong to the snapshot that produced them.

After any operation that may rerender the page, such as:

- Navigation
- Form submission
- Opening or closing a modal
- Changing routes
- Expanding dynamic content
- Loading asynchronous results

take a new snapshot before reusing element UIDs.

Prefer semantic element interactions over coordinate-based clicking.
Use `click_at` only when the target cannot be represented by a normal snapshot
element, such as a canvas or custom graphical surface.

## Frontend debugging workflow

When investigating a broken page or interaction:

1. Reproduce the problem.
2. Inspect `list_console_messages`.
3. Retrieve relevant details using `get_console_message`.
4. Inspect `list_network_requests`, prioritizing:
   - Failed requests
   - HTTP 4xx and 5xx responses
   - CORS failures
   - Unexpected redirects
   - Requests that remain pending
   - Incorrect request payloads or response content
5. Retrieve specific requests with `get_network_request`.
6. Inspect the page state with `take_snapshot`.
7. Take a screenshot when the problem is visual.
8. Relate browser evidence to the responsible source code.
9. Apply the smallest reasonable fix.
10. Reload and reproduce the original workflow again.
11. Confirm that the relevant console or network error is gone.

Do not fix unrelated console warnings unless they materially affect the task.

## UI implementation verification

After implementing or changing frontend code, verify at minimum:

- The target page loads.
- The modified component is visible.
- The requested interaction works.
- No new relevant console errors appear.
- No relevant network request fails.
- Loading, empty, error, and success states work when applicable.

When responsive behavior matters, test representative viewport sizes:

- Mobile: approximately 390 × 844
- Tablet: approximately 768 × 1024
- Desktop: approximately 1440 × 900

Use `resize_page` for viewport testing.

Do not declare a UI pixel-perfect unless it has been visually inspected.

## Performance profiling

Use a performance trace only for actual performance investigations. Do not run
one automatically for every frontend task.

Workflow:

1. Navigate to the page under investigation.
2. Ensure the page is ready for a clean measurement.
3. Start `performance_start_trace` with reload enabled when measuring page load.
4. Let the trace complete automatically when possible.
5. Review the returned insight sets.
6. Use `performance_analyze_insight` for the relevant findings.
7. Correlate findings with source code before recommending changes.

Prioritize measurable issues such as:

- Largest Contentful Paint
- Interaction to Next Paint
- Cumulative Layout Shift
- Long main-thread tasks
- Render-blocking resources
- Excessive JavaScript execution
- Large or poorly timed network requests
- Forced layout and style recalculation

Do not infer production performance from one local trace without stating the
limitations of the environment.

## Lighthouse

Use `lighthouse_audit` when the user requests an audit or when accessibility,
performance, SEO, or best-practice scoring is directly relevant.

Treat Lighthouse as diagnostic evidence, not an absolute quality score.
Separate actionable application issues from development-environment noise.

## Authentication and sensitive data

Chrome DevTools MCP can inspect and control browser pages.

Never:

- Expose cookies, authentication tokens, passwords, API keys, or personal data
  in the response.
- Navigate through unrelated authenticated tabs.
- Submit destructive actions without explicit user authorization.
- Make purchases, publish content, delete data, or change production state
  unless the user explicitly requested that exact operation.

Prefer a dedicated development profile or isolated browser session.

## Reporting

Report concrete browser evidence:

- URL and workflow tested
- Viewport when visually relevant
- Console errors observed
- Failed or suspicious network requests
- Relevant screenshots or snapshots
- Performance findings and their source
- What was successfully verified
- What remains unverified

Do not say merely “tested successfully.” State what behavior was exercised and
what evidence confirmed it.
