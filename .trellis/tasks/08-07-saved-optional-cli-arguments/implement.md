# Implementation Plan

1. Remove the obsolete saved-argument `enabled` state while keeping legacy normalization compatible.
2. Simplify `ProfileEditForm` saved-argument rows to a clickable parameter box and delete control while retaining add and manual-input flows.
3. Make Codex hook disabling opt-in in the command builder and carry the flag through `LaunchRequest`; enable it only from Agent Bridge launches.
4. Add the normalized `close_to_tray` global setting, render its control in global settings, and synchronize Electron tray/window lifecycle behavior.
5. Add focused tests for normalization, normal versus Bridge launch arguments, component interactions, and tray lifecycle wiring; adjust fixtures/types only where required.
6. Run focused tests, `npm test`, and `npm run typecheck`; inspect the diff for unrelated changes and complete the Trellis quality gate.

## Risk points

- Preserve unrelated working-tree edits in shared profile/type files.
- Ensure provider-specific updates merge existing CLI settings instead of dropping fields.
- Keep command ordering stable: launch-mode template, enabled saved snippets, then manual input.
- Preserve unrelated in-progress Agent Bridge edits already present in `electron/main.ts` and related tests.
- Explicit quit must bypass the main-window hide-to-tray handler, and disabling the setting must destroy the tray immediately.
