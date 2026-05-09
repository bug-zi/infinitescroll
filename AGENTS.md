# Project Agent Instructions

## Non-Regression Rule

When modifying code or improving features, never break or degrade existing behavior.

Follow this rule as a hard requirement:

- Keep changes scoped to the user's request.
- Do not refactor unrelated code while implementing a feature or bugfix.
- Do not change existing behavior unless the user explicitly asks for that behavior to change.
- Before editing, inspect the relevant code path and identify likely affected areas.
- Preserve existing public interfaces, data shapes, routes, storage schemas, and UI workflows unless a requested change requires updating them.
- If a change could affect an existing feature, choose the more conservative implementation and call out the risk.
- Work with existing user or generated changes in the tree; never revert unrelated changes unless explicitly instructed.

## Verification

After code changes:

- Run the narrowest relevant tests for the touched area.
- Run the project build when TypeScript, API, routing, or UI code changes.
- If the full test suite has existing unrelated failures, report them separately from the result of the current change.
- Do not claim a fix is complete until the changed behavior has been verified.

## Change Hygiene

- Keep commits and diffs focused.
- Avoid introducing new dependencies unless clearly necessary.
- Prefer existing project patterns and helpers.
- Do not store generated images or secrets in the repository.
- Do not expose service-role keys or private API keys to the frontend.
