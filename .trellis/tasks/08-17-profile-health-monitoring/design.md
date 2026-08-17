# Profile Health Monitoring Design

## Boundaries

The feature is split into four owners:

1. `profile-health` domain modules own types, normalization, target identity, prompt construction, continuity validation, presentation mapping, and CLI-session state transitions.
2. Electron main owns hidden monitored CLI orchestration, durable state updates, IPC, in-flight deduplication, Provider-session association, and normal terminal target association.
3. Local state owns durable health projections and rolling conversation checkpoints.
4. Renderer components own draft/manual interaction and compact presentation; they do not parse provider responses or classify errors.

## Target Identity

A health target is derived from:

- provider
- saved Profile key when available
- active channel ID
- normalized Base URL
- selected model ID

The API key is deliberately excluded from persisted identity and logs. A credential change invalidates health state through explicit Profile-save cleanup, not by hashing or storing the secret.

The target identity captured at monitored-terminal launch is retained by terminal session ID. Later channel/model changes do not redirect an already-running terminal's passive success to a different target.

## State Contract

`LocalState` gains a `profile_health_by_target` record. Each entry contains:

- target metadata without credentials
- status and reason code
- source: `active` or `passive`
- running flag
- latency and timestamps
- consecutive success count
- last failure summary/status code
- rolling validation checkpoint: sequence and carry word
- bounded previous assistant reply used to seed the next isolated CLI turn

Normalization treats missing/invalid fields as an empty record. Profile deletion and material Profile/channel/model/auth changes remove obsolete entries. Passive success updates status and timestamps but does not fabricate or advance the active rolling conversation checkpoint.

## Active Probe Flow

```text
Saved Profile + current channel + current model
  -> renderer IPC request
  -> Electron validates that the editor matches the saved target
  -> build normal LaunchRequest with terminal_mode=monitored
  -> first run: launch_mode=new + full journey prompt
  -> later runs: launch_mode=new + fixed rules + previous assistant reply + user input "继续"
  -> launchMonitoredTerminalSession(showWindow=false)
  -> lifecycle watcher resolves the Provider session JSONL
  -> authoritative turn_completed arrives
  -> readLastAssistantTextFromSessionFile extracts assistant text
  -> shared continuity validator classifies result
  -> save result/checkpoint/last assistant reply and close the hidden PTY
  -> IPC result/event updates current editor and list projection
```

The first CLI user prompt contains the complete Chinese micro-journey rules and initial state. Later turns create a fresh hidden CLI session whose prompt contains only the fixed rules, the previous assistant reply as the immediately preceding story state, and the literal user instruction `继续`. The validator requires N+1, use of the previous carry word in the body, and a new non-identical carry word. No turn includes assistant history older than the immediately previous reply.

## Hidden Monitored Session

- Reuse `prepareLaunchExecution`, `launchMonitoredTerminalSession`, terminal lifecycle watchers, `resolveMonitoredTerminalSessionFile`, and `readLastAssistantTextFromSessionFile`.
- Launch with `showWindow: false`; no BrowserWindow is created for the terminal.
- Codex can submit the initial prompt through the existing launch argument bridge. Claude uses the existing monitored-terminal input path after the prompt becomes ready.
- Every probe uses a new monitored CLI launch. The previous assistant reply is injected into the next prompt instead of resuming an ever-growing Provider session.
- Codex probes override `CODEX_HOME` with `<profile cwd>/.codedeck/profile-health/codex-home`. The generated standalone site-Profile config is written into that home before launch, and lifecycle/session resolution follows the overridden plan value. This override is health-only and does not move ordinary Codex sessions.
- Close the PTY after each result or failure so an idle health check consumes no long-lived CLI process.
- The implementation must not call Provider model endpoints with Electron `fetch`.

Only one CLI turn is submitted per manual action. Any retry is limited to reading a just-written JSONL assistant record; it must not submit a second model turn.

## Classification

- `available`: the health CLI turn completed and continuity validation succeeded, or an ordinary authoritative monitored turn completed.
- `degraded`: the health CLI turn completed and assistant text exists, but continuity/format validation failed.
- `rate_limited`, `auth_failed`, `model_unavailable`, `network_error`: classified from the CLI/session failure evidence already exposed by CodeDeck's monitored terminal and failure-keyword pipeline.
- `model_unavailable`: a completed lifecycle without readable assistant text after bounded JSONL read retries.
- `network_error`: health session startup, timeout, process exit, or lifecycle resolution failure when no more specific CLI evidence exists.
- `unknown`: no evidence yet.

Renderer labels are projections of these codes. Error bodies are summarized and bounded; secrets and request headers are never logged or persisted.

## UI

The Profile information channel row becomes a two-column layout:

- left: channel select plus add, rename, and delete icon buttons
- right: manual `检测渠道` action plus compact status/latency

Add/rename opens a temporary inline name editor below the row with confirm/cancel actions. A short detail line under the controls shows source, last validation time, consecutive successes, or the latest failure. The Profile list adds a small health indicator without replacing the existing balance badge.

Official native Profiles do not render the active test control. The button is disabled when the Profile is unsaved/dirty, URL/key/model/runtime command is incomplete, or the same target is running.

## Compatibility And Rollback

- Old `local_state.json` files load with an empty health record; states from the earlier Provider-session design ignore obsolete session IDs.
- No encrypted Profile schema migration is required.
- Removing the health session state and UI/IPC wiring restores the prior behavior without changing stored Profile credentials or normal CLI sessions.
- Existing balance and channel flows remain separate and retain their current contracts.
