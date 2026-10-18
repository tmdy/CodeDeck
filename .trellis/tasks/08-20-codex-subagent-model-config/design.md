# Technical Design

## Boundaries

Keep the existing `AdvancedModelMapping` profile contract and extend only the
Codex branch with a separate `subagentReasoningEffort` field. The existing
`reasoningEffort` remains the main Codex model setting.

The renderer owns editing controls. Profile normalization and editor-state
cloning/equality own round-trip persistence. `LaunchService` owns conversion
from the normalized Profile to per-process Codex CLI arguments.

## Data flow

```text
Profile JSON
  -> normalizeAdvancedModelMapping
  -> ProfileEditorDraft clone/equality
  -> ProfileEditForm controls
  -> saved Profile
  -> LaunchService
  -> buildCodexArgs/buildCodexCommand
  -> Codex process -c overrides
```

When `advancedModelMapping.enabled` is true, the Codex mapping values are
converted to CLI tokens. The values are appended to the existing `extraArgs`
pipeline so managed and native launches share the established parser and
preview formatting. No global file is written.

## Compatibility

- Existing profiles without `subagentReasoningEffort` normalize to an empty
  value.
- Existing `codex.reasoningEffort` remains unchanged and continues to control
  `model_reasoning_effort`.
- Existing `subagentTarget` values remain valid and become effective only when
  the mapping is enabled.
- Claude mapping behavior is untouched.

## Concurrency and rollback

The worktree is shared with another coding session. Before each edit, reread
the target file and only patch the smallest relevant region. Do not touch the
other session's dirty files. If a target file changes concurrently, stop and
reconcile from the fresh file contents before editing.

User requested no final test run in this turn, so verification is limited to
read-only diff/status inspection and explicit reporting of unrun tests.
