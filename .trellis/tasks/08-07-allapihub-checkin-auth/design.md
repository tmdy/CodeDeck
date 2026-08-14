# Technical design

## Architecture and boundaries

Add an Electron-main-only `BrowserAccountSessionManager` under `src/shared/electron/`. It is the sole owner of persistent Chromium partitions, login windows, modern refresh state, legacy browser-cookie transport, refresh serialization, and account cleanup.

```text
Renderer account UI
  -> typed preload IPC: login / relogin / logout / status
  -> electron/main.ts orchestration and persistence boundary
  -> BrowserAccountSessionManager
       persist:codedeck-newapi-<opaque global-slot session id>
       account runtime state + refresh mutex + interactive task
  -> runtime ManagementRequestContext
       modern: account Session + memory-only Bearer
       legacy: account Session + credentials: include
  -> existing BalanceService / CheckinService parsing and capability logic
```

`ProfileService` remains platform-neutral and persists safe account bindings plus canonical global slot references. The renderer sees slot numbers and safe status/identity data only. Neither layer receives Cookies, AuthBundle data, Bearers, or SIDs.

## Persisted model

Use an explicit discriminated account model, or an equivalent flat model with validation that enforces the same invariants:

```typescript
type SiteBalanceAuthKind = "browser_session" | "access_token";

interface BrowserSiteBalanceSession {
  auth_kind: "browser_session";
  browser_slot: number;
  browser_origin: string;
  user_id: string;
  // no persisted access_token / refresh cookie / bearer / SID
}

interface AccessTokenSiteBalanceSession {
  auth_kind: "access_token";
  access_token: string;
  user_id: string;
  refresh_token?: string; // existing non-browser backend compatibility
  token_expires_at?: number;
}
```

The saved account `id`, label, base URL, auto-check-in flag, and update timestamp remain common fields. `browser_slot` references a canonical global slot whose random opaque local identifier maps to `persist:codedeck-newapi-${browserSessionId}`. `browser_origin` is the exact normalized origin with no path, query, or fragment.

The legacy persisted value `auth_kind: "session_cookie"` is accepted only by migration code. It is never offered by the UI and never used for a direct management request after this feature is active. It becomes a `login_required` migration record; the existing encrypted Cookie is retained only until browser re-login succeeds, then removed atomically with the account upgrade. This preserves rollback/recovery without keeping the retired transport operational.

Conditional validation rules:

- `access_token` requires a non-empty token and has no browser-session reference.
- `browser_session` requires a valid global slot reference, exact origin, and verified user ID and persists no credential string.
- changes to kind, token, browser slot, origin, or identity invalidate balance/check-in state and learned paths.

## Runtime state

The manager keeps transient state keyed by the existing account key:

```typescript
interface BrowserAccountRuntimeState {
  mode: "unknown" | "modern" | "legacy";
  status: "unknown" | "checking" | "ready" | "login_required" | "authenticating";
  bearer?: string;
  bearerExpiresAt?: number;
  sid?: string;
  generation: number;
}
```

Separate maps hold one refresh promise and one interactive login task/window per account. Generation checks prevent canceled logout/delete work from restoring stale state.

## Interactive login flow

1. The renderer invokes a dedicated login/re-login IPC with the base URL and optional existing account ID. It never sends a Cookie or browser credential.
2. For a new account, Electron allocates the account/browser reference before opening the window but does not persist the account until identity verification succeeds.
3. The manager creates or restores the selected global slot partition, applies permission/download guards once, and opens a hardened BrowserWindow using that partition. The window is limited to the active account origin and trusted LinuxDo origins, while the partition persists storage for every binding assigned to that slot.
4. A repeated request for the same account focuses the existing window and returns the same promise. Interactive windows remain globally serialized for the MVP.
5. Login completion is proven by protocol probes, not by URL matching:
   - attempt the exact modern refresh contract;
   - if modern, call `/api/user/self` with the returned Bearer;
   - if modern capability is absent, call `/api/user/self` with the partition-owned legacy Cookies;
   - extract and compare the upstream user identity.
6. On success, flush the Cookie store, persist or upgrade the account atomically, mark it ready, and close the window.
7. Cancel/timeout leaves a new account unsaved. Re-login failure preserves the existing account and identity.

