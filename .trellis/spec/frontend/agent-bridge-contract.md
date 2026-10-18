# Persistent Agent Bridge Contract

## Scenario: Parent-bound delegated discussion

### 1. Scope / Trigger

- Trigger: any change to `electron/agent-cli.ts`, `electron/main.ts`, `src/shared/agent-bridge/*`, `src/shared/services/launch-service.ts`, or `src/shared/provider/codex/command-builder.ts` that affects delegated launch, Codex project trust, task lifetime, automatic return, or peer interruption.
- The bridge is a local Electron-main-owned capability boundary. It is not a general terminal-control API.
- `auth_token` is a separate narrow capability that remains available when delegation is disabled. It accepts exactly one stable `site_provider_<hash>` ID and never accepts a Profile key, list operation, or bulk secret request.
- A root caller may explicitly launch a tracked orchestrator. The orchestrator may launch one live bound child, while an ordinary tracked task cannot become a parent.
- Existing untracked monitored terminals retain parent-bound delegation. Every delegated child is depth-limited and cannot recursively delegate through the supported CLI.

### 2. Signatures

```typescript
type AgentReturnPolicy = "once" | "continuous" | "manual";

type AgentBridgeRequest =
  | {
      command: "auth_token";
      provider_id: string;
    }
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
codedeck-agent auth-token --provider <stable-provider-id>
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
  modelProviderOverride?: string;
  trustedProjectPath?: string;
  disableHooks?: boolean;
}
```

### 3. Contracts

