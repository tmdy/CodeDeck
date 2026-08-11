# Technical Design

## Boundaries and Contracts

Add `hide_codex_subagent_sessions: boolean` to `GlobalSettings`. `defaultGlobalSettings()` sets it to `true`, and `normalizeGlobalSettings()` accepts only explicit booleans, falling back to `true` for legacy or malformed values. The existing global-settings draft/save pipeline remains the sole persistence mechanism.

Extend `ListSessionsRequest` with optional `hide_subagent_sessions?: boolean`. Renderer request builders set it from global settings only when the provider is Codex. Claude requests omit it. The optional request field keeps non-renderer callers source-compatible while the application always expresses the selected Codex mode.

Add internal optional metadata `is_subagent?: boolean` to `SessionSummary`. It is transport-compatible and not rendered directly. A shared Codex metadata helper examines `session_meta.payload.source` and returns true only when that object owns a `subagent` property, independent of whether the property's value is a string or nested object.

## Parsing and Catalog Data Flow

Both full and fast Codex JSONL summarizers use the shared helper while reading `session_meta`. The summary projection helper must preserve `is_subagent`, ensuring fallback scans, background catalog scans, and merged fast results retain the classification. Claude parsers never set the marker.

The catalog continues storing all sessions. `SessionCatalog.createPage()` first applies provider and project-scope filtering, then removes marked Codex sub-agents when `hide_subagent_sessions === true`, and only afterward deduplicates, sorts, paginates, derives the next cursor, and computes `has_more`. Keeping hidden entries in the snapshot allows toggling the setting off to reveal them immediately without rebuilding the catalog.

Increment the catalog snapshot schema version from 1 to 2. Existing snapshots do not contain `is_subagent`; invalidating them forces one background rebuild from the unchanged JSONL sources. The cache file path does not need to change because `ensureLoaded()` already rejects snapshots with a mismatched internal version.

## Renderer and Cache Flow

The Profile resume-session request and Sessions-page history request both derive `hide_subagent_sessions` from `state.global_settings.hide_codex_subagent_sessions` for Codex. The value becomes part of:

- `sameSessionRequest()` identity checks;
- Profile exact and reusable cache keys;
- the Electron session-list cache key;
- relevant `useMemo` and `useEffect` dependencies that initiate or reuse list requests.

This makes a checkbox change a new request identity and prevents a hidden-mode page from being reused in visible mode, or vice versa. Existing save/cancel semantics in the settings page remain unchanged.

## UI

Place a standard checkbox labeled `隐藏 Codex 子代理会话` in `GlobalSettingsPanel`, using the existing checkbox styling and disabled state. The checkbox directly emits a partial global-settings update. No Claude-specific control is added because current Claude discovery does not include its nested sub-agent files.

## Compatibility and Trade-offs

- Filtering only on an explicit metadata marker avoids false positives for forks and side conversations, at the cost of leaving unknown future Codex sub-agent formats visible until their metadata contract is understood.
- Filtering in the catalog page layer, rather than dropping files during scanning, adds one inexpensive predicate per entry and preserves instant reversibility.
- Optional internal fields avoid a new IPC channel or migration routine. The global setting still has a strict normalized default, so user-visible behavior is deterministic after upgrade.
- A one-time catalog rebuild is required after upgrading the snapshot schema. During the existing `building` state, fast indexed sessions can appear first; sub-agent files discovered by the background scan are classified before they are eligible for display.

## Rollback

The change is reversible by removing the setting, request field, marker propagation, and catalog predicate, then incrementing or invalidating the catalog version again if a downgraded snapshot could be reused. No user session data migration or restoration is required because source JSONL files are never changed.
