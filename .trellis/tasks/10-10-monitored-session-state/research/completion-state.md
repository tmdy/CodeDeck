# Research: Monitored terminal completion and taskbar activity

- Query: Why can a completed Codex turn leave the Windows taskbar progress indicator moving? How do lifecycle files, activity heuristics, and title binding interact?
- Scope: internal
- Date: 2026-10-10

## Findings

### Confirmed defect: terminal repaint can override authoritative completion

`TerminalSessionManager.reportTurnLifecycle()` only cancels the provisional idle timer and applies idle for completion/failure (`src/shared/electron/terminal-session-manager.ts:301-319`). It does not reset the activity detector or retain a settled structured-turn state. `observeActivity()` applies every `busy_output` unconditionally (`src/shared/electron/terminal-session-manager.ts:357-370`). Every PTY output chunk goes through that detector (`src/shared/electron/terminal-session-manager.ts:192-203`).

The detector stores up to 256,000 characters of raw output, cleared only by nonempty submitted input (`src/shared/electron/terminal-activity.ts:32`, `:104-108`, `:115-116`). The previous-prompt branch considers any Working marker after the second-last prompt busy, even when the latest prompt is an idle placeholder (`src/shared/electron/terminal-activity.ts:144-149`). This was intentionally introduced to avoid completing during an active Working indicator, but there is no structured-completion boundary.

Read-only, synthetic reproduction using the actual source modules, in-memory TypeScript transpilation, and FakePty (no generated files, no real CLI, no user conversation content):

1. Submit `work\r`.
2. Emit `› work\r\nWorking (8s • esc to interrupt)\r\n› Improve documentation in @filename`.
3. Report lifecycle `completed`: snapshot is idle.
4. Emit only `\r\n`: snapshot is busy again.

Observed output:

```json
{"afterCompleted":"idle","afterRepaint":"busy","events":[{"activity":"busy","reason":"submitted_input"},{"activity":"idle","reason":"turn_completed"},{"activity":"busy","reason":"busy_output"}]}
```

This proves an implementation defect compatible with the reported symptom. It does not prove that the screenshot came from this exact sequence; runtime correlation remains necessary.

### Taskbar mapping is downstream and behaves as implemented

Busy maps to `progress: 2`, idle to `progress: -1` (`src/shared/electron/terminal-taskbar.ts:18-25`). The main process maps those to `setProgressBar(2, { mode: "indeterminate" })` and `setProgressBar(-1)` (`electron/main.ts:731-754`). All terminal activity changes call that updater (`electron/main.ts:835-842`). Therefore stale `busy_output` restarts the moving indicator. Merely changing taskbar code would hide the incorrect activity state still consumed by Bridge and health monitoring.

### Confirmed defect: authoritative completion can disappear after idle fallback

`reportTurnLifecycle(completed)` passes `emitWhenUnchanged = false`; only failure uses true (`src/shared/electron/terminal-session-manager.ts:311-318`). `applyActivity()` suppresses same-state events unless explicitly requested or closing/exiting (`:390-402`). If the 250 ms idle fallback has already switched busy to idle, a later structured completion generates no activity callback. Consequently `AgentTaskManager.handleActivityChange`, passive health completion, and completion flashing do not receive that authoritative event (`electron/main.ts:789-835`). This is separate from the stuck-busy defect and should be fixed without duplicate per-turn completion/delivery.

### Lifecycle source is coupled to title resolution

`scheduleTerminalTitleResolution()` starts the JSONL watcher only after title status is resolved, using the session ID supplied by that title result (`electron/main.ts:4315-4345`). It stops title polling before resolving the lifecycle file (`:4325-4327`). If file resolution returns no file, it logs and returns; there is no retry from that resolved path (`:4346-4364`). Ordinary UI launches with no expected preview time out after 60 s (`electron/main.ts:384`, `:4387-4402`); Bridge launches with expectedPreview remain pending per contract.

Implications, to integrate with the title research:

- A wrong provider-session association can give both a wrong title and a wrong lifecycle source.
- A correct identity with a missing/delayed file can give a correct title but no completion monitoring.
- An unresolved or ambiguous title can prevent lifecycle monitoring even if the turn itself is observable.
- Lifecycle association should use confirmed session identity independently of whether a usable display title exists.

### Polling boundaries and old-log hypotheses

Watcher interval is 750 ms; initial scan is the last 1 MiB (`electron/main.ts:385-386`, `:1188-1193`). On its initial scan it excludes missing timestamps and events earlier than launch minus 1 s (`:1215-1219`). It does not replay the whole historical session on every poll: later reads begin at offset. File shrink resets initialization and the initial timestamp filter (`:1182-1186`). Thus broad claims that historical logs are rescanned continuously are unsupported.

Remaining risks visible in code:

- `TerminalTurnLifecycleEvent` omits turn/session identifiers; Codex parser accepts only event_msg/task_started and task_complete (`src/shared/electron/terminal-turn-lifecycle.ts:9-13`, `:71-89`). An old completion arriving after new input cannot currently be correlated to the earlier turn.
- First-read 1 MiB clipping can miss the current turn start, while its completion remains visible. A correct fix must permit settling that turn rather than requiring a start that could not be read.
- Polling awaits stat/open/read; it checks watcher ownership only in `finally` when scheduling the next poll (`electron/main.ts:1246-1252`). A stopped/replaced watcher can dispatch stale events after an await because no ownership check precedes `reportTurnLifecycle` (`:1221`).
- Partial JSONL lines are retained as remainder (`:1200-1208`), which is correct. UTF-8 decoding is per buffer rather than a streaming decoder; a multi-byte split is a lower-priority caveat, not current root-cause evidence.

