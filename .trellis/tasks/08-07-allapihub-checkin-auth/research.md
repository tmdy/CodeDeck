# Research: All API Hub compatibility with New API rc.22

## Conclusion

The reported cookie is real but is no longer a direct dashboard/API credential. New API rc.22 changed `session` from the legacy Gin session contract into an HttpOnly refresh credential. Sending it directly as `Cookie: session=...` to `/api/user/self` or `/api/user/checkin` is expected to fail.

All API Hub remains compatible by adapting onboarding rather than changing each balance or check-in request:

1. From a same-origin browser context, call `POST /api/user/auth/refresh` with the refresh cookie.
2. Validate the returned AuthBundle and keep its 15-minute Bearer token in memory only.
3. Call `/api/user/self` with `Authorization: Bearer <dashboard token>` and without `New-Api-User`.
4. If the safe user DTO does not expose a management PAT, call `GET /api/user/token` once.
5. Persist only the resulting long-lived management PAT and normalize the account to access-token authentication.

The All API Hub check-in provider itself continues to use the saved account PAT. Its rc.22 fix is therefore an account-credential conversion flow, not a refresh-before-every-check-in flow.

## Upstream evidence

### New API v1.0.0-rc.22

Source: <https://github.com/QuantumNous/new-api/blob/v1.0.0-rc.22/docs/authentication.md>

- Dashboard Access Token: 15-minute JWT, memory-only, sent as Bearer.
- Refresh Token: opaque rotating value, HttpOnly and SameSite=Strict cookie, up to 30 days.
- `POST /api/user/auth/refresh`: refresh-cookie authentication and Origin validation in secure mode.
- PAT calls continue to support `Authorization: Bearer <pat>`; `New-Api-User` no longer participates in authentication.
- The old `session` cookie is explicitly no longer used after upgrade.

### All API Hub

- Repository: <https://github.com/qixing-jk/all-api-hub>
- Compatibility PR: <https://github.com/qixing-jk/all-api-hub/pull/1221>
- Released in `3.54.0` as commit `da6672ef14c3a827891e0b58cc8be133711f4da6`.
- Design: <https://github.com/qixing-jk/all-api-hub/blob/main/docs/superpowers/specs/2026-07-27-new-api-rc22-auto-detect-compatibility-design.md>
- AuthBundle parser: `src/services/apiService/newApi/dashboardAuth.ts`
- Same-origin refresh extractor: `src/services/accountSiteOnboarding/contentSession/newApiAuthBundle.ts`
- Bearer-to-PAT exchange: `src/services/apiAdapters/newApi/accountCompletion.ts`
- PAT get-or-create behavior: `src/services/apiService/newApiFamily/default/accountBootstrap.ts`

Important implementation boundaries from PR #1221:

- Run the exact New API extractor before legacy `localStorage.user`/cookie detection.
- Use `location.origin` for the refresh endpoint.
- Fall back to legacy behavior only for `404`, `405`, or unrelated response shapes.
- Surface `401`, `409`, and `429` as terminal modern-auth errors.
- Do not persist the Bearer, refresh cookie, SID, or AuthBundle.
- Disable replay/fallback around `/api/user/token` because it may regenerate the PAT.

## CodeDeck gap analysis

### Direct Cookie transport

- `src/shared/services/management-auth.ts:23` resolves `session_cookie` to a direct `Cookie` header.
- `src/shared/services/balance-service.ts:1685` sends that transport to `/api/user/self`.
- `src/shared/services/checkin-service.ts:291` discovers identity through `/api/user/self` using the same transport.
- `src/shared/services/checkin-service.ts:331` and `:819` use the saved transport directly for check-in status/action.

This is correct for legacy Cookie deployments but incompatible with rc.22 refresh cookies.

### Browser verification path

- `src/shared/electron/checkin-verification-service.ts:670` probes `/api/user/self` using Cookie authentication.
- `src/shared/electron/checkin-verification-service.ts:787` fabricates `localStorage.user` before opening the personal page.

Both assumptions are legacy-only. New API rc.22 explicitly removed persistent `localStorage.user` and requires the in-memory Bearer.

### Save boundary

- `electron/main.ts:3172` currently forwards the draft directly to `ProfileService.saveSiteBalanceSession`.
- `src/shared/services/profile-service.ts:491` validates and persists the draft but performs no credential conversion.

