# Implementation evidence

Date: 2026-10-10. Based on the existing dirty workspace; unrelated changes were preserved. No commit, push, release, user-history write, global configuration write, or user-session termination was performed.

## Integrated changes

- Monitored Codex native/site launches append `-c tui.terminal_title=["thread-id"]` through the command builder. Direct/Claude launches keep their existing arguments.
- `TerminalIdentityHintParser.processChunk()` reads only complete OSC 0/2 frames (BEL/ST), handles split frames and the verified 29-character UUID prefix/spinner shape, ignores prose/other selectors and bounds incomplete frames.
- `CodexTerminalIdentityResolver.resolve()` verifies `session_meta.payload.id` in the actual Home's sessions tree, deduplicates UUID identity, and separates source-file uniqueness. Multiple sources require post-observation lifecycle growth with a current timestamp/turn ID. Static copied started records do not authorize selection; multiple growing sources remain pending. Bound sources are rechecked for deletion/replacement/new competing files. Directory listings and unrelated immutable metadata are cached.
- Main keeps binding, lifecycle observation and display name independent. Titles use the same UUID's latest valid appended index name; incomplete/bad index lines preserve the previous valid name. Lifecycle lookup keeps retrying without waiting for a name. A PTY hint switch replaces the old watcher and recovery generation. Async dispatch verifies the watcher/terminal remains current. Exit/close removes all binding timers/state.
- `TerminalSessionManager.reportTurnLifecycle(sessionId, phase, error?, {turnId?, timestampMs?})` retains current submission/turn boundaries, ignores old/duplicate events, emits authority once even after prompt fallback, clears old output evidence, and keeps settled turns idle through redraws. `resetProviderSession()` cancels prior recovery and emits `session_changed`, not a fabricated successful completion.
- Codex no longer feeds raw output to keyword-triggered auto-continue. Only a final structured retryable failed event calls `processFailure()`. Current actual CLI error shape is independently verified in `final-failure-runtime.md`; intermediate `stream_error`, `error`, warnings, ordinary prose and aborted turns do not authorize recovery. HTTP 401/403 and other nonretryable status codes reject recovery. Configuration keywords still filter final failure messages.
- Success, new input/started, switching, disable/pause, close/exit cancel queued input/timers. Timer/renderer flush checks the captured generation and current enabled/paused/running state. Cumulative budget persists across successes. Claude's existing keyword controller/automatic-run episode behavior is preserved and tested separately.
- Settings label now says `自动继续累计上限`; saved values, interval settings and input text are unchanged.

## Checks

- Relevant regression batch: 5 files, 158 tests passed (manager, identity, lifecycle, session service, launch service).
- Full `npm test`: 108 files, 1145 tests passed.
- `npm run typecheck`: passed.
- `npm run build:electron`: passed.
- `git diff --check`: passed; existing LF/CRLF warnings only.

The initial focused run exposed obsolete Codex prose-trigger and exact-argv expectations. Those were updated to the new authorization/launch contract; Claude episode behavior was kept rather than weakened. Added regressions cover settled redraws, late completion, fallback authority, split reconnect/prose, delayed and renderer-deferred cancellation, budget, metadata identity, ambiguous prefixes, static copies, source conflict/deletion/replacement, and partial index rename writes.

## Runtime limits

Source tests/compilation do not update the already-running `release/win-unpacked/CodeDeck.exe`. Parent session owns the isolated compiled-manager/ConPTY integration experiment and final independent check. No claim is made that the current installed UI/taskbar has been live verified with this build. The thread-title signal is a version-specific presentation hint; unknown shapes keep identity pending. Conflicting lifecycle sources deliberately stay pending until a unique source can be verified.
