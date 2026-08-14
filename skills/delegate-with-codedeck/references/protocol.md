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

The normal `interrupt` command sends ESC to the caller's bound child. A delegated
child may use only scoped `policy` and `interrupt_parent`; it cannot supply a
terminal ID, list Profiles, start another child, or control unrelated sessions.

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