The login window reuses the existing verification window's security posture: `sandbox`, `contextIsolation`, no Node, no preload, no devtools, popup/webview/download/permission denial. Navigation and redirects are allowed only for the exact account origin, `https://linux.do`, and `https://connect.linux.do`; an OAuth completion must return to the account origin. Every other external origin is blocked.

The persistent partition retains Cookies, localStorage, IndexedDB, Cache Storage, and Service Worker registrations when windows close or CodeDeck restarts. CodeDeck never reads or serializes those stores. LinuxDo storage is scoped to a global identity slot, so every Profile binding assigned to that slot reuses it while different slots remain isolated.

## Modern New API rc.22 protocol

Use an origin-aware Electron request adapter bound to the account `Session` for `POST <origin>/api/user/auth/refresh`. The adapter must send session Cookies, the exact same-site Origin expected by OriginGuard, and JSON accept headers. Normal dashboard calls can use the bound `Session.fetch`.

Refresh behavior:

- one in-flight refresh per account; concurrent consumers await it;
- omit `X-Auth-Session` when no SID exists, including every cold start;
- parse only the pinned rc.22 AuthBundle shape;
- store Bearer, expiry, and SID only in memory;
- refresh with a small expiry skew;
- after a confirmed SID mismatch, clear SID and retry once without it;
- do not replay uncertain network failures;
- flush the Cookie store after successful rotation before releasing the mutex;
- never call `/api/user/token`.

Capability classification is bounded. `404`, `405`, or an unrelated response shape selects legacy mode. Modern-shaped authentication, revocation, conflict, rate-limit, or protocol failures do not downgrade.

## Legacy New API browser-cookie protocol

Legacy mode uses the same persistent partition and `Session.fetch` with `credentials: "include"`. CodeDeck does not call `cookies.get()` for transport, does not copy Cookie values into JavaScript, and does not build a `Cookie` header. Existing User-ID compatibility headers are added only where endpoint behavior requires them.

## Runtime request contract

Add an Electron-agnostic `ManagementRequestContext` accepted optionally by `BalanceService` and `CheckinService`:

```typescript
interface ManagementRequestContext {
  fetch: typeof fetch;
  headers: Readonly<Record<string, string>>;
  userIdHeaderPolicy: "omit" | "legacy_if_required";
  authMode: "browser_bearer" | "browser_cookie";
}
```

For browser accounts, `electron/main.ts` asks the manager for this context before calling the shared service. Modern context contains the memory-only Bearer header; legacy context contains no Cookie header because the bound fetch owns Cookie attachment. The shared services reuse existing response parsing, nonce handling, capability learning, and redacted diagnostics. PAT accounts continue through `resolveManagementAuth` unchanged.

No sentinel token is placed in `SiteBalanceSession.access_token`, and no browser Cookie is copied into an existing credential field.

## Balance, check-in, and verification flow

- Balance resolution obtains the browser request context before `BalanceService.query`. Confirmed browser expiration produces a failed balance state with `login_required` metadata/message and invalidates the learned balance path.
- Check-in resolution obtains the same context before `CheckinService.checkin`. Add `login_required` to result/display status, normalization, presentation, and batch summary.
- `login_required` bypasses the current `manual_required -> open verification` branch. CAPTCHA `manual_required` remains separate.
- Automatic check-in preserves the last automatic-attempt date and skips accounts already marked `login_required` until a successful explicit re-login.
- Browser-account native verification reuses the same partition. It does not inject Cookie candidates, does not fabricate `localStorage.user`, and does not clear persistent storage when the verification window closes.
- PAT-only compatibility verification may retain the existing ephemeral partition path where still required.

## IPC and renderer UX

Add typed IPC methods for:

- browser login/create;
- re-login existing account;
- explicit logout;
- safe browser-auth status lookup/event updates.

The default new-account panel shows a primary “浏览器登录” action and explanatory status. PAT fields live in a collapsed/advanced compatibility section. Manual Cookie/Session options and placeholders are removed. Existing browser accounts show `checking`, `ready`, or `login_required` plus “重新登录”, “退出登录”, and delete actions as appropriate.

Login/re-login is an explicit account operation, not ordinary renderer autosave. Successful new login returns the persisted account; successful re-login updates the same record.

## Logout, deletion, and lifecycle

Account logout:

