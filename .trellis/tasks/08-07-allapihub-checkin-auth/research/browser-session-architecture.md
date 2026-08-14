# Research: Browser-managed New API session architecture

- Query: Define the concrete CodeDeck architecture for persistent per-account Electron partitions, reusable interactive login, New API rc.22 refresh/Bearer lifecycle, legacy Cookie fallback, logout/deletion, scheduled check-in `login_required`, and the exact local files/tests affected.
- Scope: mixed
- Date: 2026-08-10

## Findings

### Recommended boundary

Add one Electron-main-only `BrowserAccountSessionManager`. It should be the sole owner of Chromium partitions, refresh cookies, transient dashboard Bearers/SIDs, login windows, refresh serialization, and account logout. Renderer/shared persistence must see only opaque references and non-secret status.

```text
renderer UI
  -> typed preload IPC (login / relogin / logout / delete)
  -> electron/main.ts orchestration
  -> BrowserAccountSessionManager
       persist:codedeck-newapi-<opaque browser_session_id>
       Map<accountKey, { mode, bearer, expiresAt, sid, loginRequired }>
       Map<accountKey, refreshPromise>
       Map<accountKey, interactiveTask/window>
  -> BalanceService / CheckinService via a runtime request context
       modern: partition fetch + Authorization: Bearer <memory-only token>
       legacy: partition fetch + credentials: include, no copied Cookie header
```

The new manager belongs under `src/shared/electron/` because it depends on Electron `Session`/`BrowserWindow`, while `electron/main.ts` should remain the composition and IPC boundary. Do not place browser cookies or the transient AuthBundle in `ProfileService` or renderer state.

### Persisted account shape and migration

Extend the saved account model with a third explicit auth kind, `browser_session`, while retaining `access_token` as the advanced compatibility mode and `session_cookie` only for already-saved legacy/manual accounts. New account onboarding defaults to `browser_session`; no Cookie/Session/User ID/PAT input is shown for that path.

Minimal persisted browser fields:

```typescript
auth_kind: "browser_session";
browser_session_id: string; // random opaque local reference
browser_origin: string;     // exact normalized origin, no path/query/hash
user_id: string;            // identity discovered and confirmed after login
access_token: "";           // preferably made optional by a discriminated type
```

`browser_session_id` should be generated before opening the first login window and mapped to `persist:codedeck-newapi-${browserSessionId}`. Do not derive it from origin, username, or User ID. On another machine/import, the opaque reference may exist while its partition does not; the silent probe must then produce `login_required`, not create a new account or fall back to manual Cookie.

The current model requires a non-empty `access_token` and only normalizes two auth kinds (`src/shared/balance/site-balance-sessions.ts:17-46,203-216,315-351`); `ProfileService.saveSiteBalanceSession` rejects an empty token and persists credentials (`src/shared/services/profile-service.ts:491-527`). These are the primary persistence changes. Credential-change invalidation already clears check-in/balance capability caches (`profile-service.ts:528-562`) and deletion clears bindings/state caches (`profile-service.ts:592-627`); browser-session reference/origin/identity changes must participate in the same invalidation predicate.

### Persistent Electron partition lifecycle

Use `session.fromPartition("persist:codedeck-newapi-<id>", { cache: false })`. The `persist:` prefix is required for disk-backed storage. Configure each partition once:

- deny permission checks/requests;
- block downloads;
- never expose the `Session` to renderer code;
- use only URLs whose `origin` equals the saved `browser_origin`;
- call `cookies.flushStore()` after successful login and every successful refresh, because the rotating refresh cookie must be durable before the operation is reported complete.

The existing verification service is the reusable security reference: sandbox/context isolation/no Node/no devtools at `src/shared/electron/checkin-verification-service.ts:283-314`, and same-origin navigation/popup/webview blocking at `:316-332`. Its lifecycle is intentionally unsuitable for persistent login: it creates a random non-`persist:` partition at `:182-189`, injects copied Cookie candidates at `:334-393`, and clears all storage/cache on completion at `:447-476`.

### Interactive login and window reuse

`openLogin(accountRef)` should be explicitly user-triggered. If the same account already has an interactive task, show/focus its window and return the existing promise, following the existing same-account reuse pattern at `checkin-verification-service.ts:116-149`. A small global queue, also patterned after `:166-180`, avoids multiple credential windows competing for focus.

