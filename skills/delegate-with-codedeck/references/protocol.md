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

Important errors:

- `app_unavailable`: Start CodeDeck.
- `profiles_locked`: Unlock CodeDeck in its UI.
- `bridge_disabled`: Enable the local AI delegation interface in settings.
- `profile_blocked`: Remove the Profile from the interface blacklist.
- `invalid_cwd`: Supply an existing directory or configure one in the Profile.
- `capacity_exceeded`: Wait for or cancel another active task.
- `session_busy`: Wait for the current turn before continuing.
- `recursive_delegation`: Do not invoke this skill from a delegated process.
