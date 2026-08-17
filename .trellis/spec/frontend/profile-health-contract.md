# Profile Health Monitoring Contract

## 1. Scope / Trigger

This contract applies whenever Profile health state, monitored CLI launch behavior, Profile/channel/model identity, local-state persistence, or health UI is changed.

Ownership:

- `src/shared/profile-health/` owns target identity, state normalization, bounded prompt construction, journey reply parsing/validation, failure classification, and presentation mapping.
- Electron main owns hidden monitored CLI orchestration, lifecycle completion, JSONL assistant extraction, PTY cleanup, same-target in-flight deduplication, cross-target health CLI serialization, durable state writes, and IPC.
- Renderer components gate manual actions and render shared projections. They must not call Provider model endpoints, parse model replies, or classify CLI failures.

The active probe must be a real Codex/Claude CLI turn. Electron must never implement health probing with direct `/responses`, `/chat/completions`, or `/messages` requests.

## 2. Signatures

```ts
interface ProfileHealthTestRequest {
  profile_key?: ProfileKey;
  profile: Profile;
  codex_wire_api?: string; // legacy-compatible input; not used for direct HTTP probing
}

interface ProfileHealthCheckpoint {
  sequence: number;
  carry_word: string;
  assistant_text: string;
}

function buildProfileHealthPrompt(previous?: ProfileHealthCheckpoint): string;
function validateProfileHealthReply(
  assistantText: string,
  previous?: ProfileHealthCheckpoint,
): ProfileHealthValidationResult;
```

IPC:

- `profile-health:test(request) -> Promise<ProfileHealthTestResult>`
- `profile-health:progress -> ProfileHealthProgressEvent`

## 3. Contracts

### Target And Persistence

- A target consists of provider, saved Profile key, active channel ID, normalized Base URL, and selected model ID.
- API keys and URL credentials are excluded from target keys, persisted health state, diagnostics, and logs.
- Manual probing is allowed only when the editor exactly matches a saved non-official Profile and its Base URL, key, model, working directory, and CLI command are complete.
- Persist only the current result and bounded checkpoint. `assistant_text` is capped and represents only the immediately previous valid assistant reply.
- Codex active probes use `<saved runtime cwd>/.codedeck/profile-health/codex-home` as their dedicated `CODEX_HOME`. Health JSONL/config/runtime files must not be written to the user's global `.codex`; ordinary Codex launches retain their existing home.
- Do not persist a Provider session ID and do not use `resume_selected` for active health probes.
- Profile deletion or material URL/channel/model/credential changes clear obsolete target state. Old local-state files load with an empty health map, and stale `running` flags reset on load.

### Hidden CLI Turn

- Every manual action builds a normal launch plan with `launch_mode: "new"`, `terminal_mode: "monitored"`, and `showWindow: false`.
- The selected model comes from the saved Profile model configuration. Provider protocol, authentication headers, User-Agent, and network behavior belong to the real CLI.
- Codex receives the prompt through the existing UTF-8 launch-argument bridge. Claude receives it through the monitored PTY after the CLI is ready.
- Before a Codex probe starts, write the generated standalone site Profile config into the dedicated health home, override `plan.env.CODEX_HOME`, and let title/lifecycle resolution follow that same overridden plan value.
- The first prompt contains fixed journey rules plus the initial state: sequence `0`, location `海边旧车站`, and carry word `钟声`.
- Later prompts contain only fixed rules, the immediately previous assistant reply, and the literal current instruction `继续`. No older assistant history is included.
- One manual action submits exactly one model turn. Read retries may retry only the just-written JSONL file; they must never submit another turn.
- An authoritative `turn_completed` resolves the Provider JSONL path. The result is read with `readLastAssistantTextFromSessionFile`.
- Cache a completed turn's JSONL path if it arrives before the health waiter is registered. After registration, reject immediately when the PTY has already exited instead of waiting for timeout.
- Serialize hidden health CLI launches across targets because their shared fixed prompt prefix can make concurrent Provider-session discovery ambiguous. Same-target requests remain deduplicated.
- Stop lifecycle/title watchers, clear completion caches, and close the hidden PTY on success, degraded validation, timeout, process failure, and cleanup.

### Journey Reply

The assistant output is plain text containing a short natural Chinese journey note followed by the final state line:

