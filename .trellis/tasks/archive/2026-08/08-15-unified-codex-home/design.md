# Technical design: single user Codex Home

## 1. Architecture decision

Use one canonical Codex state root for this feature:

```text
CodeDeck / direct Codex
          │
          └── C:\Users\<user>\.codex\
              ├── sessions/
              ├── session_index.jsonl
              ├── history.jsonl
              ├── config.toml
              └── site-<hash>.config.toml
```

The canonical path is `path.join(os.homedir(), ".codex")`; this task does not add a custom-path setting or a second persistent state root.

`--profile site-<hash>` remains the only site-specific isolation mechanism. It changes provider/model/config precedence while preserving the same session files.

Old `app-data/codex-runtime/home` is outside the active source set. It is not read, migrated, modified, deleted, or shown by the UI in this task.

## 2. Data flow and boundaries

```text
Profile selection
  → canonical Codex Home resolver
  → profile writer (site-<hash>.config.toml only)
  → LaunchService (CODEX_HOME=canonical home, optional --profile)
  → Codex CLI reads/writes canonical sessions

Session:list/detail
  → canonical home only
  → session parser/catalog/cache
  → renderer picker/list
```

Boundary ownership:

- `ModelMappingConfigService` owns CodeDeck model-mapping state and CodeDeck-owned site Profile files, but never rewrites unrelated user config.
- `LaunchService` owns command arguments and child-process environment.
- `session-service` owns Codex JSONL parsing; it no longer owns normal launch-time transfer.
- `SessionCatalog` and `session-list-cache` receive a singleton `global_codex` source and must invalidate old dual-home snapshots.
- Renderer state may retain `source_kind: "global_codex"` / `source_home` for favorite and UI compatibility, but never accepts an App Runtime source from normal discovery.

## 3. Configuration and ownership

### 3.1 Canonical Home

Add one shared resolver or constructor option used by Electron, `LaunchService`, `ModelMappingConfigService`, and session loading. Do not derive it from `appDataRoot/codex-runtime/home`.

`ensureCodexRuntimeHome()` may be renamed to `ensureCodexHome()`; if retained for compatibility, it must only create the directory and must not call `migrateCodexProfileHistories()`.

### 3.2 Site Profiles

Write `site-<hash>.config.toml` beneath the canonical home. The writer must:

- preserve the existing `config.toml` byte/content semantics outside CodeDeck-owned blocks;
- stop removing all legacy `[profiles.*]` blocks from the user file;
- stop merging copied global MCP/Plugin blocks into the base file;
- retain provider/model/sandbox/approval settings in the site Profile;
- keep API keys as child-process environment variables only;
- use atomic write plus existing backup behavior for CodeDeck-owned files.

### 3.3 Permissions and worker Agent

The shared-home implementation must not write `rules/managed-permissions.rules`, because that file is global to Codex Home. Codex-specific `denyGitPush` and `denyDangerousDelete` enforcement is intentionally removed in this phase. Existing Claude settings generation remains unchanged.

The generated CodeDeck worker Agent must not be rewritten globally with a site-specific model. Prefer a Profile-scoped Agent declaration or a CodeDeck-owned external config path if the installed Codex version supports it. If no safe Profile-scoped mechanism exists, disable only the Codex worker-model override in shared-home mode and surface that limitation in the launch summary; do not leak a site model into direct Codex.

## 4. Session discovery and resume

- `resolveCodexSessionHomes()` returns exactly one `{ kind: "global_codex", home: canonicalHome }`.
- `listCodexSessionsFromHomes()` may remain as a generic helper, but normal IPC passes one home.
- `getCodexSessionDetail()` ignores caller-supplied legacy `source_home` for Codex and resolves only against canonical Home.
- Remove `synchronizeCodexSessionForLaunch()` from the normal launch path and remove calls to `copyCodexSessionBetweenHomes()` during resume.
- Keep `source_kind: "global_codex"` in summaries to preserve favorite keys, pagination ordering, and current source labels.
- Any stale App Runtime selection fails as “session not found in the global Codex Home”; it must not fall back to copying.

## 5. Cache and state compatibility

- Increment the session catalog version or change its file name so old dual-home snapshots rebuild.
- Include the singleton canonical Home in cache identity; invalidate Codex cache after profile/home changes.
- Normalize existing favorite records toward the canonical `global_codex` identity without touching session files.
- Do not import old Runtime summaries into the new catalog snapshot.

## 6. Capability inheritance

When `codexHome` and `profileHome` resolve to the same canonical path:

- consume global MCP/Plugins/Skills from their existing locations;
- skip self-link/copy operations in `CapabilityOverlayService.prepareCodexOverlay()`;
- keep the overlay manifest only if needed for diagnostics, otherwise return an empty link plan;
- leave Claude overlay behavior unchanged.

## 7. Error and rollback behavior

- Missing/unreadable canonical Home follows existing skip/error behavior; no fallback to App Runtime.
- Existing App Runtime files remain untouched and can be used by a later migration task.
- Profile write failures must leave the prior site Profile and user base config intact.
- A stale session ID returns a user-visible “not found in global Codex Home” error.

## 8. Compatibility trade-offs

- Existing App Runtime sessions are intentionally unavailable until a later migration task.
- Codex deny-Git-push and deny-dangerous-delete protections are intentionally dropped to avoid global rule leakage.
- `source_kind` remains in the data contract temporarily to avoid breaking favorites/UI; the active value is always `global_codex`.
- Claude remains on its existing isolated settings and permission path.
