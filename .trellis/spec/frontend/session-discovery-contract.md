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
