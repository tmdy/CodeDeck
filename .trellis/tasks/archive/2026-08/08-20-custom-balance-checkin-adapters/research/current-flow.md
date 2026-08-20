# Current balance/check-in flow research

## Existing ownership

- `src/shared/balance/site-balance-sessions.ts` owns persisted backend-account types, normalization, browser identity slots, and Profile-base-URL grouping.
- `src/shared/services/profile-service.ts:597` validates and persists backend accounts. Credential changes invalidate balance/check-in state and learned capability paths.
- `electron/main.ts:2576` resolves a Profile's saved account, obtains the browser request context when needed, then calls `BalanceService.query`.
- `electron/main.ts:3285` serializes check-in execution, obtains browser authentication, calls `CheckinService.checkin`, and opens `CheckinVerificationService` only for user-triggered verification.
- `src/shared/services/balance-service.ts:1151` owns automatic platform/response discovery. The old path can remain intact behind an early optional custom-rule branch.
- `src/shared/services/checkin-service.ts:106` owns standard API probing, nonce handling, response classification, diagnostics, and learned paths. Custom rules must not be inserted into its automatic endpoint candidate loop.
- `src/shared/electron/browser-account-session-manager.ts:887` binds browser account fetches to the exact saved `browser_origin`; cross-origin request support therefore needs a separate, explicit target-aware API rather than weakening `buildBoundFetch` globally.
- `src/shared/electron/checkin-verification-service.ts:185` owns the persistent/ephemeral verification window, native click trigger, polling, and CAPTCHA flow. It currently derives fixed URLs and text-based button matching.
- `src/components/profiles/SiteBalanceSessionPanel.tsx` is the existing backend-account configuration surface. Custom compatibility should stay collapsed/advanced so standard onboarding remains unchanged.

## Security constraints to preserve

- Browser Cookie values, short-lived Bearers, refresh tokens, SIDs, CAPTCHA answers, and full page content never cross renderer IPC or enter persisted rule data.
- Standard browser accounts keep exact backend identity verification and same-origin request rules.
- Custom page-session identity is explicitly user-confirmed and may execute only saved custom rules; it cannot enter automatic platform probing.
- Cross-origin account credential forwarding is denied unless the persisted authorization names the rule's exact current target origin. Changing the URL invalidates authorization.
- Browser element selection returns only a selector plus a short sanitized preview; it never returns `outerHTML`, form values, storage, headers, or cookies.
- Automatic check-in never opens a visible window. It may use a hidden sandboxed page and return `manual_required`; only a direct user action opens/focuses the verification page.

## Worktree note

The worktree already contains unrelated/uncommitted changes, including `src/App.tsx`, `electron/main.ts`, and `electron/preload.ts`. Implementation must patch only the relevant sections and preserve all existing edits.

