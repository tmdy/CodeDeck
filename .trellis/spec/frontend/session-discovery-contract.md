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
  apiKeyEnv: string;
}
```

Normal discovery supplies exactly one Home:

```ts
[{ kind: "global_codex", home: resolveCanonicalCodexHome() }]
```

### 3. Contracts

- Native and site launches set `CODEX_HOME` to the same canonical Home.
- Site launches add `--profile site-<hash>` and inject the API key through the generated environment variable. Secret values never appear in TOML.
- Profile writes own only `<Home>/site-<hash>.config.toml`. They do not rewrite `<Home>/config.toml`, `rules/managed-permissions.rules`, global Agents, unrelated Profiles, Providers, MCP, Plugins, Projects, or Skills.
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
| Capability source equals target Home | Return an empty overlay; create no self-links/copies |

### 5. Good / Base / Bad Cases

- Good: Direct Codex creates a session under `~/.codex`; CodeDeck lists it as `global_codex` and resumes the same ID through a site Profile without creating another JSONL.
- Base: CodeDeck starts a new site session with `CODEX_HOME=~/.codex` and `--profile site-<hash>`; direct Codex can later discover it through `resume --all`.
- Bad: Scan both App Runtime and user Home, then copy a selected global transcript into Runtime before launch.
- Bad: Merge site MCP blocks into user `config.toml`, or write a site model into a global Worker Agent.
- Bad: Self-link `~/.codex/skills` or plugin cache back into the same `~/.codex` tree.

### 6. Tests Required

- Launch: native and site plans use the canonical Home; site plans keep `--profile` and secret env indirection.
- Profile writer: only the CodeDeck-owned site Profile changes; unrelated `config.toml` remains byte-equivalent; failed writes leave the previous file usable.
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
