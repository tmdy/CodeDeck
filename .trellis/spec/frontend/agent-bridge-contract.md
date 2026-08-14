# Persistent Agent Bridge Contract

## Scenario: Parent-bound delegated discussion

### 1. Scope / Trigger

- Trigger: any change to `electron/agent-cli.ts`, `electron/main.ts`, `src/shared/agent-bridge/*`, `src/shared/services/launch-service.ts`, or `src/shared/provider/codex/command-builder.ts` that affects delegated launch, Codex project trust, task lifetime, automatic return, or peer interruption.
- The bridge is a local Electron-main-owned capability boundary. It is not a general terminal-control API.
- A root caller may explicitly launch a tracked orchestrator. The orchestrator may launch one live bound child, while an ordinary tracked task cannot become a parent.
- Existing untracked monitored terminals retain parent-bound delegation. Every delegated child is depth-limited and cannot recursively delegate through the supported CLI.

### 2. Signatures

```typescript
type AgentReturnPolicy = "once" | "continuous" | "manual";

type AgentBridgeRequest =
  | {
      command: "run";
      profile_key: string;
      prompt: string;
      model?: string;
      reasoning_effort?: string;
      orchestrator?: boolean;
      parent_session_id?: string;
      parent_token?: string;
      return_policy?: AgentReturnPolicy;
    }
  | {
      command: "continue";
      session_id: string;
      prompt: string;
      return_policy?: AgentReturnPolicy;
      parent_session_id?: string;
      parent_token?: string;
    }
  | {
      command: "interrupt";
      session_id: string;
      parent_session_id?: string;
      parent_token?: string;
    };

type AgentScopedRequest =
  | { command: "policy"; return_policy?: AgentReturnPolicy }
  | { command: "interrupt_parent" };
```

Supported CLI entry points:

```text
codedeck-agent run --profile <key> [--model <id>] [--reasoning-effort <level>]
  [--return-policy once|continuous|manual] [--wait-ms <ms>] [--show-terminal]
  [--orchestrator]
codedeck-agent continue --session <id> [--return-policy once|continuous|manual]
codedeck-agent interrupt --session <id>
codedeck-agent policy [--return-policy once|continuous|manual]
codedeck-agent interrupt-parent
```

Codex launch options own the structured one-run trust input:

```typescript
interface CodexCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  baseUrl: string;
  modelOverride?: string;
  trustedProjectPath?: string;
}
```

### 3. Contracts

