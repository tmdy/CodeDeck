# Session Discovery Contract

## Scenario: Codex Sub-Agent Visibility

### 1. Scope / Trigger

- Trigger: Any change to session JSONL parsing, `ListSessionsRequest`, renderer session request builders, session cache identity, or `SessionCatalog` filtering/pagination.
- Applies to both user-facing consumers of `session:list`: the Sessions page and the Profile resume-session picker.
- Claude discovery is separate: its collector does not recursively enter `<main-session-id>/subagents/`.

### 2. Signatures

```ts
interface GlobalSettings {
  hide_codex_subagent_sessions: boolean;
}

interface ListSessionsRequest {
  provider: string;
  scope: "project" | "global_recent";
  hide_subagent_sessions?: boolean;
}

interface SessionSummary {
  is_subagent?: boolean;
}
```

`SessionCatalog.createPage(request, codexHomes, fastSessions)` remains the final filtering and pagination boundary.

### 3. Contracts

- `defaultGlobalSettings()` and legacy/malformed state normalization set `hide_codex_subagent_sessions` to `true`. Only an explicit boolean `false` disables it.
- Codex session parsing sets `is_subagent: true` only when `session_meta.payload.source` owns a `subagent` field. Its value may be a string or object.
- Do not infer sub-agent status from `parent_thread_id`, filenames, directory names, session IDs, or preview text.
- Full parsers, fast parsers, summary projection, index fallback, multi-home merge, and stored catalog entries must preserve `is_subagent`.
- When hidden mode is requested, fast index loading must inspect JSONL metadata and collect enough non-sub-agent candidates to fill the requested page. It retains marked candidates because the catalog performs the final filter.
- `SessionCatalog.createPage()` filters marked Codex sub-agents before deduplication, cursor pagination, `next_cursor`, and `has_more` calculation. It never removes them from the stored snapshot.
- Claude results ignore `hide_subagent_sessions`, even if a caller supplies it.
- Request equality and renderer/main-process cache keys include the normalized hidden mode.
- Changing the stored summary schema requires incrementing `CATALOG_VERSION` so old snapshots rebuild from source JSONL.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Setting missing or not boolean | Normalize to `true` |
| `source.subagent` exists with string/object value | Set `is_subagent: true` |
| `parent_thread_id` exists without `source.subagent` | Treat as a normal session |
| Codex request has `hide_subagent_sessions: true` | Exclude marked entries before pagination |
| Codex request omits the field or sets `false` | Return normal and sub-agent entries |
| Claude request sets the field | Do not filter Claude entries |
| Catalog snapshot version is stale | Ignore snapshot and rebuild; do not mutate source files |

No new user-facing error is introduced. A malformed or unreadable individual JSONL file follows the existing skip-and-continue behavior.

### 5. Good / Base / Bad Cases

- Good: Two hidden entries occur among the newest four records and `limit` is two; return the two newest eligible normal sessions with a cursor based on the second eligible session.
- Base: Hidden mode is false; return sub-agent sessions in normal chronological order.
- Bad: Slice the raw list to `limit` and then filter sub-agents. This returns short pages and produces invalid `has_more`/cursor behavior.
- Bad: Drop sub-agent entries during scanning. The user cannot reveal them immediately after disabling the setting.

### 6. Tests Required

- Settings: default, legacy missing value, malformed value, explicit false persistence, and checkbox callback.
- Parser: ordinary Codex metadata plus string and object `source.subagent` values through full and fast paths.
- Index paths: complete `session_index.jsonl` entries in global and project scopes collect enough classified candidates in hidden mode.
- Catalog: hidden/visible modes, filtering before pagination, cursor/`has_more`, Claude non-filtering, and stale snapshot invalidation.
- Caches: otherwise-identical hidden and visible requests produce distinct renderer and Electron cache identities.
- App: both Profile and Sessions request builders send the normalized Codex mode; Claude requests remain unaffected.

### 7. Wrong vs Correct

#### Wrong

```ts
const page = paginatedSessions(entries, request)
  .filter((session) => !session.is_subagent);
```

#### Correct

```ts
const eligible = entries.filter((session) => !(
  provider === "codex"
  && request.hide_subagent_sessions === true
  && session.is_subagent === true
));
const page = paginatedSessions(eligible, request);
```

