# Sidebar tab-to-divider styling

## Summary
Restyle workspace tab rows so they meet the sidebar’s right edge. The active tab will visually merge into the divider with concave quarter-circle flares above and below, while the divider is split around it and grows outward from the active tab whenever selection changes. Apply the treatment on desktop and in the mobile drawer.

## Implementation
- Update `WorkspaceSidebar.svelte` only; this is custom markup/CSS and does not require a Bits UI primitive.
- Remove the workspace-list’s right inset so workspace rows and their hover backgrounds reach the sidebar edge. Keep the existing left indentation, text truncation, close control, spinner layout, and project-heading alignment.
- Introduce a shared active-row background CSS variable and layer the active row above the divider so its right edge fully masks the default border.
- Add top/bottom pseudo-element flares to the active row. Use concave quarter-circle geometry to make the active background widen nonlinearly into the sidebar edge instead of ending with a conventional right-hand radius. Keep the left corners conventionally rounded and the right edge flush/slightly overlapping visually.
- Replace the single `border-right` presentation with an aria-hidden, pointer-events-none divider overlay containing upper and lower segments. Both segments use the theme’s existing border color and leave a gap occupied by the active row and its flares.
- Add an attachment-backed active-row anchor that measures the active row relative to the sidebar and writes CSS custom properties for the divider gap. Recalculate on active-tab changes, sidebar/list resizing, and workspace-list scrolling; clean up observers/listeners when the active row changes or unmounts. This is narrowly scoped DOM geometry work and will not write reactive Svelte state.
- On selection change, animate the upper segment upward and the lower segment downward from the active tab, then leave both static. Keep the motion short and eased, with no continuous animation.
- Under `prefers-reduced-motion: reduce`, render the final split divider and active shape immediately with no growth animation.
- Use the same treatment in the mobile drawer, including correct geometry for its wider responsive sidebar.
- If no workspace tab is active (for example History or Settings), show the normal uninterrupted sidebar divider and no flares.

## Behavior and interfaces
- No public props, routes, data types, or navigation behavior change.
- The effect applies only to open workspace entries; New chat, History, Settings, and project headings retain their current styling.
- Existing theme tokens remain the source of colors: the active row retains its current accent-tinted surface, and the divider uses `var(--border)` rather than introducing a fixed color.

## Tests and verification
- Extend `WorkspaceSidebar.svelte.spec.ts` to render a selectable workspace tab and verify:
  - the active row and active anchor are associated with the current pathname;
  - the split divider is present for an active workspace tab;
  - changing the active pathname moves the active treatment;
  - utility routes fall back to an uninterrupted divider;
  - existing spinner, close-button, and title-truncation behavior remains intact.
- Run the Svelte autofixer on the edited component until it reports no issues or suggestions.
- Run `npm run check`, focused sidebar unit tests, and required `npm run lint`.
- Verify with Playwright CLI at desktop and mobile widths: rows meet the edge, the active row hides the divider, concave flares are clean, line segments animate outward on tab changes, scrolling keeps the gap aligned, and the mobile drawer remains usable.

## Assumptions
- “Tabs” means workspace chat/draft entries, not utility navigation links.
- The red screenshot marks geometry only; it is not the intended production color.
- The requested line motion is a one-shot grow animation after selection changes, not a continuously traveling highlight.
