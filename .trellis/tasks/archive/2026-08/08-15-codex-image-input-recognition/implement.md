# Implementation Plan

1. Define a typed, discriminated Profile-browser target contract shared by renderer/preload/main.
2. Add runtime validation in Electron main and resolve default, saved-session, existing-slot, and pending-new targets to partitions without fallback on invalid input.
3. Add `prepare(baseUrl)` to `PendingBrowserAccountReferenceRegistry`, reusing the existing acquire/TTL/discard lifecycle.
4. Update `openProfileSiteBrowser()` to use the resolved partition while preserving navigation guards and sandbox settings.
5. Update `handleOpenBaseUrl()` to derive the target from `draftBalanceSessionSelection`, `draftBalanceSession.auth_kind`, and `draftBrowserSlotSelection`; reuse the same slot parser as the login action.
6. Add pending-registry tests for prepare/reuse, TTL reset, subsequent run consumption, and shutdown cleanup.
7. Add main/IPC or extracted partition-resolution tests for all target kinds, invalid slot/session rejection, and no silent default fallback.
8. Add renderer tests proving new/reused browser identity selections send the correct open target while auto/PAT remain default.
9. Run targeted tests, full related suites, and TypeScript checks.
10. Make new-session browser identity selection default to the lowest existing slot, with `new` only as the empty-list fallback; add renderer regression coverage for both cases and preserve explicit user choices.

## Validation Commands

- `npx vitest run src/shared/__tests__/electron/browser-account-pending-references.test.ts`
- `npx vitest run src/shared/__tests__/components/app-balance-session-save.test.tsx`
- `npm run typecheck`

## Risky Files / Rollback Points

- `src/App.tsx`: draft intent mapping must not change save or balance-test semantics.
- `electron/main.ts` and `electron/preload.ts`: IPC contract and partition selection must stay synchronized.
- `src/shared/electron/browser-account-pending-references.ts`: tentative partition cleanup and concurrent operation semantics.

Do not change legacy identity verification, copy browser storage between partitions, or revert unrelated active-task work.
