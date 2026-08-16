# Repository impact research

## Confirmed current behavior

- `electron/main.ts:1047-1059` resolves an App Runtime home, then adds the user global home as a second `CodexSessionHome` when the paths differ.
- `electron/main.ts:1062-1105` copies a selected non-runtime session into App Runtime before `resume_selected` launch.
- `electron/main.ts:4027-4055` passes the multi-home list into session cache/catalog and `listCodexSessionsFromHomes`.
- `electron/main.ts:4070-4080` resolves detail from the selected source home.
- `launch-service.ts:383-391` injects `CODEX_HOME` for native Codex; `launch-service.ts:481-560` injects the same Runtime path plus `--profile site-<hash>` for site launches.
- `model-mapping-config-service.ts:75-79` derives Runtime Home from `app-data`; `ensureCodexRuntimeHome()` currently calls `migrateCodexProfileHistories()` and copies legacy profile history/index/session files.
- `model-mapping-config-service.ts:117-156` writes base config, site profile config, global rules, and a global worker Agent beneath the selected Codex Home.
- `capability-overlay-service.ts:115-143` reads global Codex config and links/copies Skills and Plugins into the supplied profile home.
- `session-service.ts:1832-1899` owns the cross-home transfer API and appends copied session index records.
- `src/shared/electron/session-catalog.ts`, `src/shared/session-pagination.ts`, `src/shared/state/local-state.ts`, `src/App.tsx`, `SessionPicker.tsx`, and `SessionList.tsx` preserve/display `source_kind` and `source_home`; keeping the normalized value `global_codex` is the lowest-risk compatibility path for existing favorites and UI state.

## Required shared-home boundary

1. Resolve one explicit user home (`~/.codex` by default) for launch, list, detail, and profile writes. Do not derive the canonical path from the App Runtime directory.
2. Make `ensureCodexRuntimeHome()`/its replacement directory-only. It must not call legacy history migration or copy any `sessions`, `history`, or `session_index` files during this task.
3. Make normal Codex listing/detail use one `global_codex` source. Ignore App Runtime homes entirely; leave their files untouched for a later migration task.
4. Remove launch-time synchronization and the normal-path cross-home copy/index code. Keep transfer helpers only if a later migration task needs them, otherwise delete or isolate them from runtime launch.
5. Write only CodeDeck-owned `site-<hash>.config.toml` files to the shared home. Do not clean unrelated base config blocks or legacy profiles.
6. Do not write `rules/managed-permissions.rules` into shared Codex Home. The requested Codex deny-Git-push and deny-dangerous-delete behavior is intentionally removed; Claude's permission path is separate.
7. Do not expose a CodeDeck worker Agent globally with a model selected by another site. Prefer profile-scoped configuration or explicitly defer the worker mapping if the current Codex version cannot scope it; never let a site launch rewrite a global Agent for direct Codex.
8. When the supplied capability home is already the canonical global home, skip self-link/copy overlay work. Existing global MCP/Plugins/Skills should be consumed directly.

## State and compatibility implications

- Preserve `source_kind: "global_codex"` and the canonical `source_home` in session summaries so existing favorite identity and source labels remain stable while the source set becomes singleton.
- Bump or invalidate session catalog/cache state whose key currently includes both App Runtime and global homes; otherwise stale dual-home snapshots can surface old entries.
- Existing App Runtime sessions are intentionally not migrated, displayed, or resumable in this task. Their files remain untouched as rollback/migration input.
- A future migration must be a separate command/task with backups, ID/content conflict detection, and no silent overwrite.

## Validation targets

- Unit tests for home resolution, launch environment, profile writing without base-config cleanup, no history migration, singleton session listing/detail, cache/catalog identity, favorites, and ignored App Runtime files.
- Regression tests asserting no `copyCodexSessionBetweenHomes` call during `resume_selected` launches.
- `npm test`, `npm run typecheck`, and `npm run build` after implementation.
