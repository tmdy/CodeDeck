# Current Architecture Evidence

## Saved Arguments And Immediate Persistence

- `src/components/profiles/ProfileEditForm.tsx:804` renders the free-form `extra_args` input and the provider-shared saved-argument list. Saved chips currently call the same draft-only `onRuntimeChange` path.
- `src/App.tsx:3565` stores the saved-argument library immediately through `handleParameterSettingsChange`.
- `src/App.tsx:1630` and `src/profile-editor-state.ts:257` establish existing patterns for immediately persisting isolated working-directory, model, and reasoning changes without saving unrelated drafts.
- `src/shared/services/launch-service.ts:130` composes the launch-mode template with `runtime.extra_args`, so persisting the runtime field keeps preview and execution aligned.

## Agent Bridge Protocol And Lifecycle

- `src/shared/agent-bridge/types.ts:22` defines additive request/response unions for `profiles`, `run`, `continue`, `status`, `wait`, and `cancel`.
- `src/shared/agent-bridge/protocol.ts:50` performs explicit runtime validation without a schema dependency.
- `src/shared/agent-bridge/server.ts:39` exposes an authenticated one-request-per-socket named-pipe server. The connection file contains a global token and is written with restrictive mode where supported.
- `electron/agent-cli.ts:68` maps CLI arguments to protocol requests. At line 151 it rejects all bridge use whenever `CODEDECK_DELEGATED=1`.
- `src/shared/agent-bridge/task-manager.ts:102` owns task state in memory. A completed client request does not remove the task or close its terminal. `shutdown` closes running tasks.
- `electron/main.ts:1546` launches delegated work as monitored terminal sessions and sets `CODEDECK_DELEGATED=1`.
- `electron/main.ts:1625` routes authenticated bridge requests to the task manager and preserves enablement/blacklist/capacity checks.

## Terminal Input And Activity

- `src/shared/electron/terminal-session-manager.ts:221` sends input to a specific running terminal, records activity, and writes to its PTY.
- `src/shared/agent-bridge/task-manager.ts:404` already normalizes pasted input and submits Enter separately, which should be reused for automatic return.
- `src/shared/agent-bridge/task-manager.ts:273` consumes terminal turn-start/turn-complete activity events.
- `src/shared/agent-bridge/task-manager.ts:303` reads the last assistant text after turn completion and makes it available in task status.
- `electron/main.ts:1585` makes visible child lifetime explicit: a shown monitored window uses the normal window-close handler, while a hidden child remains owned by the terminal/task managers.

## Model And Reasoning Support

- `src/shared/profile/types.ts:34` defines different Claude and Codex reasoning-effort sets and normalization helpers.
- `src/shared/services/launch-service.ts:330` and `:415` already translate stored provider-specific reasoning choices into launch artifacts.
- Per-run bridge values must therefore use the same normalization/building paths on cloned launch inputs, never update the stored Profile, and validate after the target Profile/provider is known.

## Design Constraints Derived From Evidence

- Do not expose `TerminalSessionManager.sendInput(sessionId, data)` as a general bridge command. Bind delivery server-side to the verified creating terminal.
- Do not give delegated B the connection-file global token. Give it only a child-specific capability for its own return policy.
- Avoid synchronous A-waits-for-B behavior. A must use an asynchronous run (`wait_ms=0`), finish its turn, and receive B's result only when its terminal is idle.
- Keep task persistence across application restarts out of scope; current in-memory ownership already satisfies independence from the initiating socket/turn.
- Preserve the explicit close-window-means-close-terminal behavior; `show_terminal` is visibility, not detached-window lifetime.
