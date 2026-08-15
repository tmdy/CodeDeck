# Implementation Plan

1. Extend browser login task state so periodic and close-triggered probes are coalesced.
2. Refactor the login probe into a single awaitable verification path for modern and legacy modes.
3. Add exact-origin legacy candidate parsing for `localStorage.user.id/token` with `localStorage.uid` and Cookie/account-ID fallback.
4. Keep legacy Bearers only in manager runtime state and attach them only to account-origin identity/account requests.
5. Add hidden same-origin persistent-partition recovery for legacy accounts after app restart, followed by `/api/user/self` verification.
6. Make manual window close perform a final verified-login decision before cancellation.
7. Add sanitized browser-auth diagnostics for probe classification and cancellation reason.
8. Add a focused `ProfileService` method and typed IPC to bind an existing Profile to a saved site session.
9. Update the renderer login-success path to bind existing Profiles and reload canonical selection; preserve draft-only behavior for new Profiles.
10. Guard balance testing against an incomplete `new` session so it cannot normalize to API auto.
11. Preserve browser session reference fields when hydrating the selected session draft.
12. Add manager tests for legacy user/token parsing, UID/Cookie fallback, origin refusal, identity mismatch, secret non-disclosure, cold-start recovery, close-after-login success, true cancellation, probe coalescing, and late-result rejection.
13. Add service/IPC tests for URL-matched Profile binding and invalid binding rejection.
14. Add renderer tests proving successful browser login selects/binds the account and incomplete login blocks `balance:test`.
15. Run targeted Vitest suites, `npm run typecheck`, then the task quality check.
16. Keep browser `ManagementRequestContext.headers` authoritative in balance requests and prevent generic multi-vendor user-ID header expansion for browser contexts.
17. Add balance-service regression coverage proving a verified legacy browser context sends only its exact headers and succeeds without alias expansion.
18. Apply the same authoritative browser-context merge order to check-in status/action requests while preserving manual PAT/Cookie compatibility probing.
19. Add check-in regression coverage for exact browser headers, no UID aliases, and non-overridable Authorization.
20. Add strict-origin Sub2API `auth_user`/`auth_token` discovery and `/api/v1/auth/me` identity verification.
21. Keep Sub2API access/refresh credentials runtime-only and serialize refresh across concurrent or delayed 401 responses.
22. Route Sub2API balance/check-in requests through the authoritative browser management context.
23. Replace Profile external URL opening with an internal BrowserWindow that reuses the selected browser account partition.

## Validation Commands

- `npx vitest run src/shared/__tests__/electron/browser-account-session-manager.test.ts`
- `npx vitest run src/shared/__tests__/services/profile-service.test.ts`
- `npx vitest run src/shared/__tests__/components/app-balance-session-save.test.tsx`
- `npm run typecheck`

## Risky Files / Rollback Points

- `src/shared/electron/browser-account-session-manager.ts`: event ordering and late async completion.
- `electron/main.ts` and `electron/preload.ts`: IPC contract synchronization.
- `src/App.tsx`: interaction with unsaved Profile drafts and canonical refresh.
- `src/shared/services/profile-service.ts`: durable Profile binding validation.

Do not modify or revert unrelated current changes in `src/App.tsx` or `electron/main.ts`.
