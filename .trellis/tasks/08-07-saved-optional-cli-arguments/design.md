# Technical Design

## Data model

Keep saved-argument items provider-scoped with stable `id` and `value` fields. Normalization accepts legacy items containing `enabled`, drops that obsolete flag, removes malformed items, and preserves order.

## Data flow

`LocalState.parameter_settings` is normalized on load and persisted by `SettingsStateService.updateParameterSettings`. `App` passes the current provider's saved list and an update callback into `ProfileEditForm`. The form keeps the existing `runtime.extra_args` callback for manual text; clicking a preset toggles its text in the current draft's `extra_args`, while add/delete updates the provider-scoped preset list.

`LaunchService.getCombinedExtraArgs` continues to join launch-mode template args with the normalized profile runtime `extra_args`. Because selected presets are written into that field, preview and execution remain aligned without a second source of active arguments.

`CodexCommandOptions.disableHooks` defaults to false. The shared command builder appends `--disable hooks` only when that option is true. `LaunchRequest.disable_codex_hooks` carries the internal launch intent through `LaunchService`; only `launchAgentTask`, the Agent Bridge launch boundary, sets it.

`GlobalSettings.close_to_tray` owns the persisted preference and defaults to true so the local Agent Bridge remains available after the main window closes. Electron reads it before creating the first window, keeps a small in-memory lifecycle snapshot synchronized after settings updates, and creates or destroys the native `Tray` accordingly. The main-window `close` handler hides only when the preference is enabled and the application is not explicitly quitting. Tray activation restores the existing main window or recreates it; the tray menu exposes explicit open and quit commands.

## Compatibility and trade-offs

- Missing `saved_extra_args` defaults to `[]`; no migration is required.
- IDs are UI/storage identifiers only; deleting and adding items does not alter command semantics beyond list membership/order.
- Legacy `enabled` values are accepted but intentionally ignored because the parameter box itself is the only activation control.
- Saved snippets are provider-global by explicit product decision; manual `extra_args` remains profile-specific.
- Existing CLI settings fields and launch-mode ordering remain unchanged.
- Closing terminal windows keeps their existing session-close behavior; close-to-tray applies only to the main application window.

## Verification

Cover parameter/global-setting normalization and store round-trips, normal versus Bridge Codex launch composition, saved-argument form interactions, and main-process tray wiring with focused tests. Run `npm test` and `npm run typecheck`.
