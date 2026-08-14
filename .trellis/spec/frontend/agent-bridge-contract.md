# Persistent Agent Bridge Contract

## Scenario: Parent-bound delegated discussion

### 1. Scope / Trigger

- Trigger: any change to `electron/agent-cli.ts`, `electron/main.ts`, or `src/shared/agent-bridge/*` that affects delegated launch, task lifetime, automatic return, or peer interruption.
- The bridge is a local Electron-main-owned capability boundary. It is not a general terminal-control API.
- A normal monitored terminal may launch one delegated child. The child cannot recursively delegate through the supported CLI.

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
codedeck-agent continue --session <id> [--return-policy once|continuous|manual]
codedeck-agent interrupt --session <id>
codedeck-agent policy [--return-policy once|continuous|manual]
codedeck-agent interrupt-parent
```

### 3. Contracts

- Electron generates `CODEDECK_TERMINAL_SESSION_ID` and `CODEDECK_TERMINAL_PARENT_TOKEN` for every monitored terminal. A parent binding is accepted only when both values match a running managed terminal.
- A delegated child receives `CODEDECK_DELEGATED=1`, `CODEDECK_AGENT_SCOPED_PIPE`, and a random `CODEDECK_AGENT_SCOPED_TOKEN`. It does not receive a supported path to the global bridge token.
- The scoped token resolves the child task and its exact parent server-side. Scoped requests never accept a target session ID.
- `model` and `reasoning_effort` are one-run overlays on a cloned launch input. They must not mutate the stored Profile.
- Managed Codex launches keep the model in generated `config.toml`. Native Codex launches add `--model` only for an explicit one-run override, not for the Profile's ordinary selected model.
- Parent-bound runs default to `once`; unbound runs default to `manual`.
- `once` changes to `manual` only after successful delivery. `continuous` remains active across turns. `manual` retains results without injecting them.
- Delivery is server-owned. It waits for a running idle parent, sends bracketed-paste input, then submits Enter. A busy parent keeps the delivery pending; a closed parent records a failure.
- Delivery is serialized per parent terminal. Continuous child results keep per-turn text snapshots and only the next queued result is submitted after the parent's previous injected turn completes.
- `interrupt` and `interrupt_parent` write one ESC byte (`\x1b`) only when the resolved peer is running and busy. They do not close the terminal or remove the binding.
- Child lifetime is owned by `AgentTaskManager`, not by the request socket or the parent's current turn. Explicitly closing a visible child window still ends that child.

### 4. Validation & Error Matrix

| Condition | Required result |
| --- | --- |
| Unknown/blocked Profile | `profile_not_found` / `profile_blocked` |
| Invalid provider reasoning level | `invalid_reasoning_effort` before launch |
| Automatic policy without verified parent | `invalid_parent` |
| Parent token/session mismatch | `invalid_parent` or `unauthorized` |
| Parent attempts to control another parent's child | `unauthorized` |
| Scoped token attempts a global command | `unauthorized` |
| Child attempts recursive delegation through CLI | `recursive_delegation` |
| Interrupt target stopped | `session_not_running` |
| Interrupt target idle | `session_idle` |
| Parent closes with pending delivery | `delivery_status=failed` with inspectable error |
| Bridge disabled or app quitting | delegated tasks are shut down cleanly |

### 5. Good/Base/Bad Cases

- Good: monitored A runs B with `wait_ms=0` and `return_policy=continuous`; B survives A's current turn, completes, and its answer is submitted only after A is idle.
- Base: an external caller without parent context runs B; the task remains queryable and defaults to `manual` without automatic terminal injection.
- Bad: B supplies an arbitrary terminal ID or uses `run` to create C. The supported scoped path rejects both operations.
- Bad: A sends ESC to an unrelated or idle session. The bridge rejects the request and leaves every terminal alive.

### 6. Tests Required

- Protocol tests assert parsing and rejection for model, reasoning, policies, parent fields, and scoped commands.
- Task-manager tests assert parent verification, `once` transition, continuous multi-turn delivery, manual retention, busy queueing, parent-close failure, and idempotent completion.
- Multi-turn tests assert that queued continuous results preserve their original assistant text and never submit two prompts into the same idle transition.
- Interrupt tests assert exact parent/child ownership, one `\x1b` write, idle/stopped errors, and preserved task/session state.
- Launch-service tests assert valid provider normalization, managed/native model behavior, cloned overlays, and no stored Profile mutation.
- Server/CLI tests assert global-token and scoped-token routing and recursive delegation rejection.
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