The Electron IPC save boundary is the narrowest place to add the rc.22 exchange because it has access to Electron sessions while keeping the shared persistence service platform-neutral.

## Electron feasibility

Context7's current Electron documentation confirms:

- `Session.fetch` uses Chromium's network stack and accepts `credentials: "include"`.
- `session.cookies.set()` can populate an isolated session cookie jar.
- `ClientRequest` accepts an explicit `session`, `origin`, `credentials`, and `useSessionCookies` option.

For secure-mode New API deployments, a narrow ClientRequest-based refresh is the most explicit way to satisfy the upstream OriginGuard while using only the isolated session's cookies. A temporary BrowserWindow should remain a fallback only if real Electron integration proves that the request origin cannot be represented correctly.

## Revised direction: persistent browser-managed sessions

The user prefers not to copy Cookie values or generate a management PAT. This is feasible and maps directly to the upstream dashboard session model.

The existing CodeDeck verification flow is a useful starting point, but it is intentionally ephemeral:

- `electron/main.ts:903` creates the verification session from a caller-provided non-`persist:` partition.
- `src/shared/electron/checkin-verification-service.ts:186` generates a random partition for each verification task.
- `src/shared/electron/checkin-verification-service.ts:471` clears storage when the task completes.

Electron's current contract is:

- `session.fromPartition("persist:<id>")` creates a disk-backed partition.
- a partition without `persist:` is in-memory only.
- persistent cookies are batched to disk; `cookies.flushStore()` can force a durable write.
- cookies without an expiry are not restored across application restarts, even in a persistent partition. New API rc.22's `new_api_refresh` cookie includes `Max-Age` and `Expires`, so it is eligible for persistence.

The upstream rc.22 source also confirms:

- refresh cookie name: `new_api_refresh`;
- path: `/api/user/auth`;
- `HttpOnly`, `SameSite=Strict`, optional `Secure`;
- expiry/Max-Age follows the login-session lifetime;
- every refresh rotates the cookie.

Therefore the browser session, rather than the encrypted profile record, should own the cookie lifecycle.

### Recommended runtime model

```text
SiteBalanceSession
  -> browser_session reference + expected user id + exact origin
  -> BrowserAccountSessionManager
       -> persist:codedeck-newapi-<opaque-id>
       -> transient { bearer, expiresAt, sid } in memory
       -> per-account refresh mutex
       -> login_required state

first use / re-login
  -> secured BrowserWindow using the account partition
  -> user completes site login and verification
  -> refresh/self probe confirms identity
  -> flush cookie store

balance/check-in
  -> ensure modern Bearer or legacy Cookie session
  -> execute in the same account partition
  -> one bounded refresh/retry on token expiry
  -> confirmed anonymous/revoked state => login_required
```

This design does not need `/api/user/token` and avoids invalidating an existing management PAT.

## Recommended implementation shape

The earlier Cookie-to-PAT exchange remains technically valid and matches All API Hub, but it is no longer the preferred CodeDeck product direction. Replace it with a single-responsibility Electron browser-account-session service:

```text
new account
  -> persistent per-account Electron partition
  -> interactive browser login
  -> modern refresh/AuthBundle or legacy Cookie identity probe
  -> persist only the local session reference and account identity

subsequent operations
  -> reuse the partition silently
  -> modern: refresh/retain memory-only Bearer
  -> legacy: send partition-owned browser cookies
  -> expired/revoked: mark login_required
```

This keeps raw browser credentials out of generic persistence and lets balance, check-in, and native verification reuse one authenticated context.

## Risks

- Refresh cookies rotate; an uncertain response must not be blindly replayed.
- The pasted cookie may belong to another account; identity must be validated before persistence.
- OriginGuard and SameSite=Strict behavior require a real Electron integration test, not only a mocked fetch unit test.
- Persistent Electron partitions contain sensitive browser state and must be origin-bound, non-exportable, and cleared on account deletion/logout.
- Browser-session accounts will require re-login on another machine because the encrypted profile export contains only a local reference.
- Hard-removing PAT/legacy modes would break old New API deployments and existing saved accounts; a staged deprecation is safer.
- The working tree already contains uncommitted authentication-isolation changes in overlapping files. Implementation must build on them without reverting user work.
