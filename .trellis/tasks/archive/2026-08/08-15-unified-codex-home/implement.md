# Implementation plan

## Phase A — Canonical Home and launch wiring

1. Add a single canonical Codex Home resolver (default `os.homedir()/.codex`) and inject it into Electron, `LaunchService`, `ModelMappingConfigService`, and session services.
2. Change native and site Codex launch plans to set `CODEX_HOME` to the canonical Home.
3. Keep `--profile site-<hash>` and per-site API-key environment variables unchanged.
4. Make Home initialization directory-only; remove the automatic legacy profile-history/session migration call.

## Phase B — Safe Profile/config writes

5. Change Profile writing to create/update only CodeDeck-owned `site-<hash>.config.toml` files under the canonical Home.
6. Stop cleaning unrelated user base-config Profile/Provider blocks and stop merging copied global MCP/Plugin blocks into `config.toml`.
7. Remove Codex writes of global `rules/managed-permissions.rules`; remove Codex-specific deny-Git-push and deny-dangerous-delete generation while preserving Claude behavior.
8. Ensure any generated Codex worker Agent is Profile-scoped or disable only the unsafe site-specific override; never rewrite a global Agent with a site model.
9. Add ownership-safe backups/atomic writes and tests that prove unrelated user config remains byte-equivalent.

## Phase C — Singleton session discovery

10. Make `resolveCodexSessionHomes()` return only the canonical `global_codex` home.
11. Remove normal launch-time `synchronizeCodexSessionForLaunch()` and all resume-time cross-home copying/index appends.
12. Make Codex detail resolution ignore stale/non-canonical `source_home` values and read only canonical Home.
13. Keep `source_kind: global_codex` compatibility fields, but prevent App Runtime entries from entering the session catalog or renderer pickers.
14. Bump/invalidate catalog and list-cache identity so old dual-home snapshots cannot reappear; normalize Codex favorites as needed.

## Phase D — Capability and UI compatibility

15. Skip Codex capability self-links/copies when source and target resolve to the canonical Home; keep Claude overlays unchanged.
16. Update source labels/empty-state/error handling so stale App Runtime session IDs are reported as unavailable rather than copied.
17. Update settings/launch summaries and tests so Codex no longer claims Git push/dangerous-delete enforcement.

## Phase E — Tests and quality gate

18. Update/add unit tests for launch env/profile paths, safe config ownership, no migration, no copy-on-resume, singleton discovery, cache/catalog/favorites, capability no-op, and stale Runtime invisibility.
19. Run focused Vitest suites for launch/session/model-mapping/capability/catalog/renderer session components.
20. Run `npm test`, `npm run typecheck`, and `npm run build`.
21. Search for remaining `codex-runtime`, `app_runtime`, `copyCodexSessionBetweenHomes`, and Codex global rules writes in active code paths; classify intentional migration-only leftovers.

## Risky files and rollback points

- `electron/main.ts`: Home resolution, IPC list/detail, and launch synchronization removal. Rollback point: restore singleton resolver/list handlers.
- `src/shared/services/launch-service.ts`: child environment, Profile config payload, worker/rule removal. Rollback point: restore old plan generation without touching user data.
- `src/shared/services/model-mapping-config-service.ts`: writes into user `.codex`; require atomic backups and tests against a fixture base config before enabling.
- `src/shared/services/session-service.ts`: source/detail contracts and transfer helper removal. Do not delete old Runtime files.
- `src/shared/electron/session-catalog.ts`, `session-list-cache.ts`, `src/shared/state/local-state.ts`, `src/App.tsx`, and session picker/list components: compatibility and cache identity.
- `src/shared/services/capability-overlay-service.ts`: skip only Codex self-copy; preserve Claude paths.

## Validation evidence required before `task.py start`

- Design and PRD reviewed by the user.
- No unresolved product/scope questions.
- `implement.jsonl` and `check.jsonl` contain real spec/research entries.
- No implementation begins until the user explicitly approves the final planning summary.