Create the BrowserWindow with the account's stable partition and the existing hardened preferences. Deny popups, downloads, webviews, permissions, devtools, and cross-origin navigation/redirects. Load only the exact account origin. This intentionally excludes cross-origin OAuth portals unless a future reviewed allowlist is added, matching the PRD scope.

Login completion should be proven by the manager, not inferred from a page URL:

1. Attempt the modern refresh protocol in the same partition.
2. If modern, call `/api/user/self` with the returned Bearer and no legacy User-ID headers.
3. If refresh capability is absent, probe `/api/user/self` using the partition-owned cookies.
4. Extract the upstream user identity and compare it with the saved expected `user_id`; for a new record, persist the first verified identity only after success.
5. On mismatch, keep the existing account identity and return `account_mismatch`.
6. Flush the cookie store, mark the account ready, close the window, and resolve the existing promise.

Do not fabricate `localStorage.user`; the current verification bootstrap at `checkin-verification-service.ts:235-253,787-790` is a legacy workaround and must not be used for rc.22.

### Modern New API rc.22 lifecycle

Maintain only this transient main-process state per account:

```typescript
{
  mode: "unknown" | "modern" | "legacy";
  bearer?: string;
  bearerExpiresAt?: number;
  sid?: string;
  loginRequired: boolean;
}
```

Refresh rules:

- serialize refreshes with one in-flight promise per account; concurrent balance/check-in calls await it because the HttpOnly refresh cookie rotates;
- call `POST <origin>/api/user/auth/refresh` through the account `Session`, with `credentials: "include"`, JSON accept headers, and the exact same-site `Origin` expected by upstream;
- omit `X-Auth-Session` after process start or whenever no SID is held;
- retain returned Bearer, expiry, and SID only in the manager's memory;
- refresh before expiry using a small skew (for example 30 seconds), and retry a dashboard request once only after a confirmed authentication rejection;
- on a confirmed SID mismatch, clear only the in-memory SID and retry refresh once without `X-Auth-Session`;
- never replay uncertain network failures and never call `/api/user/token` in browser-session mode;
- after a successful refresh, call `cookies.flushStore()` before releasing the refresh mutex.

Capability classification must be bounded: `404`, `405`, or a response that is unrelated to the documented AuthBundle means `legacy`; `401`, revocation/anonymous responses, rate limiting, and modern-shaped protocol errors do not silently downgrade to Cookie mode. This preserves the rc.22 detection contract already recorded in the task research (`research.md:19-47`).

Normal modern management requests use the memory-only `Authorization: Bearer ...` and omit `New-API-User`/compatibility headers. Existing PAT behavior remains unchanged through `resolveManagementAuth` (`src/shared/services/management-auth.ts:22-47`).

### Legacy Cookie fallback without copying Cookie values

For a browser account classified as legacy, use `Session.fetch(..., { credentials: "include" })` in the same persistent partition. Do not read cookies into JavaScript and do not synthesize a `Cookie` header. Legacy User-ID compatibility headers may be added only where the existing endpoint probing proves they are required.

The current balance/check-in services derive request headers from `SiteBalanceSession.access_token`: balance at `src/shared/services/balance-service.ts:1670-1775`, and check-in at `src/shared/services/checkin-service.ts:107-168,238-336,440-474`. Do not pass a sentinel token or copy a browser Cookie into these fields. Add a runtime-only management request context to both services, containing a bound fetch implementation, already-resolved headers, and a User-ID-header policy. `electron/main.ts` asks the manager for this context when `auth_kind === "browser_session"`; PAT/manual legacy paths continue through the existing resolver.

This context keeps secrets out of persistence while reusing existing response parsing, check-in nonce logic, capability learning, and diagnostics. Diagnostics must record only mode/status/host/account ID, never Bearer, SID, response AuthBundle, Cookie, or partition contents.

### Balance, check-in, and native verification integration

`electron/main.ts` currently constructs one generic Chromium fetch and injects it into both services (`electron/main.ts:1303-1308`). The generic helper itself creates random credential-keyed memory partitions (`src/shared/electron/chromium-fetch.ts:162-223`), so browser accounts must supply their account-bound runtime request context instead of using that generic partition.

For manual and scheduled check-in, resolve browser auth before `CheckinService.checkin` in `executeCheckinAccountOnce` (`electron/main.ts:2010-2088`). For balance, resolve it before the existing `BalanceService.query` call and pass the same runtime request context. The shared services remain platform-neutral and PAT behavior stays isolated.

