# Saved optional CLI arguments

## Goal

Allow users to keep reusable CLI argument snippets below the existing extra-arguments input and toggle each snippet in the current Profile by clicking its parameter box. Keep normal Codex launches free of Bridge-only hook overrides, and optionally keep CodeDeck running in the system tray so the local Agent Bridge remains available after the main window is closed.

## Background and Constraints

- The current manual field is `RuntimeSettings.extra_args` in `src/components/profiles/ProfileEditForm.tsx` and `src/shared/profile/types.ts`.
- Runtime settings are stored per profile in `LocalState.runtime_by_profile` through `ProfileService.updateProfileRuntimeSettings` / `saveProfile`.
- Launch preview and execution share `LaunchService.getCombinedExtraArgs`, which currently combines launch-mode template arguments with `runtime.extra_args`.
- Existing profiles without the new data must continue to load with no enabled saved snippets and no migration error.

## Requirements

1. Keep the current free-form extra-arguments input, including direct editing and persistence.
2. Add a saved-argument list in the same runtime settings area. Each item is represented by one clickable parameter box and one delete control; do not render a separate checkbox or edit button.
3. Provide controls to add a new item and delete an existing item. Empty items must not contribute to a command.
4. Preserve list order; clicking a saved item toggles that item in the current Profile's manual input, where it is concatenated with other manual text and launch-mode template arguments.
5. Persist saved items globally by provider: one list for Codex and one list for Claude, shared by all profiles of that provider.
6. The preview command and actual launch command must use the same composed argument string.
7. Clicking a saved parameter box toggles that argument in the current Profile. Editing a saved item is intentionally handled by deleting and re-adding it.
8. Switching a channel only changes the current Profile draft; it is persisted only when the Profile is saved.
9. Normal Codex preview and launch commands must not append `--disable hooks`. Agent Bridge/port-triggered Codex launches must append it after user arguments so Bridge isolation remains authoritative.
10. Add a global setting, enabled by default, that changes closing the main window into hiding it in the system tray. The tray must provide actions to reopen CodeDeck and explicitly quit it.
11. Toggling the tray setting must take effect without restarting the app, and legacy state without the setting must default to keeping CodeDeck available in the tray.

## Acceptance Criteria

- [ ] Existing manual extra-arguments input still accepts, displays, and saves arbitrary CLI text.
- [ ] User can add and delete saved argument items; each row contains only the clickable parameter box and delete control.
- [ ] Clicking a saved item adds it to the current Profile's extra-arguments text; clicking it again removes it, while hand-written text is preserved.
- [ ] Saved items survive app reload and switching between profiles; Codex and Claude lists remain independent.
- [ ] Existing launch-mode template arguments and manual extra arguments remain included with stable ordering.
- [ ] Profiles created before this feature continue to work without migration errors.
- [ ] Channel switching does not immediately persist; saving the Profile persists the selected channel.
- [ ] Focused unit/component tests cover normalization/defaults, saved-item interactions, and composed launch arguments.
- [ ] Ordinary Codex previews omit `--disable hooks`, while Agent Bridge Codex launches include it.
- [ ] The global tray option defaults on, persists across reloads, hides the main window when enabled, and still permits explicit application exit.

## Open Questions

None.