## Minimal design proposal

1. Keep activity reduction in `TerminalSessionManager`; taskbar remains a pure projection. Track a current turn generation and whether its structured lifecycle has settled. New submitted input/new authoritative start opens a generation; completion/failure settles it. Correlate lifecycle turn identifiers when real schema provides them; use timestamp/input boundaries carefully for current versions without identifiers.
2. Reset or boundary the detector's raw evidence when the current turn settles. Prevent stale TUI `busy_output` from reopening a settled structured turn. Preserve fresh-output busy fallback for unassociated/no-lifecycle terminals and legitimate turns started through CLI/UI mechanisms. Do not globally ignore busy output forever after the first completion.
3. Always deliver one authoritative completion event for the current generation, even if the idle fallback arrived first; deduplicate repeated structured records. Audit Bridge's per-turn busy evidence and completion bookkeeping so this does not produce duplicate result delivery.
4. On successful completion cancel/reset only pending error-recovery state belonging to that turn; `reportTurnLifecycle()` currently cancels neither delayed auto-continue nor controller match history. Coordinate with the auto-continue research before choosing its semantics.
5. Bind lifecycle monitoring to reliable provider session identity. Retry locating a missing file while the terminal remains alive; title rendering must not be the ready gate for monitoring.
6. Recheck watcher ownership after asynchronous I/O and before event dispatch. Extract polling/reduction into testable helpers only where needed for meaningful regression tests; avoid an unrelated main-process refactor.

## Regression scenarios

- `started/busy → completed → stale Working repaint`: remains idle; taskbar stays cleared.
- `failed → stale Working repaint`: remains settled; does not queue a stale automatic continue.
- `idle_prompt → completed`: one authoritative completion callback reaches consumers; no duplicate child delivery.
- `completed → new submitted input → fresh Working/started`: becomes busy normally.
- No associated JSONL: existing 250 ms stable-prompt fallback, active Working protection, and interactive confirmations still behave correctly.
- A delayed old completion after a new submit cannot settle the new turn; repeated same-turn lifecycle records are idempotent.
- Correct provider identity, no usable title yet, or file appears after first lookup: lifecycle monitoring eventually starts for that same identity.
- Stopped/replaced watcher after awaited read: no stale event dispatch; partial final line resolves only after newline.
- Existing taskbar mappings: Windows busy/idle, completion flash only as intended, focus/non-Windows behavior.

## Files found

- `src/shared/electron/terminal-activity.ts`: PTY/input heuristic detector and raw evidence buffer.
- `src/shared/electron/terminal-turn-lifecycle.ts`: Codex/Claude structured event parser.
- `src/shared/electron/terminal-session-manager.ts`: activity state, provisional idle timer, auto-continue dispatch, subscribers.
- `src/shared/electron/terminal-taskbar.ts`: taskbar projection.
- `electron/main.ts`: session title/identity resolution, JSONL watcher, window progress and consumer integration.
- `src/shared/__tests__/electron/terminal-activity.test.ts:92-117`: intentional protection against Working between current input and placeholder; older turn exclusion.
- `src/shared/__tests__/electron/terminal-session-manager.test.ts:104-178`: completion and same-idle failure cases; no completion-after-repaint regression.
- `src/shared/__tests__/electron/terminal-session-manager.test.ts:204-324`: 250 ms fallback and cancellation scenarios.
- `src/shared/__tests__/electron/terminal-turn-lifecycle.test.ts`: parser tests including null/error task_complete.
- `src/shared/__tests__/electron/terminal-taskbar.test.ts`: downstream progress and flash expectations.

## Related specs

`.trellis/spec/frontend/agent-bridge-contract.md:101-111`: exact expected-preview identity, stable idle fallback, authoritative completion, interactive confirmation exclusion. The statement at `:215` still says fallback is only before association or interruption, conflicting with the more recent broader evidence-gated fallback at `:108`; main session should reconcile that drift if editing this contract.

## External references

None required for the confirmed source defect. Electron behavior is evidenced by the existing implementation/tests; installed Codex event version/schema and real terminal runtime are not verified here.

## Dirty-file protection

Parent reports 46 existing dirty entries. Its confirmed relevant dirty subset is `electron/main.ts`, `src/shared/electron/terminal-activity.ts`, `terminal-session-manager.ts`, `terminal-turn-lifecycle.ts`, plus `src/shared/__tests__/electron/terminal-session-manager.test.ts` and `terminal-turn-lifecycle.test.ts`. `terminal-taskbar.ts`, its test, and `terminal-activity.test.ts` were unchanged in that baseline. Preserve those pre-existing changes when composing implementation patches. This researcher did not perform git operations or edit product/spec files. Owned output is only `.trellis/tasks/10-10-monitored-session-state/research/completion-state.md`.

## Caveats / Not Found

- No real window/taskbar inspection or raw user session reading; actual screenshot incident needs structured log evidence: terminal session ID, activity_changed reason, turn_lifecycle phase, title_resolved provider-session ID and source.
- Source reproduction establishes the stale repaint defect, not the frequency or exact triggering PTY bytes in the user's installed build.
- New session title selection and reconnect counting are handled by separate research owners. This document records their coupling to lifecycle only.
- No full application tests/build were run; only synthetic execution of current source. No implementation approval, code changes, or task activation occurred.