Refactor `CheckinVerificationService` to obtain the account partition/window task from `BrowserAccountSessionManager` for browser accounts. It should no longer select/inject Cookie candidates or clear storage for those accounts. PAT/manual-cookie verification can retain the current ephemeral compatibility path. Modern native-page verification must let the real site frontend establish its own in-page Bearer from the persisted refresh cookie; do not inject Bearer/localStorage state from CodeDeck.

### `login_required` behavior and scheduler

Make `login_required` an explicit non-success account/check-in state instead of overloading CAPTCHA `manual_required`. The current status unions and batch summary do not contain it (`src/shared/checkin/types.ts:1-33,57-86`), and state normalization only recognizes the existing statuses (`:99-153`). Add it to the typed result/display state, state normalizer, presentation, and batch summary.

When refresh/self conclusively shows anonymous, expired, or revoked state:

- clear memory-only Bearer/SID;
- set the manager/local UI status to `login_required`;
- invalidate learned balance/check-in paths;
- return immediately on subsequent background calls without network refresh loops;
- expose a renderer “重新登录” action that calls the explicit login IPC and reuses the same account record/partition.

The scheduler already uses `verificationPolicy: "defer"` and therefore does not open a verification window (`electron/main.ts:2241-2297`), while manual single-account execution uses `"open"` (`:3441-3449`). Browser-session `login_required` must bypass the current `manual_required -> open verification` branch at `:2089-2110`; only the separate user-triggered relogin IPC may open a login window. Preserve `last_auto_attempt_local_date` so the daily scheduler does not retry repeatedly on the same day. The scheduler wiring is at `electron/main.ts:2299-2316` and `src/shared/services/checkin-scheduler.ts:74-86`.

### Logout and deletion

Add `logout(accountKey)` to the manager:

1. cancel/close pending login or verification tasks for that account;
2. increment/delete an account generation so late async completions cannot restore state;
3. clear memory Bearer/SID and in-flight refresh bookkeeping;
4. clear partition storage and cache, then flush the cookie store;
5. invalidate learned paths and expose `login_required` without deleting the account record.

Account deletion performs the same cleanup before `ProfileService.deleteSiteBalanceSession`. The current delete IPC only cancels the verification task then deletes the record (`electron/main.ts:3177-3185`); it must call manager deletion cleanup first. Electron has no supported API to destroy a `Session` object or remove a partition directory while it is live, so correctness comes from clearing storage, dropping the opaque reference, and rejecting late work. App shutdown should cancel windows/tasks and clear transient maps but must not clear persistent partition data; current app/window shutdown hooks already cancel verification tasks (`electron/main.ts:2636-2640,3635-3639`).

### Exact affected local files

Core implementation:

- `src/shared/electron/browser-account-session-manager.ts` — new Electron-only owner for partitions, modern refresh state, legacy probes, login windows, mutexes, logout/deletion.
- `src/shared/electron/checkin-verification-service.ts` — reuse browser-account partition/task; preserve ephemeral PAT/manual-cookie compatibility; remove legacy localStorage bootstrap from browser-session path.
- `electron/main.ts` — compose manager, route save/login/relogin/logout/delete, resolve runtime auth for balance/check-in, scheduler short-circuit, lifecycle cleanup.
- `src/shared/balance/site-balance-sessions.ts` — add/normalize browser auth metadata without secret persistence; retain legacy migration.
- `src/shared/services/profile-service.ts` — conditional validation, browser fields, cache invalidation, deletion ordering contract.
- `src/shared/services/balance-service.ts` — accept runtime management request context without requiring/copied browser credential.
- `src/shared/services/checkin-service.ts` — same request context, modern header policy, explicit `login_required` propagation.
- `src/shared/services/management-auth.ts` — keep PAT/manual Cookie resolver isolated; shared runtime context types may live here if they remain Electron-agnostic.
- `src/shared/checkin/types.ts` and `src/shared/checkin/presentation.ts` — explicit `login_required` state/result/presentation/batch count.
- `src/shared/state/local-state.ts` (and normalization/store helpers if used) — non-secret browser-auth UI state keyed by account.
- `electron/preload.ts` and `src/env.d.ts` — typed login/relogin/logout/status IPC; no generic cookie/token payloads.
- `src/components/profiles/SiteBalanceSessionPanel.tsx` — browser login default, login status and actions; PAT under advanced compatibility; remove manual Cookie/Session fields from new-account flow.
- `src/shared/profile-editor-state.ts` — browser auth draft/default/dirty comparison; current equality omits `auth_kind` at `:394-402`.
- `src/App.tsx` — onboarding/save flow, explicit relogin/logout handlers, `login_required` messages, avoid treating login as ordinary credential autosave.

