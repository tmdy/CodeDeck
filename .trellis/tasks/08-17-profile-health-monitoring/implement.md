# Implementation Plan

1. Add the shared health domain.
   - Replace the direct HTTP transport with bounded Chinese journey-prompt construction, target/rolling state, continuity parsing/validation, clone, and presentation helpers.
   - Add focused tests for the first full prompt, subsequent literal `继续`, valid continuity, malformed markers, carry-word failures, and session-state normalization.

2. Add local-state persistence.
   - Extend `LocalState`, bootstrap projection, store load/save, and cloning with `profile_health_by_target`.
   - Add compatibility and round-trip tests.
   - Clear stale target state when Profile identity, channel/model, or credential data changes or a Profile is deleted.

3. Replace Electron active-health orchestration with hidden monitored CLI sessions.
   - Remove active health calls through Chromium fetch and all Provider POST request construction.
   - Reuse normal launch-plan construction, hidden monitored PTY launch, Provider session resolution, lifecycle completion, and session JSONL assistant extraction.
   - Persist only the previous assistant reply and continuity checkpoint; later turns start a fresh hidden CLI with fixed rules plus that reply and literal `继续`, then close the PTY after each result.
   - For Codex, create `<runtime cwd>/.codedeck/profile-health/codex-home`, write the generated standalone Profile config there, override the launch plan `CODEX_HOME`, and resolve lifecycle JSONL from that same home without changing ordinary session storage.
   - Require the current editor target to match a saved Profile before launch and deduplicate in-flight work by target.
   - Add integration tests proving `showWindow: false`, bounded fresh-session prompts, literal subsequent input, timeout/process cleanup, and no direct model `fetch` path.

4. Add monitored-terminal passive updates.
   - Bind monitored terminal session IDs to the launch-time Profile health target.
   - On authoritative `turn_completed`, update passive health and notify renderers.
   - Remove mappings on process exit/session close and test channel/model changes cannot redirect the result.

5. Refactor channel editing and add health UI.
   - Replace the permanent channel-name input with transient add/rename editing.
   - Add the right-side manual channel test action and health detail presentation using the current draft model.
   - Add a distinct Profile-list health indicator while preserving the balance badge.
   - Wire App state, preload API typings, bootstrap hydration, stale-response protection, and saved/clean-target gating.

6. Verify the full slice.
   - Run focused Vitest suites while iterating.
   - Run `npm test`.
   - Run `npm run typecheck`.
   - Review the final diff against the PRD, confirm unrelated dirty-worktree files were not modified, and perform a renderer smoke check if the local app can be launched without disturbing existing user sessions.

## Risk And Rollback Points

- Health turns can create billable traffic: tests mock monitored CLI/session events, and live probes run only from explicit user action.
- Hidden PTYs must always be closed on success, validation failure, timeout, and process failure.
- Target/state cleanup must not remove unrelated balance/check-in data.
- `electron/main.ts` already has unrelated user changes; implementation must patch narrowly and preserve them.
- UI refactoring must retain channel rename capability and existing add/delete/select behavior.
