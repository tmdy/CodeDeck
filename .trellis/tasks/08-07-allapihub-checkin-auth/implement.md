# Implementation plan

## Ordered checklist

1. **Protect the existing worktree**
   - Snapshot `git status --short` and focused diffs for every overlapping authentication file.
   - Treat current `08-07-new-api-auth-isolation` edits as the base; do not revert unrelated user changes.

2. **Extend the persisted account contract**
   - Add `browser_session` metadata and conditional validation/normalization.
   - Keep PAT records backward compatible.
   - Detect deprecated `session_cookie` records as migration-only accounts without issuing direct Cookie requests.
   - Add migration, encrypted-store, equality, cache-invalidation, and import-without-partition tests.

3. **Implement `BrowserAccountSessionManager`**
   - Add stable opaque `persist:` partition allocation and exact-origin binding.
   - Harden each Session and BrowserWindow; allow only the account origin plus fixed `https://linux.do` and `https://connect.linux.do` OAuth origins.
   - Preserve slot Cookies, localStorage, IndexedDB, Cache Storage, and Service Worker data across window/app restart; clear site-origin data on account logout/delete and the full partition only after final-reference or explicit slot removal.
   - Implement same-account login-window reuse and global serialization.
   - Implement exact rc.22 AuthBundle parsing, origin-aware refresh, memory-only Bearer/SID state, expiry skew, per-account mutex, bounded SID retry, Cookie flushing, and bounded legacy classification.
   - Implement identity verification, status snapshots/events, generation cancellation, logout, deletion cleanup, and shutdown behavior.
   - Add focused unit tests for the LinuxDo allowlist, rejection of unrelated origins, storage-preserving close behavior, and full cleanup before integration.

4. **Add the runtime management request context**
   - Define an Electron-agnostic context for bound fetch, resolved headers, auth mode, and User-ID policy.
   - Update balance and check-in services to accept the context without copying browser credentials.
   - Preserve existing PAT resolution, nonce handling, learned-path behavior, and redacted diagnostics.
   - Add service tests asserting that browser-cookie mode emits no manual `Cookie` header and browser-Bearer mode emits no legacy auth headers.

5. **Wire Electron orchestration and IPC**
   - Compose the manager during profile-service initialization/unlock.
   - Add login/create, re-login, logout, and safe-status IPC handlers plus preload/env typings.
   - Make login success the atomic persistence boundary for new and migrated accounts.
   - Resolve browser request contexts before balance/check-in calls.
   - Route account deletion through manager cleanup before `ProfileService` deletion.

6. **Reuse the persistent partition for native verification**
   - Branch `CheckinVerificationService` by account auth mode.
   - For browser accounts, reuse the manager partition/task, omit Cookie injection/localStorage bootstrap, and preserve storage after window closure.
   - Retain only the minimal ephemeral compatibility path needed for PAT accounts.
   - Extend verification security/lifecycle tests.

7. **Add explicit `login_required` semantics**
   - Extend check-in result/display types, state normalization, presentation, and batch summary.
   - Invalidate learned paths and clear transient auth on confirmed expiration/revocation.
   - Prevent `login_required` from entering CAPTCHA verification flow.
   - Prevent scheduler/background work from opening windows or repeatedly retrying until re-login.
   - Add type, presentation, scheduler, main-flow, and restart-normalization tests.

8. **Update renderer onboarding and account actions**
   - Make browser login the default New API account action.
   - Move PAT/User-ID/optional non-browser refresh fields into an advanced compatibility section.
   - Remove manual Cookie/Session selection, labels, inputs, and placeholders.
   - Show safe browser status and explicit re-login/logout/delete actions.
   - Ensure a migrated legacy account upgrades in place without duplicate creation.
   - Update App, profile-editor-state, panel, and component tests.

9. **Add Electron integration coverage**
   - Build a local modern/legacy HTTP fixture and a focused Electron smoke harness.
   - Prove persistent HttpOnly Cookie and web-storage survival across recreated sessions, LinuxDo login persistence in the account partition, refresh rotation durability, Origin behavior, legacy Cookie attachment, and cleanup.
   - Add a documented npm script for the focused test if the existing test runner cannot launch Electron.

10. **Run the quality gate**
    - Run focused manager/service/component tests while iterating.
    - Run `npm test`.
    - Run `npm run typecheck`.
    - Run the focused Electron auth test.
    - Run `npm run build`.
    - Run `git diff --check`.
    - Inspect final diffs for secrets, copied Cookies, Bearers/SIDs, raw headers, accidental auth fallback, and unrelated worktree changes.

11. **Update executable project knowledge**
    - Update `.trellis/spec/frontend/management-auth-contract.md` to record browser-session ownership, runtime request context, `login_required`, and the prohibition on manual Cookie transport.
    - Update the frontend spec index only if the contract filename or status changes.

## Review gates

- Do not begin renderer work until the manager contract and persistence invariants have focused tests.
- Do not connect browser auth to scheduled check-in until `login_required` and no-window behavior are tested.
- Do not remove the deprecated stored Cookie until successful browser migration or explicit deletion.
- Do not report completion until the Electron smoke test proves Chromium persistence and Origin semantics.

## Risky files and rollback points

- `src/shared/balance/site-balance-sessions.ts` and `src/shared/services/profile-service.ts`: rollback together if the discriminated persistence/migration contract fails.
- `src/shared/electron/browser-account-session-manager.ts` and `electron/main.ts`: keep manager creation behind explicit browser-account branches until integration tests pass.
- `src/shared/services/balance-service.ts`, `src/shared/services/checkin-service.ts`, and `src/shared/services/management-auth.ts`: preserve PAT behavior and the single-transport invariant; revert the runtime-context slice as one unit if isolation tests regress.
- `src/shared/electron/checkin-verification-service.ts`: retain the existing ephemeral path until browser-partition verification is proven.
- `src/App.tsx` and `src/components/profiles/SiteBalanceSessionPanel.tsx`: PAT remains the user-visible fallback if browser onboarding must be temporarily rolled back.

## Before `task.py start`

- Review `prd.md`, `design.md`, and this plan with the user.
- Confirm `implement.jsonl` and `check.jsonl` contain real spec/research entries.
- Obtain a fresh explicit approval of the latest planning summary.

## Shared browser identity slot revision

1. Extend encrypted configuration with canonical global browser identity slots and add `browser_slot` to browser-managed account bindings.
2. Migrate each existing browser-managed account to its own stable slot without automatically merging existing identities.
3. Resolve manager partitions through the slot registry; keep management requests and interactive navigation bound to the current account origin.
4. Update login orchestration so new bindings can select an existing slot, while new identities allocate the lowest free positive slot.
5. Replace whole-partition account logout/delete cleanup with reference-aware site-origin cleanup; clear the full partition only for final-reference or explicit slot removal.
6. Update the Profile editor to show stable global slot numbers and reuse an existing slot across Profiles.
7. Add regression tests for cross-Profile slot reuse, distinct slot isolation, stable sparse numbering, lowest-hole allocation, migration, reference-aware cleanup, and exact-origin request enforcement.
8. Run focused tests, full `npm test`, `npm run typecheck`, `npm run build`, Electron smoke coverage, and `git diff --check`.
