# Codex Project Trust CLI Research

## Official Contract

- OpenAI Codex advanced configuration documents `-c` / `--config` as arbitrary configuration overrides for a single CLI run.
- Override values are parsed as TOML and dotted keys address nested values.
- The configuration reference defines `projects.<path>.trust_level` with values `"trusted"` and `"untrusted"` in persistent TOML.
- A trusted project may load project-scoped `.codex` configuration, hooks and rules; an untrusted project skips those layers.
- The sample configuration represents the persistent form as `[projects."/absolute/path/to/project"]` followed by `trust_level = "trusted"`.

Official sources:

- https://developers.openai.com/codex/config-file/config-advanced
- https://developers.openai.com/codex/config-file/config-reference
- https://developers.openai.com/codex/config-file/config-sample

## Local CLI Compatibility Probe

The installed CLI reports `codex-cli 0.147.0`. Its `-c` dotted-key parser does not interpret a quoted path segment as the intended project key. The one-run override must therefore use an entirely unquoted key and value:

```powershell
codex -c 'projects.D:\CodeDeck.trust_level=trusted' features list
```

The override remains one argv token after `-c`; shell preview quoting for a path containing spaces is display syntax and is not part of that argv value. On Windows the project key must use native backslashes so it exactly matches the current directory representation used by the trust lookup.

`features list` only proves that the override parser accepts the token. It does not prove that the resulting project key matches the active working directory. The acceptance probe must launch the real TUI through Agent Bridge and verify that it proceeds past the directory trust page without input.

## Repository Findings

- `LaunchService` already owns native and managed Codex command construction.
- Desktop `launcher:launch` and Electron `launchAgentTask()` both reach that service.
- `buildCodexArgs()` currently parses user extra-argument text and then appends `--disable hooks`.
- `parseCliArgs()` treats backslash as an escape outside single quotes, so a generated Windows TOML path must not be routed through unstructured user extra-argument text.
- `JSON.stringify(path)` produces a quoted dotted-key segment that Codex 0.147.0 does not resolve as the intended project path. The structured token must be `projects.${nativeWindowsPath}.trust_level=trusted`, contain no `"` characters, and use backslashes for Windows paths.
- Existing task-manager trust-prompt handling can remain as a compatibility fallback without being the normal launch path.

## Packaged Agent Bridge Verification

The first packaged probe emitted the syntactically valid but semantically
mismatched token `projects.D:/CodeDeck.trust_level=trusted`. Codex displayed its
current directory as `D:\CodeDeck` and entered the directory trust page, proving
that parser acceptance was insufficient.

After normalizing Windows separators in the command builder, packaged session
`a416cd61-9928-42d8-8e6f-3d7aa17f92de` launched with:

```text
-c model_reasoning_effort=low
-c projects.D:\CodeDeck.trust_level=trusted
--disable hooks
```

Bridge polling remained `running` with `question=null` and then reached
`completed` with `assistant_text=TRUST_OK`. No trust input was submitted. The
test session was cancelled after completion, and Bridge capacity returned to
`running: 0 / limit: 4`.