- Electron generates `CODEDECK_TERMINAL_SESSION_ID` and `CODEDECK_TERMINAL_PARENT_TOKEN` for every monitored terminal. A parent binding is accepted only when both values match a running managed terminal.
- `orchestrator: true` is valid only for an unbound root `run`. The orchestrator remains owned by `AgentTaskManager`, receives the terminal parent identity, and does not receive `CODEDECK_DELEGATED=1`.
- An ordinary tracked task cannot become a parent. A tracked parent is accepted only when its task record is an explicit orchestrator; nested orchestrators are rejected.
- An orchestrator may have only one bound child whose terminal is running. The manager reserves that parent during child launch so concurrent `run` requests cannot race past the limit. A new child is allowed after the previous child terminal stops.
- A delegated child receives `CODEDECK_DELEGATED=1`, `CODEDECK_AGENT_SCOPED_PIPE`, and a random `CODEDECK_AGENT_SCOPED_TOKEN`. It does not receive a supported path to the global bridge token.
- Packaged agent-managed terminals receive `CODEDECK_AGENT_CLI` pointing to the wrapper beside the currently running `CodeDeck.exe`. This value overrides stale inherited host values so nested launches remain on the same Bridge instance.
- The scoped token resolves the child task and its exact parent server-side. Scoped requests never accept a target session ID.
- `model` and `reasoning_effort` are one-run overlays on a cloned launch input. They must not mutate the stored Profile.
- Managed Codex launches keep the model in generated `config.toml`. Native Codex launches add `--model` only for an explicit one-run override, not for the Profile's ordinary selected model.
- Every managed or native Codex launch appends a structured `-c projects.<cwd>.trust_level=trusted` override after user arguments, then ends with `--disable hooks`. Windows drive-letter and UNC paths are normalized to native backslashes before the key is generated. The override value is one argv token and contains no `"`; shell preview quotes around paths with spaces are not part of the token. Both launch values apply only to that process and must not mutate the saved Profile, runtime settings, generated `config.toml`, or user-global Codex configuration.
- The trusted-project override is the normal path and should bypass Codex's first-run directory trust page. The runtime may still detect an interactive page and expose it as `awaiting_input` with its `question`, but the Agent Bridge Skill must report that question to the user without interpreting it or submitting an automatic response.
- The user-owned Agent Bridge Skill lives at `~/.codex/skills/codedeck-agent-bridge`; the repository must not contain `.codex/skills/codedeck-agent-bridge` or `.agents/skills/codedeck-agent-bridge`. CodeDeck launches use an isolated `CODEX_HOME`, so a Profile discovers the global Skill through the capability overlay only when global capability inheritance is enabled.
- Parent-bound runs default to `once`; unbound runs default to `manual`.
- Agent-managed launches pass the exact initial prompt as `expectedPreview`. Until a matching provider session appears, title/lifecycle resolution stays pending for the lifetime of the terminal; the ordinary UI launch path keeps its bounded title lookup timeout.
- A provider session candidate is eligible only when its `preview` or first `user_prompts` entry matches `expectedPreview` after the shared 120-character preview normalization. Same-cwd activity, recency, and provider equality are necessary but never sufficient identity.
- `once` changes to `manual` only after successful delivery. `continuous` remains active across turns. `manual` retains results without injecting them.
- Delivery is server-owned. It waits for a running idle parent, sends bracketed-paste input, then submits Enter. A busy parent keeps the delivery pending; a closed parent records a failure.
- Delivery is serialized per parent terminal. Continuous child results keep per-turn text snapshots and only the next queued result is submitted after the parent's previous injected turn completes.
- For Codex, an empty primary prompt must remain stable for 250 ms before it can emit the `idle_prompt` completion fallback. New terminal output, submitted input, or an authoritative lifecycle event cancels the pending fallback.
- Busy detection is scoped to the current submitted turn: a `Working` marker between the latest submitted prompt and the bottom placeholder keeps the terminal busy, while markers before a newer submitted prompt are scrollback and cannot block completion.
- `turn_completed` is authoritative when available. `idle_prompt` is a fallback only after the current turn has first observed `submitted_input`, `busy_output`, or `turn_started`; a startup placeholder with no current-turn busy evidence must never complete the task. The same evidence-gated fallback remains available after provider-session association so a missing lifecycle event cannot leave a visibly idle terminal permanently `running`.
- A Bridge `continue` request only queues terminal input; it must not itself mark the turn busy. When `continue` answers an interactive prompt such as directory trust, that response's `submitted_input` event is not model-turn busy evidence. Completion remains gated until the resumed model turn emits `busy_output` or `turn_started`.
- A parent may recover a missed first Codex trust screen with the exact response `1` only while the first turn has no provider session, no observed terminal output, no busy evidence, and an idle live PTY. All other inputs in `running` remain `session_busy`.
- Interactive confirmations such as `Do you want to proceed? (y/n)` remain `awaiting_input`; their trailing prompt glyph must never be treated as an idle primary prompt or release queued delivery.
- `interrupt` and `interrupt_parent` write one ESC byte (`\x1b`) only when the resolved peer is running and busy. They do not close the terminal or remove the binding. When the peer is a tracked task, the manager marks its current turn interrupted so an associated-session idle prompt can settle the task even if no lifecycle completion event follows.
- A successfully interrupted child turn completes with empty assistant text unless that turn later produces a new answer; completion must never reuse the previous turn's last session-file answer or enqueue it for delivery again.
- Child lifetime is owned by `AgentTaskManager`, not by the request socket or the parent's current turn. Explicitly closing a visible child window still ends that child.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown/blocked Profile | `profile_not_found` / `profile_blocked` |
| Invalid provider reasoning level | `invalid_reasoning_effort` before launch |
| Automatic policy without verified parent | `invalid_parent` |
| Parent token/session mismatch | `invalid_parent` or `unauthorized` |
| Bound or nested orchestrator launch | `invalid_parent` |
| Ordinary tracked task used as a parent | `invalid_parent` |
| Orchestrator already has a running or launching child | retryable `child_already_bound` |
| Parent attempts to control another parent's child | `unauthorized` |
| Scoped token attempts a global command | `unauthorized` |
| Child attempts recursive delegation through CLI | `recursive_delegation` |
| Interrupt target stopped | `session_not_running` |
| Interrupt target idle | `session_idle` |
| Interactive confirmation followed by a prompt glyph | `awaiting_input`; no completion or delivery |
| Any detected interactive page, including a legacy Codex trust page | `awaiting_input`; expose `question` and wait for explicit user direction |
| Global Skill is missing or global capability inheritance is disabled | Bridge transport still works, but a CodeDeck-launched Codex session must not assume `$codedeck-agent-bridge` is discoverable |
| Project contains a duplicate Agent Bridge Skill or discovery link | Remove it; the user-level Skill is the single source of truth |
| Same-cwd provider session has a different first prompt | Stay `pending`; never associate or read its assistant text |
| Matching session JSONL appears after the ordinary title timeout | Agent-managed launch still resolves while its terminal is alive |
| Startup placeholder appears before any current-turn busy evidence | Stay `running`; ignore provisional `idle_prompt` |
| Interactive response is submitted before the model turn resumes | Ignore its transient `idle_prompt`; wait for model-turn busy evidence |
| First Codex trust screen is unobserved while PTY remains idle | Accept exact response `1`; reject every other early continuation |
| Associated turn returns idle after current-turn busy evidence but no lifecycle event arrives | Complete through the evidence-gated `idle_prompt` fallback |
| Parent closes with pending delivery | `delivery_status=failed` with inspectable error |
| Bridge disabled or app quitting | delegated tasks are shut down cleanly |