The correct order keeps visible page size, cursors, and `has_more` consistent while retaining all catalog data for reversible display filtering.

## Scenario: Shared Canonical Codex Home

### 1. Scope / Trigger

- Trigger: Any change to Codex launch environment, site Profile generation, session Home discovery/detail, resume validation, catalog source identity, capability overlays, or Codex permission UI.
- CodeDeck and direct Codex share one state root. The default canonical root is `path.join(os.homedir(), ".codex")`.
- Legacy `app-data/codex-runtime/home` data is migration input only. Normal product paths must not read, list, copy, restore, modify, or delete it.

### 2. Signatures

```ts
function resolveCanonicalCodexHome(homeDirectory?: string): string;

interface CodexSessionHome {
  kind: "app_runtime" | "global_codex";
  home: string;
}

interface CodexConfigWritePlan {
  profilePath: string;      // canonical Home
  configFilePath: string;   // <Home>/site-<hash>.config.toml
  profileName: string;      // site-<hash>
  content: string;
  authCommand: string;
}
```

Normal discovery supplies exactly one Home:

```ts
[{ kind: "global_codex", home: resolveCanonicalCodexHome() }]
```

### 3. Contracts

- Native and site launches set `CODEX_HOME` to the same canonical Home.
- Site launches add `--profile site-<hash>` and use the provider's `auth.command`; they do not inject API keys into the child environment. Secret values never appear in TOML.
- Profile writes own `<Home>/site-<hash>.config.toml`. CodeDeck may also atomically replace only the provider registry between `# BEGIN CODEDECK MANAGED SITE PROVIDERS` and `# END CODEDECK MANAGED SITE PROVIDERS` at the start of `<Home>/config.toml`; every byte outside that block remains user-owned and unchanged.
- The managed registry contains only stable provider IDs, display names, base URLs, wire APIs, and the packaged `codedeck-agent auth-token --provider <id>` command. It never contains tokens, models, MCP, Plugins, Projects, Skills, or permission settings.
- A same-ID provider table outside the managed block is a `provider_conflict`; CodeDeck preserves the previous file instead of overwriting the user definition.
- Resume validates the session in canonical Home and uses the original session ID in place. It does not copy JSONL files or append copied index records.
- Codex detail lookup ignores caller-provided `source_home`, returns `source_kind: "global_codex"`, and reads canonical Home only.
- `app_runtime` remains in compatibility types for stored favorites/migration tooling, but normal launch rejects it and normal UI hides legacy Codex favorites with that source.
- Catalog snapshots store source identity, filter Codex entries against the active singleton Home, and require a version bump whenever stored source/schema semantics change.
- When the capability source and profile Home are the same canonical path, the Codex overlay is an empty no-op. Codex uses capabilities already present in the shared Home.
- Global Codex Git-push/dangerous-delete rules and site-specific global Worker Agent rewrites are forbidden. Claude permission behavior remains independent.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|-----------|-------------------|
| Canonical session exists | Resume the same session ID without filesystem transfer |
| Session is absent from canonical Home | Fail with an actionable global-Home not-found error |
| Resume source is `app_runtime` | Reject it even if a session with the same ID exists globally |
| Caller supplies stale/non-canonical `source_home` | Ignore it for Codex detail lookup |
| Old catalog snapshot version is loaded | Rebuild from active sources; never import Runtime summaries |
| Site Profile write fails | Preserve the prior Profile and user base config |
| Managed registry write fails | Preserve the prior `config.toml` atomically |
| Same provider ID exists outside the managed block | Fail with `provider_conflict`; do not modify the file |
| Capability source equals target Home | Return an empty overlay; create no self-links/copies |
| Another Codex client owns the thread writer | Preserve the CLI failure and show an actionable exit-and-retry message; do not kill the owner, edit lock state, or claim takeover support |

### 5. Good / Base / Bad Cases

- Good: Direct Codex creates a session under `~/.codex`; CodeDeck lists it as `global_codex` and resumes the same ID through a site Profile without creating another JSONL.
- Base: CodeDeck starts a new site session with `CODEX_HOME=~/.codex` and `--profile site-<hash>`; direct Codex can later discover it through `resume --all`.
- Bad: Scan both App Runtime and user Home, then copy a selected global transcript into Runtime before launch.
- Bad: Merge site MCP blocks into user `config.toml`, or write a site model into a global Worker Agent.
- Bad: Self-link `~/.codex/skills` or plugin cache back into the same `~/.codex` tree.

