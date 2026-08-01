---
name: storybook-tests
description: Use when creating, updating, or testing UI component stories with this project's Storybook integration.
---

# Storybook component testing

When working on UI component stories, always use the
`pi-squared-storybook-mcp` MCP tools to access Storybook's component and
documentation knowledge before answering or taking any action.

- **CRITICAL: Never hallucinate component properties!** Before using any
  property on a design-system component (including common-sounding properties
  such as `shadow`), use the MCP tools to verify that the property is
  documented.
- Query `list-all-documentation` to get a list of all components.
- Query `get-documentation` for the relevant component to see its available
  properties and examples.
- Use only properties explicitly documented or shown in example stories.
- If a property is not documented, do not infer it from naming conventions or
  other components; check with the user instead.
- Use `get-storybook-story-instructions` to fetch the latest instructions for
  creating or updating stories.
- Validate work by running `run-story-tests`.

A story name might not match its property name, so always verify properties
through documentation or example stories.
