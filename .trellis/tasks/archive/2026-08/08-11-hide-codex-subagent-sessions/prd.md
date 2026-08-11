# 隐藏 Codex 子代理会话

## Goal

Keep Codex-generated sub-agent threads out of user-facing session lists by default, so the Sessions page and the Profile resume-session picker remain focused on conversations the user can intentionally resume. Users who need diagnostic access can turn the filter off without losing any session data.

## Background and Constraints

- Codex stores normal and sub-agent JSONL files under the same recursively scanned `sessions/` tree. A sub-agent is explicitly identified by the presence of `session_meta.payload.source.subagent`; observed values include strings and objects.
- Claude stores sub-agents below `<main-session-id>/subagents/`, while the existing Claude collector reads only project-level JSONL files and direct legacy `sessions/` files. Claude sub-agents therefore do not enter the current session catalog.
- Both the Sessions page and the Profile resume-session picker eventually use the same `session:list` IPC flow, but maintain separate renderer request caches.
- Existing installations do not have the new setting. Missing or invalid persisted values must normalize to the product default.
- The feature must not delete, move, rewrite, or prevent the main Codex conversation from managing sub-agent JSONL files.

## Requirements

1. Add a global setting labeled `隐藏 Codex 子代理会话` and enable it by default.
2. Persist the setting through the existing global-settings save path. Explicitly disabling it must survive application restart; legacy state without the field must load as enabled.
3. When enabled and the selected provider is Codex, exclude sessions whose Codex metadata contains `session_meta.payload.source.subagent` from both the Sessions page and the Profile resume-session picker.
4. When disabled, return those Codex sub-agent sessions to both lists without requiring the user to delete caches or rescan session files manually.
5. Apply filtering before pagination and cursor/`has_more` calculation so hidden entries do not reduce visible page size or corrupt navigation.
6. Claude session behavior and UI results must remain unchanged; the setting is Codex-specific.
7. Classification must use the explicit Codex `source.subagent` marker. Do not infer sub-agent status from `parent_thread_id`, session ID shape, directory name, or preview text.
8. Request identity and all session-list caches must distinguish hidden and visible modes so a setting change cannot reuse stale results.

## Acceptance Criteria

- [ ] A fresh install and a legacy state file without the field show `隐藏 Codex 子代理会话` checked.
- [ ] Saving the checkbox as unchecked and reloading the app keeps it unchecked; checking it again also persists.
- [ ] With the setting enabled, Codex sessions carrying string or object forms of `source.subagent` are absent from the Sessions page and Profile resume-session picker, while ordinary Codex sessions remain visible.
- [ ] With the setting disabled, the same Codex sub-agent sessions are visible again in both entry points without a destructive cache reset or file rescan initiated by the user.
- [ ] A page containing hidden entries still returns the requested number of eligible visible entries when enough exist, and its cursor and `has_more` values describe only the eligible result set.
- [ ] Claude session results are identical regardless of the setting value.
- [ ] No Codex or Claude session file is deleted, moved, or modified by toggling the setting or listing sessions.
- [ ] Focused tests cover setting defaults/migration/persistence, UI interaction, Codex metadata classification, catalog filtering and pagination, cache-key separation, and both renderer request paths.
- [ ] `npm test` and `npm run typecheck` pass.

## Out of Scope

- Hiding or configuring Claude sub-agent sessions.
- Deleting, archiving, moving, or otherwise cleaning up sub-agent session files.
- Changing Codex sub-agent creation, execution, lifecycle, or main-thread orchestration.
- Adding per-profile or per-workspace overrides; the control remains a single global Codex setting.
- Reclassifying forks, side chats, or other related threads that lack the explicit `source.subagent` marker.
