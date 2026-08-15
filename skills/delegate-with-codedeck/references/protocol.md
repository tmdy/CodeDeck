# CodeDeck Delegation Protocol

The wrapper emits one JSON object. A successful `profiles` response contains
`profiles` and `capacity`. Profile summaries never contain credentials.

Task responses contain:

- `status`: `starting`, `running`, `awaiting_input`, `completed`, `failed`, or
  `cancelled`.
- `session_id`: opaque CodeDeck session identifier used by follow-up commands.
- `assistant_text`: clean final assistant text when completed.
- `question`: pending confirmation or clarification when awaiting input.
- `terminal_tail`: ANSI-cleaned diagnostic tail, not the authoritative answer.
- `error`: `{code, message, retryable}` or null.
- `parent_session_id`: the bound parent terminal or null.
- `return_policy`: `once`, `continuous`, or `manual`.
- `delivery_status`: `not_requested`, `pending`, `delivered`, or `failed`.
- `delivery_error`: a non-sensitive automatic-return failure or null.

`run` accepts optional run-only `model` and `reasoning_effort` values. A verified
monitored parent may select a return policy; omitted parent-bound policy defaults
to `once`, while callers without parent context remain `manual`.

Root callers may set `orchestrator: true` to create a tracked monitored parent
session. That session may launch one live bound child. The child remains delegated
and cannot create another session, so the supported depth is exactly A -> B.
An orchestrator request with parent context and an ordinary tracked task used as
a parent return `invalid_parent`. A second child requested while the first is
running or launching returns retryable `child_already_bound`.

The normal `interrupt` command sends ESC to the caller's bound child. A delegated
child may use only scoped `policy`, `status_parent`, `continue_parent`, and
`interrupt_parent`. The server resolves the exact parent from the scoped token;
the child cannot supply a terminal ID, list Profiles, start another child, or
control unrelated sessions.

Use `manual` for active A/B coordination. The child calls `status-parent`, then
passes its message through stdin to `continue-parent` when the bound parent is
idle. `continuous` remains a compatibility mode that injects completed child
answers automatically; do not combine it with active parent continuation or the
same answer may be submitted twice.

Important errors:

- `app_unavailable`: Start CodeDeck.
- `profiles_locked`: Unlock CodeDeck in its UI.
- `bridge_disabled`: Enable the local AI delegation interface in settings.
- `profile_blocked`: Remove the Profile from the interface blacklist.
- `invalid_cwd`: Supply an existing directory or configure one in the Profile.
- `capacity_exceeded`: Wait for or cancel another active task.
- `session_busy`: Wait for the current turn before continuing.
- `session_idle`: The bound target has no active turn to interrupt.
- `session_not_running`: The target terminal has exited or closed.
- `recursive_delegation`: Do not invoke this skill from a delegated process.
