---
name: delegate-with-codedeck
description: Delegate a coding or research task to a Codex or Claude Code CLI managed by a local CodeDeck Profile. Use when the user asks to consult, invoke, compare, or hand work to a third-party Codex/Claude profile through CodeDeck, or asks to continue or inspect an existing CodeDeck delegated session.
---

# Delegate With CodeDeck

Use `scripts/invoke-codedeck.ps1` for every operation. Do not reconstruct the
pipe protocol or read CodeDeck configuration files directly.

## Workflow

1. If `CODEDECK_DELEGATED=1`, do not start or control unrelated tasks. The only
   permitted commands are `policy` for this child binding, plus `status-parent`,
   `continue-parent`, and `interrupt-parent` for the server-bound parent. These
   commands never accept a target session ID.
2. Run `profiles` when the user did not provide an exact Profile key. Present
   only the returned safe summaries and select a Profile based on the user's
   request.
3. Run the task with the selected Profile. Pass the prompt through `-Prompt`.
   Use `-Orchestrator` only when the root caller needs a tracked parent session
   that may launch one bound delegated child;
   use `-Cwd` only when the task needs a specific existing project directory.
   Use `-Model` and `-ReasoningEffort` for run-only overrides. From a monitored
   parent, use `-WaitMs 0` and select `-ReturnPolicy once|continuous|manual`
   when the parent should finish its turn instead of blocking for the child.
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
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command run -Profile "codex::name" -Model "gpt-5.6" -ReasoningEffort high -ReturnPolicy continuous -WaitMs 0 -Prompt $task
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command run -Profile "codex::name" -Orchestrator -ShowTerminal -WaitMs 0 -Prompt $task
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command wait -Session $sessionId
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command continue -Session $sessionId -Prompt $answer
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command status -Session $sessionId
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command interrupt -Session $sessionId
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command cancel -Session $sessionId
# Only inside the delegated child:
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command policy -ReturnPolicy manual
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command status-parent
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command continue-parent -Prompt $messageForParent
& "<skill-dir>/scripts/invoke-codedeck.ps1" -Command interrupt-parent
```

Add `-ShowTerminal` to `run` only when the user requests visibility or manual
takeover. The default wait is ten minutes; use `-WaitMs` when the host tool has
a shorter deadline. `interrupt`/`interrupt-parent` sends ESC to the peer's
current turn; it does not close the terminal or destroy the binding. For an
active A/B exchange, use `manual`: the child explicitly checks the parent and
calls `continue-parent` instead of relying on automatic completion delivery.

Read [references/protocol.md](references/protocol.md) only when handling errors
or integrating a new host.
