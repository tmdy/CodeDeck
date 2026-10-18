# CodeDeck check-in behavior and implementation seams

Inspected on 2026-09-12, repository HEAD `8ec9190`, with a pre-existing dirty worktree. These findings describe code inspection, not a live account check-in.

## Authentication and action routing

- `src/shared/services/checkin-service.ts:109-135`: the public `CheckinService.checkin` accepts the saved account and an optional verified `ManagementRequestContext`. Browser requests use that context's fetch and authoritative headers.
- `electron/main.ts:3613-3659`: normal browser-session accounts obtain that context before calling the check-in service. Deprecated manually pasted Cookie accounts instead produce `login_required`.
- `src/shared/services/checkin-service.ts:570-654`: normal discovery probes `GET /api/user/checkin?month=...`, then the corresponding action where appropriate.
- `src/shared/services/checkin-service.ts:656-690`: the `/api/user/sign_in` fallback is guarded by `!requestContext`, so browser-session accounts cannot reach it. It also passes no user ID to the raw legacy fallback. This is a concrete compatibility gap if an upstream requires sign_in; upstream research must establish applicability.
- `src/shared/services/checkin-service.ts:511-550`: learned management paths with a user ID still probe the generic checkin status endpoint first. A sign_in-specific strategy must not learn a path that next-day execution cannot reuse.
- `src/shared/services/checkin-service.ts:888-919`: generic result classification accepts any 2xx business success. A login or identity response must never be fed into this as evidence that a daily check-in succeeded.
- `src/shared/electron/checkin-verification-service.ts:524-570`: standard verification polls identity plus the generic checkin status endpoint; success requires a matching account ID and a checked-today status. An upstream without this status endpoint needs a bounded alternative before its verification window can complete reliably.

## Scheduling and persistent state

- `electron/main.ts:3452-3463`: auto-check-in is opt-in, skips `login_required`, and performs at most one automatic attempt per local day; today's satisfied accounts are skipped.
- `src/shared/services/checkin-scheduler.ts:14-24,74-102`: automatic work is delayed by 5-30 minutes after eligibility scheduling and re-evaluated at local-day rollover.
- `electron/main.ts:3761-3784`: result, trigger, last attempt, daily auto-attempt key, and successful day are persisted by account.
- `src/shared/checkin/types.ts:58-70,101-165`: existing states are sufficient for visible feedback; interrupted runs normalize to retryable failure on reload. Avoid introducing an independent failure flag that can drift from the authoritative result.

## UI gaps

- `src/App.tsx:782-808,4308-4317`: only the currently selected backend account's check-in state reaches the detail controls.
- `src/components/balance/BalanceTestButton.tsx:60-64,121-141`: failure badge and detail text already exist, but only in the selected account's detail view.
- `src/components/balance/BalanceTestButton.tsx:168-177,203-220`: `login_required` is collapsed into generic failure; `unsupported` is muted even when automatic check-in was requested. Manual verification is already warning-colored.
- `src/styles.css:2097-2109`: failure text uses the same muted color as help text, with no prominent surrounding state style.
- `src/components/profiles/ProfileListPanel.tsx:27-42`: list entries accept balance and health data, but no check-in state. The least surprising added visibility is a distinct check-in badge on the bound profile, keeping health and check-in meanings separate.

## Existing validation seams

1. `CheckinService.checkin`: observable result plus request transport at the HTTP boundary; use upstream response examples as independent fixtures.
2. `CheckinVerificationService.openVerification`: account identity, bounded completion/cancellation, and actual check-in proof.
3. Rendered profile-list/detail controls: visible status, accessible text, recovery action, and failure-to-success re-render behavior.
4. Existing check-in state/scheduler/IPC tests: preserve account binding, daily eligibility, and persisted failure visibility where changed.

Use small test-first vertical slices at these public seams. No tests against private helpers, no bulk speculative test suite, and no credentials in fixtures.

## Scope and worktree constraints

- Existing unrelated changes include `electron/main.ts`, `ProfileEditForm.tsx`, profile types, launch/terminal/agent bridge modules, and tests. Their presence was recorded with `git status --short`; they must not be reset or staged.
- Implementation should normally fit check-in service, verification handling if required, check-in presentation, relevant list/detail wiring, CSS, and focused existing tests.
- Follow `.trellis/spec/frontend/management-auth-contract.md`: exact-origin requests, Chromium-owned cookies, no generic aliases in verified browser context, no background login windows, no credential export or rotation.
- Preserve opt-in custom rules as the current explicit override and existing generic New API nonce behavior.