- Electron generates `CODEDECK_TERMINAL_SESSION_ID` and `CODEDECK_TERMINAL_PARENT_TOKEN` for every monitored terminal. A parent binding is accepted only when both values match a running managed terminal.
- Electron resolves `auth_token` against the currently unlocked saved Codex Profiles and returns only that Profile's active token. Invalid provider syntax, a deleted Profile, and a locked store fail without fallback to files or environment variables.
- `codedeck-agent auth-token` writes only the token plus a final newline to stdout on success. On failure stdout is empty, stderr contains only a stable code and non-secret message, and the process exits non-zero.
- Site Profile TOML and the global managed provider registry use the same `auth.command/args` definition and never combine it with `env_key`, `experimental_bearer_token`, or `requires_openai_auth`.
- `orchestrator: true` is valid only for an unbound root `run`. The orchestrator remains owned by `AgentTaskManager`, receives the terminal parent identity, and does not receive `CODEDECK_DELEGATED=1`.
- An ordinary tracked task cannot become a parent. A tracked parent is accepted only when its task record is an explicit orchestrator; nested orchestrators are rejected.
- An orchestrator may have only one bound child whose terminal is running. The manager reserves that parent during child launch so concurrent `run` requests cannot race past the limit. A new child is allowed after the previous child terminal stops.
- A delegated child receives `CODEDECK_DELEGATED=1`, `CODEDECK_AGENT_SCOPED_PIPE`, and a random `CODEDECK_AGENT_SCOPED_TOKEN`. It does not receive a supported path to the global bridge token.
- Packaged agent-managed terminals receive `CODEDECK_AGENT_CLI` pointing to the wrapper beside the currently running `CodeDeck.exe`. This value overrides stale inherited host values so nested launches remain on the same Bridge instance.
- The scoped token resolves the child task and its exact parent server-side. Scoped requests never accept a target session ID.
- `model` and `reasoning_effort` are one-run overlays on a cloned launch input. They must not mutate the stored Profile.
- Managed Codex launches keep the model in generated `config.toml`. Native Codex launches add `--model` only for an explicit one-run override, not for the Profile's ordinary selected model.
- Every managed or native Codex launch appends a structured `-c projects.<quoted-cwd>.trust_level="trusted"` override after user arguments. Agent Bridge launches additionally end with `--disable hooks`; ordinary UI launches do not inject that Bridge-only override. Both generated values apply only to that process and must not mutate the saved Profile, runtime settings, generated `config.toml`, or user-global Codex configuration.
- The trusted-project override is the normal path and should bypass Codex's first-run directory trust page. If an older Codex version or exceptional environment still shows that page, answer it through the same bridge session only when the question is a directory trust prompt and the displayed directory exactly matches the requested `cwd`; never launch a replacement session. A different directory or question requires user confirmation.
- The repository-owned Agent Bridge Skill lives at `.codex/skills/codedeck-agent-bridge`. Because repository Skill discovery scans `.agents/skills`, `.agents/skills/codedeck-agent-bridge` must resolve to that source directory and must not contain a divergent copy.
- Parent-bound runs default to `once`; unbound runs default to `manual`.
- Agent-managed launches pass the exact initial prompt as `expectedPreview`. Until a matching provider session appears, title/lifecycle resolution stays pending for the lifetime of the terminal; the ordinary UI launch path keeps its bounded title lookup timeout.
- A provider session candidate is eligible only when its `preview` or first `user_prompts` entry matches `expectedPreview` after the shared 120-character preview normalization. Same-cwd activity, recency, and provider equality are necessary but never sufficient identity.
- `once` changes to `manual` only after successful delivery. `continuous` remains active across turns. `manual` retains results without injecting them.
- Delivery is server-owned. It waits for a running idle parent, sends bracketed-paste input, then submits Enter. A busy parent keeps the delivery pending; a closed parent records a failure.
- Delivery is serialized per parent terminal. Continuous child results keep per-turn text snapshots and only the next queued result is submitted after the parent's previous injected turn completes.
- For Codex, an empty primary prompt must remain stable for 250 ms before it can emit the `idle_prompt` completion fallback. New terminal output, submitted input, or an authoritative lifecycle event cancels the pending fallback.
- `Ask Codex to do anything` is a valid empty primary-prompt placeholder. A real final `Worked for <duration> • <clock>` separator immediately before that prompt ends old busy evidence; it must be the final complete nonblank line outside an open Markdown code fence. Quoted examples, continued answer text, new Working output and interactive confirmations must not settle a live turn.
- Busy detection is scoped to the current submitted turn: a `Working` marker between the latest submitted prompt and the bottom placeholder keeps the terminal busy, while markers before a newer submitted prompt are scrollback and cannot block completion.
- `turn_completed` is authoritative when available. `idle_prompt` is a fallback only after the current turn has first observed `submitted_input`, `busy_output`, or `turn_started`; a startup placeholder with no current-turn busy evidence must never complete the task. The same evidence-gated fallback remains available after provider-session association so a missing lifecycle event cannot leave a visibly idle terminal permanently `running`.
- A Bridge `continue` request only queues terminal input; it must not itself mark the turn busy. When `continue` answers an interactive prompt such as directory trust, that response's `submitted_input` event is not model-turn busy evidence. Completion remains gated until the resumed model turn emits `busy_output` or `turn_started`.
- A parent may recover a missed first Codex trust screen with the exact response `1` only while the first turn has no provider session, no observed terminal output, no busy evidence, and an idle live PTY. All other inputs in `running` remain `session_busy`.
- Interactive confirmations such as `Do you want to proceed? (y/n)` remain `awaiting_input`; their trailing prompt glyph must never be treated as an idle primary prompt or release queued delivery.
- `interrupt` and `interrupt_parent` write one ESC byte (`\x1b`) only when the resolved peer is running and busy. They do not close the terminal or remove the binding. When the peer is a tracked task, the manager marks its current turn interrupted so an associated-session idle prompt can settle the task even if no lifecycle completion event follows.
- A successfully interrupted child turn completes with empty assistant text unless that turn later produces a new answer; completion must never reuse the previous turn's last session-file answer or enqueue it for delivery again.
- Authoritative completion/failure settles the current turn and clears historical PTY activity evidence. Old `Working` repaint cannot reopen it; a new valid submission or authoritative start opens the next turn. Late old lifecycle events must not settle a newer turn.
- A lifecycle completion arriving after a provisional idle fallback remains observable once to authoritative consumers, while Bridge delivery remains idempotent for that turn. Replaced/closed watchers cannot dispatch after asynchronous I/O resumes.
- Codex high-demand auto-continue requires a current final structured retryable failure and the configured keyword filter; ordinary answer text, intermediate stream errors/reconnects, and old repaint cannot authorize input. Success/new input/new turn invalidates queued actions, and timer/renderer flush rechecks the same failure generation before writing. Claude's existing provider-specific behavior remains separate.
- The auto-continue limit is a cumulative terminal budget, not the CLI's `Reconnecting 1/5` count. Success clears obsolete failure state without resetting this budget; unlimited remains an explicit user setting.
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
| Legacy Codex directory trust page with exact expected `cwd` | Keep the task and terminal alive; submit `1` through `continue --session <id>` |
| Trust page shows an unexpected directory or question | Do not answer automatically; request user confirmation |
| Repository Skill exists only under `.codex/skills` | Validation may pass, but a fresh repository session must be treated as unable to discover it |
| Same-cwd provider session has a different first prompt | Stay `pending`; never associate or read its assistant text |
| Matching session JSONL appears after the ordinary title timeout | Agent-managed launch still resolves while its terminal is alive |
| Startup placeholder appears before any current-turn busy evidence | Stay `running`; ignore provisional `idle_prompt` |
| Interactive response is submitted before the model turn resumes | Ignore its transient `idle_prompt`; wait for model-turn busy evidence |
| First Codex trust screen is unobserved while PTY remains idle | Accept exact response `1`; reject every other early continuation |
| Associated turn returns idle after current-turn busy evidence but no lifecycle event arrives | Complete through the evidence-gated `idle_prompt` fallback |
| Parent closes with pending delivery | `delivery_status=failed` with inspectable error |
| Bridge disabled or app quitting | delegated tasks are shut down cleanly |
| Token request while Profile store is locked | `store_locked`; stdout empty |
| Token request has malformed provider ID | `provider_not_found`; stdout empty |
| Stable provider has no saved Profile | `profile_not_found`; stdout empty |
| CodeDeck connection file/pipe is unavailable | `app_unavailable`; stdout empty |

