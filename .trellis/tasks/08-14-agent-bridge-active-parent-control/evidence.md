# Agent Bridge 主动父会话控制验收证据

## Runtime

- Package: `D:/CodeDeck/release-e2e-active-parent-5/win-unpacked/CodeDeck.exe`
- CLI: `D:/CodeDeck/release-e2e-active-parent-5/win-unpacked/codedeck-agent.cmd`
- Profile: `codex::星辰·AI`
- One-run overrides: `gpt-5.6-terra`, `low`, `manual`
- Codex launch: `--disable hooks`
- A session: `b85b76c1-b128-48cf-b545-444d027a4be0`
- B session: `3a562e01-bd87-4fc1-889f-cc3eddd72e8b`
- Final A status: `completed`
- Final B status: `completed`

## Debate Flow

1. A read the repository Skill and returned `SKILL_VISIBLE: D:/CodeDeck/.codex/skills/codedeck-agent-bridge/SKILL.md`.
2. A created exactly one manual B and retained the same B session for the complete debate.
3. B used `status-parent` and `continue-parent` for each of six stages: opening, cross-examination, rebuttal, free debate one, free debate two, and closing.
4. After each B-controlled parent continuation, A answered the current argument and used global `continue` on the same authorized B session.
5. B's final closing used `continue-parent`; A returned a substantive opposing closing and the exact completion markers:

```text
DEBATE_COMPLETE
B_SESSION_ID: 3a562e01-bd87-4fc1-889f-cc3eddd72e8b
ROUNDS_COMPLETED: 6
CONTROL_MODE: B_CONTINUE_PARENT
```

## Findings Fixed During E2E

- A queued `continue` input no longer marks a turn busy before terminal evidence. This prevents a transient idle placeholder from completing the task before the delayed Enter is sent.
- A directory-trust response's `submitted_input` event is not reused as model-turn busy evidence; completion waits for the resumed model turn.
- Packaged terminals now receive a wrapper path for the currently running CodeDeck package through `CODEDECK_AGENT_CLI`, overriding stale inherited values.
- A narrowly scoped recovery accepts exact response `1` for an unobserved first Codex trust screen only when the live PTY is idle and the task has no provider session, terminal output, or busy evidence.

## Verification

- `npm run build`: passed after the lifecycle fix and again after packaged CLI injection.
- Windows dir package: generated successfully at `release-e2e-active-parent-5`; native rebuild was skipped only for the final repack because the same Electron ABI artifact had already rebuilt successfully and the running E2E app held `node-pty` open.
- Vitest: intentionally not rerun in this E2E pass per user instruction. A prior full quality pass before the final E2E fixes reported 93 files / 910 tests passing.
- Post-completion audit: both saved session IDs still return `completed` through the packaged Bridge, including `assistant_text` and diagnostic `terminal_tail`, while the CodeDeck process remains running.
- Profile persistence audit: the saved `codex::星辰·AI` model remains `gpt-5.6-sol`; the A/B terminal footer and process state show the one-run `gpt-5.6-terra low` override.
- Launch audit: live A and B process command lines both contain `--disable hooks`.