### 5. Good/Base/Bad Cases

- Good: a root caller starts tracked orchestrator A, then A runs B with `wait_ms=0` and `return_policy=continuous`; B survives A's current turn, completes, and its answer is submitted only after A is idle.
- Base: an external caller without parent context runs B; the task remains queryable and defaults to `manual` without automatic terminal injection.
- Base: Codex returns to an empty primary prompt without a session-file lifecycle event. The stable-prompt fallback completes the turn once, and the same terminal accepts `continue`.
- Base: an older Codex version still shows a first-run trust prompt and delays JSONL creation beyond 60 seconds. The task remains `awaiting_input`, accepts the explicit response through `continue` only after exact `cwd` matching, then associates only the session whose first prompt matches.
- Good: a fresh Codex session receives the one-run trusted-project override and, when global capability inheritance is enabled, discovers the user-level `$codedeck-agent-bridge` through its capability overlay without a directory trust prompt.
- Bad: a provider-backed turn shows its bottom placeholder during `Working`. Completing from that placeholder produces empty or stale `assistant_text`; the task must wait for provider lifecycle completion.
- Bad: two concurrent child launches from A. One launch reserves A and the other returns retryable `child_already_bound` before opening another terminal.
- Bad: a normal tracked task or a bound child requests `orchestrator: true`. The request returns `invalid_parent` or `recursive_delegation` without launching a terminal.
- Bad: B supplies an arbitrary terminal ID or uses `run` to create C. The supported scoped path rejects both operations.
- Bad: A sends ESC to an unrelated or idle session. The bridge rejects the request and leaves every terminal alive.

### 6. Tests Required