1. cancel login/verification work and advance the generation;
2. clear Bearer, SID, mode, mutex, and cached request state;
3. clear only the binding's exact site-origin storage and flush Cookies, preserving shared LinuxDo and other referenced origins;
4. invalidate learned balance/check-in paths;
5. retain the account as `login_required`.

Deletion runs the same account-scoped cleanup before removing bindings, caches, tasks, and the account record. It clears the entire slot partition only when no binding remains. Explicit slot removal logs out all references and clears the complete partition. Because Electron cannot unregister a live partition, late completions must be rejected.

Application shutdown closes interactive windows and clears transient maps but does not clear persistent partitions. Import or startup with a missing partition silently resolves to `login_required`.

## Compatibility and migration

- Existing PAT accounts remain valid and keep their explicit Bearer transport.
- Existing uncommitted authentication-isolation work is the base; implementation must not restore multi-transport guessing or Profile API-key fallback.
- Deprecated saved manual Cookie accounts are not sent over the network. They remain visible only as migration records until browser re-login upgrades them.
- Legacy New API servers remain supported through browser-owned Cookies, which is separate from supporting pasted Cookie credentials.
- Browser data is local-only and intentionally excluded from export/sync.
- LinuxDo login persistence is shared by stable global slot across Profile bindings; different slots never share identity-provider state.

## Validation strategy

Unit tests use injected Session/window/request dependencies to cover stable slot partition naming, exact account/LinuxDo origin allowlisting, rejection of other origins, same-account window reuse, refresh mutexes, cold-start SID omission, one SID reset retry, capability classification, identity mismatch, generation cancellation, reference-aware cleanup, and secret redaction.

Service and UI tests cover runtime request contexts, PAT isolation, `login_required`, scheduler short-circuiting, migration, IPC typing, default browser onboarding, advanced PAT UI, and absence of manual Cookie fields.

A focused Electron smoke fixture must prove behavior that Node-only Vitest cannot: persistent HttpOnly Cookie and web-storage survival across recreated sessions, LinuxDo-origin reuse inside one slot, isolation between different slots, rotating refresh-cookie durability after `flushStore()`, OriginGuard-compatible refresh, and automatic legacy Cookie attachment.

## Rollout and rollback

Implement in layers: data model and tests, manager, request-context integration, main-process orchestration, verification reuse, then UI. PAT remains available throughout as the operational fallback.

Do not erase a deprecated stored Cookie until successful browser migration or explicit account deletion. If browser integration must be rolled back before migration succeeds, the encrypted legacy record remains recoverable; after successful migration, rollback uses PAT or a new browser login rather than restoring copied Cookie transport.

## Revised design: global browser identity slots

The original per-backend-account partition boundary is superseded by stable global browser identity slots. A slot owns one opaque persistent Chromium partition and may be referenced by backend accounts from multiple Profiles and site origins. The account record continues to own its exact site origin and verified upstream user identity; the slot owns only the Chromium identity container.

Persist a slot number on browser-managed account bindings and keep one canonical opaque partition reference per slot. Slot numbers are positive integers, stable, and sparse. Allocation selects the lowest unused number. Existing browser-managed records migrate one-to-one into stable slots without merging identities automatically; users may explicitly bind later accounts to an existing slot.

```typescript
interface BrowserIdentitySlot {
  slot: number;
  browserSessionId: string;
}

interface BrowserSiteBalanceSession {
  auth_kind: "browser_session";
  browser_slot: number;
  browser_origin: string;
  user_id: string;
}
```

Interactive login remains restricted to the current account origin plus the two trusted LinuxDo origins even though the underlying partition may contain storage for other bound site origins. Management fetches remain exact-origin bound and cannot address another account origin.

Slot lifecycle uses reference-aware cleanup:

- account logout clears transient account auth state and site-origin storage only; it does not clear shared LinuxDo storage or the whole slot;
- account deletion removes its binding and site-origin storage; the partition is cleared only when the slot has no remaining account references;
- explicit slot removal logs out every binding that references it, clears the complete partition, and leaves the numeric hole available;
- application shutdown preserves referenced slots and clears only unpersisted tentative slots;
- a failed first binding may retain its tentative slot for the bounded retry lifetime already defined.

The renderer lists stable global slots as `账号1`, `账号2`, etc. New account login defaults to the lowest available slot, while an existing slot can be selected to reuse its LinuxDo identity. Slot labels come from persisted slot numbers, not array order, so deleting slot 1 never renumbers slot 2.
