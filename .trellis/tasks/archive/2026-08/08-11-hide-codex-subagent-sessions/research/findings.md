# Research Findings

## Storage Behavior

### Claude

Claude sub-agents are stored below a main-session directory such as `<main-session-id>/subagents/agent-*.jsonl`, and observed records contain `isSidechain: true`. `collectClaudeCandidateFiles()` reads only project-root JSONL files plus direct files in the legacy `sessions/` directory; it does not recursively enter `subagents/` (`src/shared/services/session-service.ts:539`). Current behavior therefore does not surface Claude sub-agents in CodeDeck session lists.

### Codex

Codex normal and sub-agent sessions share the recursively walked `sessions/` tree (`src/shared/services/session-service.ts:511`). The stable discriminator in observed files is the presence of `session_meta.payload.source.subagent`. Observed values include `memory_consolidation`, `review`, `{ "other": "guardian" }`, and `{ "thread_spawn": { ... } }`. `parent_thread_id` is not sufficient because related user-created threads can also have parents.

The fast and full Codex summarizers already parse `session_meta.payload` but currently discard `source` (`src/shared/services/session-service.ts:805`, `src/shared/services/session-service.ts:894`). The summary projection helper explicitly selects fields and would also drop a new marker unless updated (`src/shared/services/session-service.ts:589`).

## Listing and Pagination

Both UI entry points call the `session:list` IPC handler (`electron/main.ts:3531`). The handler obtains a fast provider list, merges it into the persistent `SessionCatalog`, and calls `SessionCatalog.createPage()`.

The catalog's Codex background build recursively scans every JSONL file (`src/shared/services/session-service.ts:1263`). `createPage()` currently filters by provider and optional project cwd, then deduplicates and paginates (`src/shared/electron/session-catalog.ts:373`). A sub-agent predicate must run before pagination and cursor/`has_more` calculation.

The catalog snapshot schema version is currently 1 (`src/shared/electron/session-catalog.ts:17`). Existing snapshots cannot reliably distinguish sub-agents, so the version must be incremented to trigger an automatic source rebuild.

## Settings and Caches

`GlobalSettings` is defaulted and normalized centrally (`src/shared/profile/types.ts:97`, `src/shared/profile/types.ts:330`, `src/shared/profile/types.ts:441`). The settings panel already emits partial updates and participates in the existing save/cancel flow (`src/components/settings/GlobalSettingsPanel.tsx:14`).

The Profile resume-session request is built at `src/App.tsx:2185`; the Sessions history request is built at `src/App.tsx:2563`. Request equality and renderer cache identities are defined at `src/App.tsx:450`, `src/App.tsx:510`, and `src/App.tsx:523`. The Electron cache has a separate normalized key at `src/shared/electron/session-list-cache.ts:39`. All identities must include the filter mode, and request-producing effects must depend on it (`src/App.tsx:750`, `src/App.tsx:2896`).

## Decision

Implement a Codex-only global display filter, defaulted on, using the explicit metadata marker and catalog-time pre-pagination filtering. Keep all source files and catalog entries so disabling the setting restores visibility immediately. No Claude setting or scanner change is warranted.
