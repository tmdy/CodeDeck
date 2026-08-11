# Implementation Plan

1. Extend `GlobalSettings` defaults and normalization with `hide_codex_subagent_sessions`, then add focused tests for fresh defaults, legacy-state fallback, malformed values, and explicit `false` persistence.
2. Extend session request/summary contracts and add a shared Codex `source.subagent` classifier. Preserve the marker through full/fast parsing and summary projection, with fixtures covering ordinary sessions plus string and object marker values.
3. Retain all entries in `SessionCatalog`, increment its snapshot version, and filter marked Codex sub-agents before deduplication/pagination when requested. Test hidden/visible modes, page filling, cursor/`has_more`, Claude isolation, and old snapshot invalidation.
4. Add the filter mode to renderer request equality, Profile cache keys, reusable cache keys, and the Electron session-list cache key. Verify hidden and visible requests cannot share cached or in-flight results.
5. Add the checked-by-default global-settings checkbox and thread the normalized value into both Profile and Sessions request builders for Codex only. Update effect dependencies and component/App assertions so toggling the saved setting reloads both views with the correct request.
6. Run focused Vitest files while iterating, then run `npm test` and `npm run typecheck`. Inspect the final diff around pre-existing edits before the Trellis quality gate.

## Validation Commands

```powershell
npx vitest run "src/shared/__tests__/components/global-settings-panel.test.tsx" "src/shared/__tests__/state/store.test.ts" "src/shared/__tests__/services/session-service.test.ts" "src/shared/__tests__/electron/session-catalog.test.ts" "src/shared/__tests__/electron/session-list-cache.test.ts" "src/shared/__tests__/components/app-session-history-provider-race.test.tsx"
npm test
npm run typecheck
```

## Risk and Rollback Points

- `src/App.tsx` and related Electron files already contain unrelated working-tree edits; preserve and test around them rather than replacing broad sections.
- A marker dropped by `sessionSummaryFromFileSummary()` or a merge path would make catalog filtering incomplete. Parser and catalog tests must exercise the complete scan-to-page path.
- Filtering after pagination would produce short pages and incorrect cursors. Catalog tests must place hidden entries inside the first raw page and assert a full eligible page.
- Missing the new field in any request identity/cache key can produce stale UI after toggling the setting. Tests must compare otherwise-identical hidden and visible requests.
- Do not add file deletion, catalog pruning, or a new IPC endpoint; rollback remains code-only because no session source data is mutated.