### 6. Tests Required

- Launch: native and site plans use the canonical Home; native resume adds the current effective provider override, while site plans keep `--profile` and command authentication without secret environment variables.
- Profile writer: the CodeDeck-owned site Profile and marked provider registry use the same `auth.command`; unrelated `config.toml` bytes remain equivalent; conflicts and failed writes leave the previous file usable.
- Resume/detail: canonical session succeeds, missing session fails, `app_runtime` source fails, stale `source_home` cannot redirect lookup, and no transfer helper is called.
- Catalog/cache: stale snapshot version rebuilds; inactive Runtime entries are filtered before pagination; singleton Home is part of cache identity.
- UI/favorites: legacy Runtime favorites are not shown or launchable; global favorite keys retain source metadata compatibility.
- Capabilities/permissions: shared-Home Codex overlay is empty; Codex UI does not claim Git-push/delete enforcement or editable global Worker-model override; Claude tests remain unchanged.

### 7. Wrong vs Correct

#### Wrong

```ts
const homes = [appRuntimeHome, globalHome];
await copyCodexSessionBetweenHomes({ sourceHome: globalHome, targetHome: appRuntimeHome, sessionId });
env.CODEX_HOME = appRuntimeHome;
```

#### Correct

```ts
const home = resolveCanonicalCodexHome();
const homes: CodexSessionHome[] = [{ kind: "global_codex", home }];
env.CODEX_HOME = home;
args.push("--profile", buildCodexSiteProfileName(profileId));
```

The Profile isolates site configuration; the Home intentionally does not isolate session state.

## Scenario: Official Resume Of Cross-Provider Encrypted Reasoning

### 1. Scope / Trigger
- Only an official native Codex Profile with an explicit `resume_selected` UUID runs this preparation. New launches, site Profiles, CLI pickers, and `continue_last` do not mutate replay history.
- A provider override fixes routing; it does not make another provider's opaque reasoning decryptable. Bootstrap success alone is insufficient acceptance.

### 2. Signatures
- `prepareCodexProviderResumeRepair({ filePath, sessionId, targetProvider }): Promise<CodexProviderResumeRepairPlan | null>` is read-only.
- `appendCodexResumeRepairExclusively(plan, recoveryDirectory): Promise<void>` commits the checkpoint.

### 3. Contracts
- Preserve the UUID and every original rollout byte. Append a checkpoint only when active replay contains encrypted reasoning from a different provider.
- Preserve visible messages, tool calls/results, aligned item metadata, pagination window IDs, retained/guardian state, and current world/turn/control state. Never guess unsupported replay reducers.
- Track provider ownership and the repair marker so later reasoning generated by the target provider remains intact.
- The Windows writer verifies length and SHA256 on one FileStream denying other writers, then appends and flushes. It rolls back a failed write on the same handle; do not force-kill the helper mid-write.
- Recovery manifests contain original length/hash and append hash, without transcript content or credentials. The preserved prefix remains the recovery source.

### 4. Validation & Error Matrix
| Condition | Behavior |
| --- | --- |
| Same-provider reasoning or no incompatible reasoning | No append |
| File content changed, including equal-length changes | Reject without overwriting |
| Another writer holds an incompatible handle | Reject and ask to exit that conversation |
| Damaged tail, mismatched item metadata, unsupported rollback/inter-agent state | Reject without changing history |
| Cross-provider encrypted reasoning | Append a filtered checkpoint before launch |

### 5. Good / Base / Bad Cases
- Good: An official Profile continues a site conversation after preserving its visible context and removing only incompatible opaque reasoning from active replay.
- Base: A repaired thread generates new official reasoning; the next official resume leaves it intact.
- Bad: Repoint the provider and report success after bootstrap, while the next request still includes undecryptable site reasoning.

### 6. Tests Required
- Provider ownership, metadata alignment, paginated windows, world/control state, subsequent official reasoning, unsupported states, Unicode bytes, stale hashes, and real Windows lock conflict.
- A real official turn using a sanitized fixture matching the failing history must receive a completion event. Test fixtures must not append messages to the original conversation.

