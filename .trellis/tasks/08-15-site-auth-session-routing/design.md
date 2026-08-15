# Design: Browser auth persistence and balance routing

## Boundaries

The fix spans three existing ownership boundaries without merging them:

1. `BrowserAccountSessionManager` owns interactive browser verification and persistent Electron partitions.
2. `ProfileService` owns durable account records and Profile-to-account bindings.
3. `App.tsx` owns draft UX and decides whether the user is editing an existing Profile or creating a new one.

No browser credential crosses into renderer state. Renderer receives only the existing sanitized `SiteBalanceSession` reference.

## Login verification flow

Refactor the interactive probe into a coalesced operation that can be awaited by both the periodic poller and the window-close path. The probe keeps the current invariants:

- modern mode validates the AuthBundle and `/api/user/self` identity;
- legacy mode reads a minimal candidate only from the exact account origin: prefer positive-integer `localStorage.user.id` plus optional non-empty `localStorage.user.token`, then fall back to positive-integer `localStorage.uid`;
- unrelated origins cannot provide identity candidates;
- late results after a confirmed cancellation remain rejected.

The legacy identity request may attach `Authorization: Bearer <token>` when the exact-origin candidate supplied a token and may attach `New-Api-User: <id>` for compatibility. These headers are scoped to the account-origin `/api/user/self` verification and subsequent account-bound main-process requests. The candidate becomes trusted only when `/api/user/self` returns the same user ID.

Legacy Bearers are runtime-only secrets owned by `BrowserAccountSessionManager`. They are never added to `SiteBalanceSession`, renderer IPC, logs, diagnostic payloads, or generic persistence. Cancellation, logout, deletion, and shutdown clear the in-memory candidate.

Sub2API follows the same strict-origin runtime-secret boundary with its native storage contract: `auth_user.id`, `auth_token`, optional `refresh_token`, and `/api/v1/auth/me`. Its current-user response exposes `id` at the root. A 401 may rotate the runtime tokens through `/api/v1/auth/refresh`; concurrent or delayed 401 responses compare against the credential snapshot that issued the request, reuse one in-flight refresh, and must not clear a newer ready state.

On cold start, first try the existing Cookie plus persisted account user ID path. If identity verification returns unauthenticated, open a hidden sandboxed BrowserWindow in the account's persistent partition, restrict it to the exact account origin, read the minimal legacy candidate after same-origin load, close it immediately, and retry `/api/user/self`. This recovery must not show an interactive login window and must not treat storage contents alone as proof of login.

When the user requests window close while the task is unfinished, prevent immediate destruction, await the active probe or run one final probe, then:

- complete as `ready` and close programmatically when identity is verified;
- complete as `canceled` and close when the final probe still cannot verify login.

Programmatic close after `task.finished = true` must not recursively start another probe.

The probe should emit sanitized diagnostic events for capability/result classification and HTTP status only. It must never log payloads, Cookies, Bearers, SIDs, localStorage values, or full URLs containing query parameters.

## Persistence and binding flow

`completeBrowserAccountLogin` continues to persist the sanitized browser account and slot only after verified identity.

Add a narrow `ProfileService` operation for binding an existing Profile to a saved site balance session. It validates:

- the Profile exists;
- normalized Profile URL and session base URL match;
- the target session exists.

Expose that operation through typed IPC. After a successful new browser login:

- if `editingKey` identifies an existing Profile, bind only `balance_session_id`, reload canonical data, and show the saved account;
- if this is an unsaved new Profile, keep the saved account selected in the draft without persisting unrelated Profile fields.

This avoids using `saveCurrentProfile` as an implicit transaction, which could save unrelated unsaved edits.

## Balance routing guard

Before `resolveUnsavedProfileChanges()` in `handleTestBalance`, inspect the current balance-session draft:

- `selection === "new"` with no verified saved session is invalid for balance testing;
- show an actionable browser-login/PAT-save message and return without `profileManager.testBalance`;
- `selection === "auto"` keeps existing behavior;
- a saved session selection continues through the existing save-if-dirty path.

The generic empty-new-to-auto normalization may remain for navigation/profile-save compatibility, but balance testing must not use it to hide an incomplete authentication flow.

## Profile browser flow

The Profile Base URL action opens a sandboxed CodeDeck BrowserWindow instead of `shell.openExternal`. When the selected balance session is a browser account, the window uses that account's opaque persistent partition so management browsing and background requests observe the same login state. Profiles without a selected browser account use a separate stable application browser partition.

For browser-authenticated management requests, `ManagementRequestContext.headers` is the authoritative header set produced after identity verification. `BalanceService` and `CheckinService` must pass those headers through without expanding the user ID into generic multi-vendor compatibility aliases. The legacy browser manager already supplies the exact `Authorization` and `New-Api-User` pair accepted by the verified origin; adding unrelated aliases can change backend middleware behavior and invalidate an otherwise valid session.

## Compatibility

- Existing PAT and explicit auto-auth Profiles are unchanged.
- Existing browser sessions remain valid and retain stable partition names and slots.
- Legacy `localStorage.user` sites gain runtime Bearer recovery without changing the persisted account schema.
- Existing canceled-login TTL cleanup remains unchanged after a confirmed cancellation.
- No migration is required because the persisted schema does not change.

## Rollback

The changes are isolated behind existing browser-auth and profile IPC boundaries. Rollback consists of reverting legacy candidate extraction/recovery, the close-finalization probe, binding IPC, and renderer guard; no stored-data rollback is necessary because no secret or schema is persisted.
