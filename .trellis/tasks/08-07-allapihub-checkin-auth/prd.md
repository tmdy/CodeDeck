# Browser-managed New API authentication

## Goal

Replace manual New API Cookie/Session handling with browser-managed account login. The user signs in through a hardened Electron window once per global browser identity slot, CodeDeck reuses that Chromium identity across bound Profiles for balance and check-in, and asks for an explicit re-login only after the upstream session expires or is revoked.

## Background and Confirmed Facts

- The user chose browser login as the default New API onboarding path.
- Manual Cookie/Session input is retired; PAT remains available only as an advanced compatibility path.
- New API rc.22 uses a short-lived in-memory dashboard Bearer plus the rotating HttpOnly `new_api_refresh` cookie. The browser cookie is the durable credential.
- Legacy New API deployments still authenticate management requests with browser cookies.
- CodeDeck already has a hardened CAPTCHA/Turnstile BrowserWindow, but it currently uses a random in-memory partition, copies Cookie candidates, fabricates `localStorage.user`, and clears storage when verification ends (`src/shared/electron/checkin-verification-service.ts:182-189,447-476,787-790`).
- Electron supports disk-backed persistent identity-slot sessions through `session.fromPartition("persist:...")`; persistent cookies can be flushed with `cookies.flushStore()`.
- A persistent Electron partition also owns normal Chromium site storage such as localStorage, IndexedDB, Cache Storage, and Service Worker registrations. These stores must survive login-window closure and application restart.
- The related `08-07-new-api-auth-isolation` task has uncommitted changes in overlapping files. This task must preserve its explicit transport isolation and PAT behavior while superseding manual Cookie onboarding.

## Product Decisions

1. Browser login is the default New API account flow.
2. The UI no longer offers manual Cookie or Session entry.
3. PAT/Access Token remains available under an advanced compatibility section.
4. Already-saved manual Cookie accounts are treated as deprecated migration records: they are not used for direct requests, they show `login_required`, and a successful browser re-login upgrades the existing account without creating a duplicate. The old encrypted Cookie value is removed only after the browser migration succeeds or the account is deleted.
5. LinuxDo OAuth is part of this MVP through a fixed trusted-origin allowlist. Arbitrary third-party OAuth providers still require separate review.
6. LinuxDo state is shared across Profiles by stable global browser identity slot. Different slots remain isolated so multiple LinuxDo identities can coexist.
7. Slot numbers never compact automatically: deleting slot 1 leaves slot 2 as slot 2.
8. A new browser identity uses the lowest available positive slot number, so an empty slot 1 is filled before slot 3 is allocated.

## Requirements

1. Add a `browser_session` account authentication mode that is distinct from PAT and from deprecated manual Cookie records.
2. Make `browser_session` the default New API onboarding choice; keep PAT as an explicitly advanced option.
3. Allocate one stable opaque `persist:` Electron partition per global browser identity slot so eligible cookies survive window closure and application restart. Slot numbers are stable, sparse positive integers; new identities use the lowest available slot.
4. Persist the canonical opaque browser-session reference per slot, plus each binding's slot number, exact site origin, verified upstream user identity, and non-secret account metadata. Chromium may persist the slot partition's Cookies and normal web storage on disk; browser-managed records must never copy Cookie values, refresh tokens, dashboard Bearers, or SIDs into CodeDeck configuration.
5. Keep Chromium partitions, Cookies, Bearers, SIDs, refresh mutexes, and login windows inside the Electron main process. Renderer and generic profile persistence must never receive those secrets.
6. Open a sandboxed, hardened login BrowserWindow only after a direct user action. Support password, CAPTCHA, Turnstile, 2FA, Passkey, and LinuxDo OAuth flows handled by the site.
7. Bind each login window and management request to one exact normalized account origin plus the fixed trusted LinuxDo origins `https://linux.do` and `https://connect.linux.do`, even when the underlying slot partition is shared. OAuth callbacks must return to the active account origin. Reject every other cross-origin navigation/redirect, plus popups, downloads, permissions, webviews, Node access, developer tools, and account-identity mismatches.
8. Preserve Cookies, localStorage, IndexedDB, Cache Storage, and Service Worker data in referenced slot partitions when windows close or CodeDeck restarts. Account logout/delete clears only that binding's site-origin state; final-reference or explicit slot removal clears the whole partition across all origins.
9. For a new account, persist the first verified upstream user identity only after login succeeds. For re-login, require the verified identity to match the existing account.
10. For modern New API rc.22:
   - call `POST /api/user/auth/refresh` in the account partition with same-origin semantics;
   - keep the returned Bearer, expiry, and SID in process memory only;
   - serialize refreshes per account because the refresh cookie rotates;
   - omit `X-Auth-Session` on cold start;
   - on one confirmed SID mismatch, clear the in-memory SID and retry refresh once without it;
   - flush the Cookie store after successful login and refresh;
   - use the Bearer for dashboard requests without legacy User-ID authentication headers.
