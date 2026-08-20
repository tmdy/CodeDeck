# Technical Design

## Flow

```text
UI desktop toggle
  -> App.handleLaunch(mode, desktopHandoff=true)
  -> LaunchRequest: selected site Profile, disable_codex_hooks=true
  -> new: app-server thread/start + empty assistant rollout item for persistence
  -> resume selected: existing monitored PTY/session owner + `/app`
  -> stop the temporary app-server/CLI writer
  -> open the exact persisted thread after its writer lock is released
  -> Desktop continues using original session provider through global registry + broker
```

## Boundaries

- UI owns only the independent toggle and launch intent.
- Electron launch layer owns temporary app-server/session lifecycle and cleanup.
- Agent Bridge/task manager remains the owner of PTY input and session binding.
- Provider registry/broker remains unchanged as the secret boundary.
- Desktop is treated as an external process. No lock deletion or takeover is added.

## Handoff Evidence

For a new thread, `thread/start` alone is not durable until a rollout item is written. Inject one empty assistant item, wait for success, then stop app-server and require its writer lock to disappear before opening the exact thread URI. This creates no user turn and performs no model request.

For a selected existing thread, the implementation must not close the writer immediately after sending `/app`. It should wait for a bounded combination of existing evidence:

- CLI emits the expected Desktop handoff/exit signal, or
- the monitored terminal exits after `/app`, and
- the target session is no longer actively writable by CodeDeck.

If current output has no stable handoff marker, add a small terminal activity classification for `/app` handoff rather than treating any idle prompt as success.

## Hook Policy

Use the existing structured `disable_codex_hooks` request field only for the temporary monitor launch. Do not auto-answer hook review prompts with trust-all. Desktop's own hook policy remains user-visible and can block handoff; that state must be surfaced as a failed/awaiting handoff.

## Failure and Cleanup

- Keep the temporary session alive while the handoff is pending.
- On timeout, leave the session inspectable and report that Desktop did not confirm takeover.
- On confirmed handoff, close through the existing terminal/session owner API.
- On active-writer error, show the existing actionable exit-and-retry message.

## Compatibility

- Direct/continue/resume without the toggle retain current behavior.
- Claude never exposes the toggle.
- Shared canonical Codex Home and provider broker contracts remain unchanged.