```text
潮湿的海风穿过旧站台，远处的钟声刚停，一辆慢车正沿着海岸驶来。

〔旅记 1｜下一词：车窗〕
```

Validation accepts exactly two non-empty logical lines, with optional blank lines between them: one journey body line and the final state line. Explanations, wrappers, and extra non-empty lines are invalid. It also requires sequence `N + 1`, the previous carry word in the body, and a non-empty changed next word. Only a valid reply advances the checkpoint.

### Passive Signal

- Only an authoritative `turn_completed` event from an ordinary CodeDeck monitored terminal may mark passive availability.
- Bind its health target at launch time; later Profile edits must not redirect the result.
- Direct external terminals never create passive success.
- Passive success may update status and timestamps but must not advance the active checkpoint.

## 4. Validation & Error Matrix

| Condition | Result |
|---|---|
| Valid completed journey reply | `available / ok` |
| CLI completes but marker, sequence, carry usage, or next word is invalid | `degraded / continuity_invalid` |
| Completed lifecycle has no readable assistant text after bounded read retries | `model_unavailable / empty_response` |
| CLI evidence contains 401/403/authentication failure | `auth_failed / auth_failed` |
| CLI evidence contains 429/rate-limit failure | `rate_limited / rate_limited` |
| CLI evidence identifies a missing/unsupported model | `model_unavailable / provider_error` |
| CLI evidence contains a 5xx, bad gateway, service unavailable, or gateway timeout response | `model_unavailable / provider_error` |
| Hidden turn times out | `network_error / timeout` |
| Launch, lifecycle resolution, or process exit fails without stronger evidence | `network_error / network_error` |
| Profile is unsaved, dirty, official, or incomplete | Reject before launching a CLI turn |

Failure summaries are bounded and credential-redacted. IPC logging for the probe must use `includeArgs: false`.

## 5. Good / Base / Bad Cases

- Good: a saved Codex Profile launches one hidden monitored `new` session, the body uses `钟声`, the marker is `〔旅记 1｜下一词：车窗〕`, the checkpoint advances, and the PTY closes.
- Base: a normal monitored user terminal emits `turn_completed`; the launch-time target becomes passively available without changing its journey checkpoint.
- Bad: Electron constructs a Provider URL and calls `fetch`, resumes an old health Provider session, sends older conversation history, retries a second model turn, or persists credentials/session IDs.

## 6. Tests Required

- Prompt unit tests assert the first initialization state and that subsequent prompts equal fixed rules plus one previous reply plus `继续`.
- Parser/validator tests assert valid natural journey output, malformed/fenced markers, explanatory text before an otherwise valid marker, wrong sequence, missing previous carry word, and unchanged next word.
- Electron integration tests assert `launch_mode: "new"`, `showWindow: false`, authoritative `turn_completed`, early-completion caching, terminal-exit checks, serialized health launches, JSONL assistant reads, and PTY closure.
- Codex-home tests assert the health plan, generated config path, and session resolver all use `<cwd>/.codedeck/profile-health/codex-home`, while ordinary launch plans remain unchanged.
- Terminal prompt tests cover bracketed multiline paste, CRLF/NUL normalization, and Claude ready-prompt detection.
- Source-contract tests assert the health path has no `ProfileHealthService`/Provider HTTP transport and no health-session resume path.
- State tests cover migration, bounded checkpoint round-trip, stale `running` reset, and Profile identity cleanup.
- UI tests cover saved/clean gating, official Profile exclusion, compact channel action, and coexistence with balance badges.
- Final verification runs `npm test`, `npm run typecheck`, and the production build/package command.

## 7. Wrong vs Correct

### Wrong

```ts
await fetch(`${profile.url}/responses`, { headers: { authorization: profile.key } });
runtime.launch_mode = "resume_selected";
```

This bypasses the real CLI network behavior and makes the health conversation grow indefinitely.

### Correct

```ts
runtime.launch_mode = "new";
runtime.terminal_mode = "monitored";
const prompt = buildProfileHealthPrompt(previous?.checkpoint);
await launchMonitoredTerminalSession(plan, { showWindow: false, expectedPreview: prompt });
```

Each turn is a real hidden CLI invocation with bounded context and explicit lifecycle cleanup.
