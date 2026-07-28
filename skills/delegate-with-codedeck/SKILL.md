---
name: delegate-with-codedeck
description: Delegate a coding or research task to a Codex or Claude Code CLI managed by a local CodeDeck Profile. Use when the user asks to consult, invoke, compare, or hand work to a third-party Codex/Claude profile through CodeDeck, or asks to continue or inspect an existing CodeDeck delegated session.
---

# Delegate With CodeDeck

Use `scripts/invoke-codedeck.ps1` for every operation. Do not reconstruct the
pipe protocol or read CodeDeck configuration files directly.

## Workflow

1. Stop if `CODEDECK_DELEGATED=1`; delegated agents must not delegate again.
2. Run `profiles` when the user did not provide an exact Profile key. Present
   only the returned safe summaries and select a Profile based on the user's
   request.
3. Run the task with the selected Profile. Pass the prompt through `-Prompt`;
   use `-Cwd` only when the task needs a specific existing project directory.
4. Interpret the returned `status`:
   - `completed`: use `assistant_text` as the delegated answer.
   - `starting` or `running`: retain `session_id` and call `wait`.
   - `awaiting_input`: surface `question`; never guess or auto-approve a
     permission request. Use `continue` only with an explicit answer.
   - `failed`: report the structured error and relevant `terminal_tail`.
5. Retain `session_id` for follow-up requests in the same conversation.

## Commands

```powershell
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command profiles
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command run -Profile "codex::name" -Cwd "C:\repo" -Prompt $task
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command wait -Session $sessionId
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command continue -Session $sessionId -Prompt $answer
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command status -Session $sessionId
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command cancel -Session $sessionId
```

Add `-ShowTerminal` to `run` only when the user requests visibility or manual
takeover. The default wait is ten minutes; use `-WaitMs` when the host tool has
a shorter deadline.

Read [references/protocol.md](references/protocol.md) only when handling errors
or integrating a new host.