- Protocol tests assert parsing and rejection for model, reasoning, policies, parent fields, and scoped commands.
- Task-manager tests assert parent verification, orchestrator-only tracked parenting, launch-time child reservation, `once` transition, continuous multi-turn delivery, manual retention, busy queueing, parent-close failure, and idempotent completion.
- Multi-turn tests assert that queued continuous results preserve their original assistant text and never submit two prompts into the same idle transition.
- Activity tests assert the 250 ms idle-prompt stability window, cancellation on new activity, and rejection of interactive prompts as idle completion.
- Activity tests assert that current-turn `Working` between a submitted prompt and the bottom placeholder remains busy, while an older turn's marker does not contaminate a newer completed turn.
- Session-resolution tests assert mismatched same-cwd candidates stay pending, matching prompt candidates resolve after delayed creation, duplicate matches stay ambiguous, and agent-managed polling is not stopped by the ordinary UI timeout.
- Task-manager tests assert startup placeholders cannot complete before busy evidence, associated sessions complete from `turn_completed` when available, and evidence-gated idle/interrupted fallbacks settle missing lifecycle events.
- Interrupt tests assert exact parent/child ownership, one `\x1b` write, idle/stopped errors, no stale assistant replay, and preserved task/session state across a subsequent `continue`.
- Launch-service tests assert valid provider normalization, managed/native model behavior, cloned overlays, and no stored Profile mutation.
- Launch-service and command-builder tests assert every Codex launch appends one trusted-project override for the normalized `cwd` after user arguments and before the exact final `--disable hooks` pair. Forward-slash Windows inputs become native backslashes; spaces and non-ASCII characters remain one argv value containing no `"`, while Claude launches remain unchanged. A packaged Bridge/TUI smoke test must prove the trust page is bypassed; parser-only commands such as `features list` are insufficient.
- Server/CLI tests assert global-token and scoped-token routing and recursive delegation rejection.
- Skill validation runs `quick_validate.py` against `~/.codex/skills/codedeck-agent-bridge`. Validation confirms that `awaiting_input` questions are reported rather than answered automatically; an integration check with global capability inheritance enabled confirms that a CodeDeck-launched Codex session can discover the Skill.
- Full verification requires `npm test`, `npm run typecheck`, and `npm run build:electron`.

### 7. Wrong vs Correct

#### Wrong

```typescript
// The child chooses any target and writes directly to that terminal.
terminal.sendInput(request.parent_session_id, request.answer + "\r");
```

#### Correct

```typescript
// The server resolves the target from the verified binding and waits for idle.
const task = requireScopedTask(scopedToken);
if (task.parentSessionId && parentSnapshot.activity === "idle") {
  deliverBoundAnswer(task);
}
```

The server-owned lookup prevents target substitution, while the idle gate prevents answer text from interleaving with an active turn.

#### Wrong

```typescript
if (event.reason === "idle_prompt") completeTurn(task);
```

#### Correct

```typescript
if (event.reason === "turn_completed"
    || (event.reason === "idle_prompt" && (sawCurrentTurnBusy(task) || wasInterrupted(task)))) {
  completeTurn(task);
}
```

Provider lifecycle outranks TUI repaint heuristics. The fallback exists only before association or for the explicitly interrupted current turn.

#### Wrong

```powershell
# Starts a second task and abandons the terminal waiting for trust input.
"1" | & $agentCli run --profile $profile
```

#### Correct

```powershell
# Answers the expected trust page in the existing task.
"1" | & $agentCli continue --session $sessionId --wait-ms 0
```

Directory trust belongs to the existing terminal lifecycle. Reusing the session preserves task identity, parent binding, return policy, and later delivery.

#### Wrong

```typescript
// Re-parses a generated Windows path as user-authored CLI text and can consume
// backslashes before Codex receives the dotted-key override, while JSON.stringify\n// also creates a quoted dotted-key segment that Codex 0.147.0 does not resolve correctly.
runtime.extra_args += ` -c projects.${JSON.stringify(runtime.cwd)}.trust_level="trusted"`;
```

#### Correct

```typescript
const args = buildCodexArgs({
  ...options,
  trustedProjectPath: runtime.cwd,
});
```

Generated trust configuration is a structured argv contract. `LaunchService` supplies the selected `cwd` once, and the Codex command builder normalizes Windows separators before emitting `projects.${cwd}.trust_level=trusted` without quotes while owning final argument ordering.