Existing tests to update:

- `src/shared/__tests__/electron/checkin-verification-service.test.ts`
- `src/shared/__tests__/services/balance-service.test.ts`
- `src/shared/__tests__/services/checkin-service.test.ts`
- `src/shared/__tests__/services/profile-service.test.ts`
- `src/shared/__tests__/services/management-auth.test.ts`
- `src/shared/__tests__/services/checkin-scheduler.test.ts`
- `src/shared/__tests__/balance/site-balance-sessions.test.ts`
- `src/shared/__tests__/checkin/types.test.ts`
- `src/shared/__tests__/checkin/presentation.test.ts`
- `src/shared/__tests__/crypto/store.test.ts`
- `src/shared/__tests__/profile-editor-state.test.ts`
- `src/shared/__tests__/components/site-balance-session-panel.test.tsx`
- `src/shared/__tests__/components/app-balance-session-save.test.tsx`
- `src/shared/__tests__/components/profile-edit-form-rendering.test.tsx`
- `src/shared/__tests__/components/profile-edit-form.test.tsx`

New focused tests:

- `src/shared/__tests__/electron/browser-account-session-manager.test.ts` — stable `persist:` partition, same-account window reuse, exact-origin blocking, refresh mutex, cookie flush, cold-start SID omission, one SID-mismatch retry, terminal modern errors, legacy classification, identity mismatch, logout/delete cancellation and late-result rejection.
- An Electron smoke/integration harness for a local HTTP fixture — prove persistent cookie survival across a recreated session/process boundary, rotating refresh-cookie persistence, `Origin` behavior, and legacy `Session.fetch` cookie attachment. Mocked Vitest alone cannot prove Chromium SameSite/HttpOnly persistence semantics.

### External references

- Electron Session partitions: <https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options>
- Electron Cookies and `flushStore()`: <https://www.electronjs.org/docs/latest/api/cookies>
- Electron `Session.fetch`: <https://www.electronjs.org/docs/latest/api/session#sesfetchinput-init>
- Electron BrowserWindow security: <https://www.electronjs.org/docs/latest/tutorial/security>
- New API rc.22 authentication: <https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.22/docs/authentication.md>
- All API Hub compatibility PR: <https://github.com/qixing-jk/all-api-hub/pull/1221>
- All API Hub rc.22 design: <https://github.com/qixing-jk/all-api-hub/blob/main/docs/superpowers/specs/2026-07-27-new-api-rc22-auto-detect-compatibility-design.md>
- Local Electron version: `electron ^39.8.5` (`package.json:58-67`).

### Related specs

- `.trellis/spec/frontend/management-auth-contract.md` — explicit transport isolation; browser mode must not weaken PAT/Cookie separation.
- `.trellis/spec/guides/cross-layer-thinking-guide.md` — map persisted config, main-process runtime state, IPC status, services, and UI as one contract.
- `.trellis/spec/frontend/index.md` — frontend spec index; management-auth contract is active.

## Caveats / Not Found

- The research-agent role forbids Git operations, so I did not run `git status`/`git diff`. The task's existing `research.md:165` states that uncommitted auth-isolation work overlaps these files; implementation must inspect and preserve that work before editing. The affected-file list above is based on the current filesystem contents, not a Git diff.
- The exact rc.22 AuthBundle field decoder should be copied from/validated against the pinned upstream rc.22 source during implementation; do not accept arbitrary success-shaped JSON as modern capability.
- Electron cannot explicitly destroy/unregister a live partition. Deletion guarantees must rely on task cancellation, storage clearing, dropping the opaque reference, generation checks, and integration verification.
- Strict same-origin navigation intentionally blocks many third-party OAuth flows. Supporting them requires a separately reviewed origin allowlist and callback contract; it is out of scope for this task.
- Existing `CheckinVerificationService` serializes all verification windows globally. Reusing that coordinator is simplest; allowing parallel account windows would require a deliberate UX/security decision.