### 5. Good/Base/Bad Cases

- Good: a root caller starts tracked orchestrator A, then A runs B with `wait_ms=0` and `return_policy=continuous`; B survives A's current turn, completes, and its answer is submitted only after A is idle.
- Base: an external caller without parent context runs B; the task remains queryable and defaults to `manual` without automatic terminal injection.
- Base: Codex returns to an empty primary prompt without a session-file lifecycle event. The stable-prompt fallback completes the turn once, and the same terminal accepts `continue`.
- Base: an older Codex version still shows a first-run trust prompt and delays JSONL creation beyond 60 seconds. The task remains `awaiting_input`, accepts the explicit response through `continue` only after exact `cwd` matching, then associates only the session whose first prompt matches.
- Good: a fresh Codex session receives the one-run trusted-project override, discovers `$codedeck-agent-bridge` through `.agents/skills`, and executes the Skill without a directory trust prompt.
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
- Launch-service and command-builder tests assert every Codex launch appends one trusted-project override for the normalized `cwd` after user arguments. Bridge requests append the exact final `--disable hooks` pair, while ordinary UI requests omit it. Windows backslashes, spaces, and non-ASCII paths remain one argv value, while Claude launches remain unchanged.
- Server/CLI tests assert global-token and scoped-token routing and recursive delegation rejection.
- Protocol/server/CLI tests assert single-provider token parsing, exact provider mapping, locked/unavailable failures, raw-token-only success stdout, empty failure stdout, and no token in stderr or JSON diagnostics.
- Skill validation runs `quick_validate.py` against the `.codex/skills` source. A fresh Codex session must also discover the Skill through `.agents/skills` without a trust prompt; the exact-`cwd` response remains a legacy compatibility check.
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
// backslashes before Codex receives the TOML key.
runtime.extra_args += ` -c projects.${JSON.stringify(runtime.cwd)}.trust_level="trusted"`;
```

#### Correct

```typescript
const args = buildCodexArgs({
  ...options,
  trustedProjectPath: runtime.cwd,
});
```

Generated trust configuration is a structured argv contract. `LaunchService` supplies the selected `cwd` once, and the Codex command builder owns TOML key encoding and final argument ordering.

## Scenario: Auto-Continue Schedule Visibility

### 1. Scope / Trigger

Changes to monitored retry scheduling, terminal snapshots/status deduplication, or the compact terminal toolbar must preserve the real queue-to-renderer projection.

### 2. Signatures

`TerminalSessionSnapshot.autoContinueSchedule?: TerminalAutoContinueSchedule`:

```typescript
interface TerminalAutoContinueSchedule {
  delayMs: number;
  queuedAtMs: number;
  dueAtMs: number;
  phase: "waiting" | "waiting_for_renderer" | "send_failed";
  error?: string;
}
```

### 3. Contracts

- Manager owns the schedule and uses the controller's once-sampled delay. `dueAtMs = queuedAtMs + delayMs`; configured normal mean/deviation are not the actual sampled delay. Renderer must not resample or infer a pending retry from configuration alone.
- Publish schedule creation, phase changes and removal through existing status IPC; clone this nested object and include all fields in status equality. Do not regress output-buffer ownership or status-event deduplication.
- Cancel scheduled input on success, valid user input/new turn, pause/disable, thread switch, close/exit. Clear schedule when sent. Preserve a real send failure through renderer detach/attach until a meaningful clearing action.
- Input cancellation distinguishes complete, recognized terminal protocol reports from real interaction. Focus reports (`ESC[I`/`ESC[O`), mouse reports and unambiguous device replies remain forwarded byte-for-byte but do not cancel the queued retry or contaminate typed-input tracking. User text, paste, real keys and mixed user/protocol chunks still cancel; unknown/incomplete sequences are conservative user input without delaying forwarding. Do not classify all CSI as protocol: modified function keys can resemble cursor-position replies, so ambiguous replies need an observed matching terminal query, consumed once within its short validity window. Clear query authorization across turn/thread boundaries without clearing an active bracketed-paste context.
- Render actual sampled seconds, local due time and countdown while waiting. Once due but awaiting a renderer, display that reason instead of a permanently zero countdown. With no schedule, explicitly say no auto-continue is arranged; pause/disabled/exhausted states remain explicit. This does not promise every error is retryable.
- Countdown updates locally only while waiting, with cleanup on unmount/state transition. Do not add per-second IPC or trigger xterm fit/resize solely from countdown ticks.
- Wide-window controls and Apply share one row, leaving more terminal height. Narrow windows may wrap without horizontal overflow. Preserve setting drafts, long-title ellipsis, input/paste and output history.

### 4. Validation & Error Matrix

| Condition | Required projection |
| --- | --- |
| Mean 50 s, actual delay 48.6 s | Show 48.6 s and actual due time; do not show mean as scheduled delay |
| Delay expires without renderer | Waiting for terminal connection; no repeated zero countdown |
| No action is queued | Explicitly no scheduled auto-continue |
| Success, new input, pause, disable, switch, close or exit | Remove obsolete pending schedule |
| PTY write throws | Show send_failed; do not claim successful delivery or silently retry |
| Renderer reconnects after write failure | Retain failure evidence |
| Focus/mouse/protocol report arrives before due time | Same schedule and due timestamp survive; forward report unchanged |
| Real key, paste, mixed text or unknown/incomplete control input arrives | Cancel scheduled input; preserve user data and key semantics |

### 5. Good / Base / Bad Cases

- Good: A genuine retryable failure queues one 48.6-second action; UI counts down toward its actual due timestamp.
- Base: Auto-continue is enabled but no qualifying failure occurs; UI says no action is scheduled.
- Bad: Display a random estimate or the distribution mean when manager has no pending input.

### 6. Tests Required

Assert actual queue timestamps, immutable snapshots/status events, due-without-renderer, send failure/reattach and all cancellation paths. Include the observed 65.608-second queue with focus reporting at 48.791 seconds: keep the original due time and send exactly once. Assert mouse/device replies, paste boundaries, mixed input, actual navigation/interrupt keys and ambiguous cursor-position/function-key packets. Component tests verify countdown transitions and cleanup without extra resize/IPC. Inspect real renderer layout at wide and narrow widths; browser fixture proof does not replace real CLI delivery or a running packaged-app update.

### 7. Wrong vs Correct

Wrong: `nextInputAt = Date.now() + snapshot.autoContinue.intervalMs` on every render.

Correct: derive remaining seconds only from the manager's `autoContinueSchedule.dueAtMs`, and render a separate explanation for each non-waiting phase.

## 场景：受监控终端输出与资源回收

### 1. 范围与触发

修改 `TerminalSessionManager`、`TerminalApp`、终端订阅或 Bridge 终端适配时，保持以下输出和所有权约束。

### 2. 接口

```typescript
attachSession(id: string, subscriber: TerminalSessionSubscriber): () => void;
getSnapshot(id: string): TerminalSessionSnapshot | undefined;
closeSession(id: string, reason?: string): Promise<void>;
```

### 3. 契约

- `onOutput` 按原顺序传递所有原始块；不能对 ANSI、中文或拆开的 surrogate 做逐块转码、抽样或丢弃。重连快照保持原有末尾 64,000 个 UTF-16 code unit 窗口，追加时不重建完整历史，读取时才物化。
- `onStatus` 在 attach 时发初始快照，之后只通知状态、活动、标题、退出信息或自动继续设置的变化。它不是输出心跳；需要终端文本的消费者订阅 `onOutput`。权威生命周期事件的独立投递不受状态去重影响。
- xterm 持有可见历史；React 状态只保留元数据。写锁提示须支持跨输出块识别。布局变化可以 fit，PTY 尺寸未变时不重复发 resize；组件卸载后不能处理迟到 attach 结果。
- 显式 close 通知后移除 manager 条目并释放缓冲、PTY 监听、订阅和待执行 timer；重复 close 安全。Bridge 保留的解除函数不能直接闭包引用已关闭的 ManagedSession。
- 自然退出保留仍打开窗口的历史，释放 PTY 监听。显式 close 仍须调用 PTY 的 kill/原生清理路径：当前 node-pty 的 ConPTY 输出 Worker 会存活到该步骤，不能因 status 已是 exited 而跳过。resize 报 already exited 只证明进程状态，不能证明输出管道已排空；须接收尾部直到真实 `onExit`，之后忽略迟到回调。
- kill 失败保留原运行对象，以便重试；同步 kill → exit 回调不能把 closed 改回 exited。已完成回合的历史 repaint 不参与活动解析，新提交或权威 started 按原契约开启下一回合。

### 4. 验证与错误矩阵

| 条件 | 结果 |
| --- | --- |
| close 成功后查询 | `undefined`，不会重建已关闭会话 |
| 非 already-exited 的 kill 错误 | 抛出错误，保留会话与监听，允许再次 close |
| 自然退出但窗口仍在 | 可 attach 重读原有重连窗口，PTY 监听为 0 |
| resize 提前发现退出 | 尾部原样交付，onExit 后释放监听 |
| 纯输出或相同标题/配置 | 输出照常交付，不重复状态快照 |

### 5. 正常、基础与错误案例

- 正常：反复创建、关闭终端，manager 保留会话/输出和 PTY 监听回到 0。
- 基础：进程退出后查看窗口历史，再关闭窗口释放历史。
- 错误：把每块完整 output 存进 React，或只把会话标记 closed 而一直留在 Map 中。

### 6. 必需验证

`terminal-resource-lifecycle.test.ts` 覆盖同步退出、kill 重试、迟到回调、尾部排空、原始块顺序与快照稳定性；`terminal-output-buffer.test.ts` 覆盖分块边界；`terminal-app-layout.test.tsx` 覆盖尺寸去重、标题布局、跨块提示与解除订阅。性能脚本位于 `scripts/performance/`，逻辑保留量与 OS 内存须分别报告，不使用强制 GC。

### 7. 错误与正确实现

```typescript
// 错误：每个输出块重新复制重连窗口，并把完整快照作为输出心跳。
snapshot.output = (snapshot.output + chunk).slice(-64_000);
notifyStatus(snapshot);

// 正确：有界追加、原始流交付；状态变化时才物化快照。
session.outputBuffer.append(chunk);
notifyOutput(session, chunk);
notifyStatus(session); // 内部比较元数据，忽略纯 output 变化。
```
