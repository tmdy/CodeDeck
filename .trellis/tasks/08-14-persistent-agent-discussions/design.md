# Technical Design

## Boundaries

The change has two independent surfaces that share existing persistence and launch infrastructure:

1. Renderer/Profile persistence: saved-argument chip selection writes the selected Profile's runtime `extra_args` immediately through the existing runtime settings IPC.
2. Electron agent bridge: the bridge gains per-run launch overrides and a server-owned parent/child binding used for automatic answer delivery.

No new workflow engine or general terminal-control API is introduced.

## Immediate Argument Persistence

`ProfileEditForm` continues to produce the next `extra_args` string. `App` owns persistence because it already owns the selected Profile key, editor baseline, optimistic state, error reporting, and `updateProfileRuntimeSettings` bridge.

Add a dedicated callback for saved-argument selection rather than making every keystroke in the free-form `extra_args` input persist. The callback:

1. computes the next argument string using the existing token-safe toggle helper;
2. updates the draft optimistically;
3. persists `{ extra_args: nextValue }` for the selected existing Profile;
4. refreshes the baseline/stored state on success, or reloads stored state and reports an error on failure.

This keeps ordinary manual editing save-gated and limits immediate persistence to the interaction requested by the user.

## Run Overrides

Extend the `run` request with optional `model` and `reasoning_effort` fields. Protocol parsing validates non-empty length-bounded model text and provider-specific reasoning effort after resolving the target Profile.

`AgentTaskLaunchOptions` carries an immutable override object into `launchAgentTask`. The launch path clones the saved Profile/runtime, applies model/reasoning values only to the in-memory launch input, and reuses `LaunchService` command builders. Stored Profile data is never updated.

The CLI adds `--model` and `--reasoning-effort`. Profile discovery continues to show the inherited model; help text explains that run flags override it for one task.

## Parent Identification And Capability

A normal monitored session launched by CodeDeck receives its own terminal session identity in process environment. When `codedeck-agent run` is invoked from A, the client includes this identity as parent context. The Electron main process verifies that it names a currently running managed terminal; caller-supplied unverified terminal IDs are not accepted as authority.

For B, Electron creates a random scoped callback token associated with:

- child agent task ID;
- parent terminal session ID;
- allowed operation: report the completed child answer to that parent only;
- lifecycle/expiry tied to the child task.
- the mutable return policy for that one binding.

B does not receive the global bridge token. The existing `CODEDECK_DELEGATED` recursion guard remains, but the client recognizes the scoped callback context and permits only reading/changing its own return policy and interrupting its bound parent's current turn. The server still owns answer delivery.

The return policy is a three-state value:

- `once`: deliver the next completed child turn and atomically switch to `manual` after successful delivery;
- `continuous`: deliver every subsequently completed child turn;
- `manual`: retain results for normal status/wait access without automatic parent injection.

A chooses the policy on `run` and may update it on `continue`. B may update the same binding through its scoped command. Policy mutation is serialized with completion/delivery updates so a turn is neither duplicated nor delivered under a stale policy.

When verified parent context is present and no policy is supplied, `run` defaults to `once`. Without parent context it defaults to `manual`, preserving existing bridge behavior.

## Asynchronous Discussion Flow

```text
A (monitored, working) -> bridge run B with parent context and wait_ms=0
bridge -> launch B and bind child task to A
bridge -> return B task ID immediately
A -> ends current reply and becomes idle
B -> completes first turn
AgentTaskManager -> reads B final assistant text
delivery coordinator -> waits until A is idle
delivery coordinator -> paste wrapped B answer into A, then send Enter
A -> starts a new turn and evaluates B's opinion
```

The bridge server, not B, performs the final terminal injection. This prevents B from choosing a target or writing arbitrary keystrokes.

## Scoped Interrupt

Add an interrupt operation distinct from task cancellation and terminal close. The server resolves the target from the verified parent/child binding and writes a single ESC byte (`\x1b`) to the running peer PTY. A may interrupt its own child task through the normal authenticated bridge; B may interrupt only its bound parent through its scoped capability. Callers cannot supply an arbitrary terminal ID.

After an interrupt, the terminal session and binding remain alive. Activity/status transitions are observed normally, and a later `continue` or injected reply can start another turn. Interrupting an already idle, exited, or closed peer returns an explicit status/error without redirecting the operation.

## Delivery State

Extend the child task record/response with bounded delivery metadata such as `parent_session_id`, `return_policy`, `delivery_status` (`not_requested`, `pending`, `delivered`, `failed`), and a non-sensitive delivery error. The answer remains available through normal `status` even if delivery fails.

Delivery is triggered after `completeTurn` has obtained the final assistant text and the binding policy requests automatic return. If the parent is still busy, the result remains pending and is flushed on the parent's next `turn_completed`/idle transition. Parent exit/close changes delivery to failed. Duplicate completion events are idempotent through turn number plus delivery state. A successful `once` delivery atomically changes the policy to `manual`.

The injected prompt uses a stable delimiter identifying the child Profile/task and asks A to review the opinion. Input uses the same bracketed-paste plus delayed Enter mechanism already used for delegated prompts.

## Visible-Terminal Lifecycle

`show_terminal` controls only whether B's monitored window is opened. Task ownership stays in `AgentTaskManager`, independent of the requesting socket and A's turn. Existing explicit window-close behavior remains unchanged and is documented in the response/help text.

## Compatibility And Migration

- Protocol additions are optional, so protocol version 1 clients remain valid.
- Missing task delivery fields normalize to the current behavior.
- Existing saved argument data needs no migration.
- No task persistence across CodeDeck restarts is added.

## Risks And Rollback

- Terminal activity detection can be imperfect. Delivery must require a running parent plus an idle/turn-completed signal and must never fall back to blind immediate injection.
- Long child answers must respect a bounded injected prompt size; oversized content should be truncated with an explicit marker while the full answer remains queryable in task status.
- Per-run overlays must be applied on cloned objects to avoid accidental Profile mutation.
- The bridge additions can be rolled back independently from immediate argument persistence because their contracts do not share storage.