11. Treat only `404`, `405`, or a response unrelated to the documented AuthBundle as legacy capability absence. Modern-shaped `401`, revocation, conflict, rate-limit, and protocol errors must not downgrade to legacy Cookie mode.
12. For legacy New API, use `Session.fetch(..., { credentials: "include" })` in the binding's shared slot partition. Do not read Cookies into JavaScript or synthesize a `Cookie` header.
13. Add a runtime-only management request context so balance and check-in can use an account-bound fetch plus resolved non-persistent headers without storing or copying browser credentials.
14. Reuse the account partition for balance, manual check-in, automatic check-in, and native-page CAPTCHA/Turnstile verification.
15. Do not fabricate `localStorage.user` or call `/api/user/token` in browser-session mode.
16. Restore browser-account references after application unlock/restart and probe lazily or silently without opening a window.
17. Add an explicit `login_required` state distinct from CAPTCHA `manual_required`. Confirmed anonymous, expired, or revoked sessions must clear transient Bearer/SID state, invalidate learned paths, and stop background retry loops.
18. Background balance/check-in and the scheduler must never open a login window. Only a user-triggered “重新登录” action may do so.
19. Re-login must reuse the same account record and global slot partition. Concurrent login requests for the same account must focus/reuse one window and one promise.
20. Explicit account logout must clear transient state and the bound site-origin storage while retaining the account as `login_required`. Account deletion removes its binding; whole-slot cleanup occurs only after the final reference or explicit slot removal.
21. Preserve existing PAT accounts and their explicit transport semantics. Never fall back between PAT, browser Bearer, browser Cookie, or deprecated manual Cookie transports.
22. Imported configuration on a machine without the referenced partition must become `login_required` and require a new browser login.

## Acceptance Criteria

- [ ] A new New API account can be added through browser login without manually entering a Cookie, Session, User ID, or PAT.
- [ ] The default account UI shows browser login; PAT is available only through an advanced compatibility path; manual Cookie/Session input is absent.
- [ ] After one successful login, closing and reopening CodeDeck reuses the same account session while the upstream persistent cookie remains valid.
- [ ] LinuxDo OAuth can navigate through only `https://linux.do` and `https://connect.linux.do`, return to the active account origin, and reuse the saved LinuxDo login across Profiles bound to the same slot.
- [ ] Slot storage survives login/verification window closure and CodeDeck restart; account logout/delete preserves shared LinuxDo state while final-reference or explicit slot removal clears it.
- [ ] Modern rc.22 refresh-token rotation is serialized per account and durably flushed by Chromium.
- [ ] Dashboard Bearers, SIDs, refresh cookies, and AuthBundle payloads never appear in logs, renderer state, errors, snapshots, exports, or encrypted browser-session records.
- [ ] Legacy New API deployments work through the same persistent browser partition without copying Cookie values into request headers or configuration.
- [ ] Balance, manual check-in, automatic check-in, and native-page verification share one authenticated account partition.
- [ ] Expired, revoked, anonymous, or imported-without-local-data sessions become `login_required`; background work does not open a window or repeatedly retry.
- [ ] Clicking “重新登录” restores the same account and partition; identity mismatch is blocked and does not overwrite the saved identity.
- [ ] A deprecated saved manual Cookie account is not used directly, can be upgraded by browser re-login without duplication, and has its old stored Cookie removed after successful migration.
- [ ] Explicit account logout clears transient and site-origin data while keeping the account as `login_required`; deletion removes its binding without clearing a still-referenced slot.
- [ ] Existing PAT behavior and explicit-auth isolation remain intact with no cross-transport fallback.
- [ ] Unit tests cover persistence normalization, refresh serialization, SID retry, legacy detection, identity matching, status propagation, scheduler behavior, IPC, UI, logout, deletion, and late-result rejection.
- [ ] A focused Electron smoke/integration test proves persistent Cookie survival, rotation persistence, Origin behavior, and legacy Cookie attachment across a recreated session boundary.
- [ ] `npm test`, `npm run typecheck`, `npm run build`, the focused Electron auth test, and `git diff --check` pass.
- [ ] After LinuxDo login succeeds once for slot 1, every Profile/backend account bound to slot 1 can complete site login without another LinuxDo credential prompt while that upstream session remains valid.
- [ ] Slot 1 and slot 2 can hold different LinuxDo identities without sharing their Cookies or web storage.
- [ ] Deleting an account binding does not clear a slot still referenced elsewhere; deleting the final reference clears the partition.
- [ ] Removing slot 1 does not renumber slot 2, and the next new browser identity is assigned to slot 1.

## Out of Scope

- Exporting or synchronizing Chromium Cookies or partition data between devices.
- Automatically opening a login window from balance checks, check-in runs, or the scheduler.
- Persisting the short-lived dashboard Bearer or SID.
- Generating, reading, or replacing a management PAT in browser-session mode.
- OAuth providers other than the fixed LinuxDo allowlist.
- Automatically merging existing browser identities during migration; each existing partition receives its own stable slot.
- Parallel interactive login windows for multiple accounts.

## Risks and Deferred Items

- Electron cannot unregister or physically destroy a live partition. Cleanup relies on canceling tasks, generation checks, clearing storage/cache, flushing Cookies, and dropping the opaque reference.
- Refresh-cookie rotation makes uncertain network failures non-replayable; refresh retries must be bounded and protocol-specific.
- Existing dirty authentication-isolation changes overlap the affected files and must be preserved during implementation.
- Browser-session references are local-only. Configuration import intentionally requires re-login when Chromium data is absent.
- Persisted LinuxDo storage is sensitive browser data. It remains isolated between slots and is cleared on explicit slot removal or when the final binding is deleted.