### 7. Wrong vs Correct
- Wrong: Rewrite the original transcript, discard tool results, or kill an unknown writer to force a repair.
- Correct: Prepare a narrowly filtered replay checkpoint, verify and append under an exclusive write handle, retain the original prefix, then resume the same UUID.

## Scenario: Monitored Codex Identity And Display Name

- Monitored Codex launches use a one-run `tui.terminal_title=['thread-id']` override through the shared command builder. The TOML literal string avoids embedded double quotes being corrupted by the Windows cmd/npm shim chain; test the actual launch chain, not only direct exe argv. Direct and Claude launches do not receive it; global config and notify stay user-owned.
- Resolve identity from the current PTY's complete OSC frame or an explicitly selected resume UUID. Validate against `session_meta.payload.id` in the launch plan's actual CODEX_HOME, including dedicated health-probe homes. A filename, cwd, recent timestamp, or display name is insufficient identity evidence.
- Codex 0.160.1 emits a 29-character UUID prefix followed by `...`, optionally with a known title-generation spinner. Save this hint while metadata has not yet appeared; zero or multiple verified UUID candidates stay pending.
- Identity uniqueness does not prove lifecycle source uniqueness. Same-UUID copies require separately verified source selection; static copies must not dispatch events, and unresolved competing writers remain pending with diagnostics.
- Bind lifecycle independently of a nonempty display title. Retry a temporarily missing session file, continue synchronizing names after initial binding, and release watchers/timers on exit or explicit PTY thread switch.
- Merge append-only session-index records by UUID using the last valid nonempty name. Malformed or incomplete records preserve the previous name. Recent JSONL metadata may supplement an indexed summary but must not overwrite its confirmed name.
- Regression checks cover chunked OSC framing, pending metadata, invalid/ambiguous identities, duplicate source files, same-directory concurrent terminals, append rename, malformed tails, and identity available before title generation.

## 场景：Main 会话页缓存的容量与失效

### 1. 范围与触发

修改 `createSessionListCache` 或会话页请求时，保持缓存可回收、数据可重新加载，不把页缓存当作持久化历史。

### 2. 接口

`run({ request, codexHomes, load }): Promise<SessionSummary[]>`；`invalidate(provider?: string): void`。

### 3. 契约

- 保留缓存工厂默认 5 秒新鲜度；Electron 单例通过 `ttlMs: 60_000` 使用 60 秒。本次容量约束不改变调用方的新鲜度、原请求/Home 身份及相同 key 的 inflight 合并。
- 完成页最多保留 64 页，命中更新 LRU 顺序；访问时惰性移除所有过期页，无新增后台 timer。
- `invalidate` 后，旧 Promise 可以正常返回给原调用者，但不能写回缓存，也不能删除更新请求的 inflight 条目。
- 淘汰仅释放缓存所有权，不修改源 JSONL、catalog、已返回的数组或 Renderer 当前页。

### 4. 验证与错误矩阵

| 条件 | 结果 |
| --- | --- |
| 第 65 个不同 key 完成 | 淘汰最久未访问页；热页仍命中 |
| 访问其他 key 时发现过期页 | 移除过期页，无定时轮询 |
| 加载期间失效并重新请求 | 两个调用各自得到结果，只有新请求写入缓存 |
| load 失败 | 错误传递给调用者，清理对应 inflight，可重试 |

### 5. 正常、基础与错误案例

- 正常：反复切换 Profile、cwd、分页，完成页保留量不超过 64。
- 基础：5 秒内重复访问同一页复用结果。
- 错误：只检查当前 key 的过期时间，让从不再访问的旧页一直驻留。

### 6. 必需验证

`session-list-cache.test.ts` 与 `session-list-cache-capacity.test.ts` 覆盖请求隔离、去重、过期、LRU、失效后的迟到 Promise。容量验证不依赖 GC 或操作系统工作集下降。

### 7. 错误与正确实现

- 错误：任何 load 完成都无条件 `cache.set(key, sessions)`。
- 正确：先验证 `inflight.get(key)?.promise === promise`，再写入并按 LRU 淘汰超额页。
