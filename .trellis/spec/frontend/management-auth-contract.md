# Management Authentication Contract

## Scenario: Explicit backend-account authentication

### 1. Scope / Trigger

- Applies when balance or check-in uses a saved `SiteBalanceSession`.
- Keeps PAT, browser Bearer, browser Cookie, and deprecated pasted-Cookie records isolated.
- Browser credentials and Chromium storage are owned only by Electron main.

### 2. Signatures

```typescript
type SiteBalanceAuthKind = "browser_session" | "access_token" | "session_cookie";

interface ManagementRequestContext {
  fetch: typeof fetch;
  headers: Readonly<Record<string, string>>;
  userIdHeaderPolicy: "omit" | "legacy_if_required";
  authMode: "browser_bearer" | "browser_cookie";
}

interface BrowserIdentitySlot {
  slot: number;
  browser_session_id: string;
}

interface BrowserSiteBalanceSession {
  auth_kind: "browser_session";
  browser_session_id: string;
  browser_slot: number;
  browser_origin: string;
  user_id: string;
}

class BrowserAccountSessionManager {
  logout(accountKey: string, account: BrowserSiteBalanceSession): Promise<void>;
  deleteAccount(
    accountKey: string,
    account: BrowserSiteBalanceSession,
    clearWholePartition: boolean,
  ): Promise<void>;
}

class PendingBrowserAccountReferenceRegistry {
  run<T>(
    baseUrl: string,
    operation: (pending: PendingBrowserAccountReference) => Promise<T>,
  ): Promise<T>;
  shutdown(): Promise<void>;
}
```

### 3. Contracts

- `access_token` sends exactly `Authorization: Bearer <token>` plus existing compatibility headers.
- `browser_session` persists only a stable positive `browser_slot`, its canonical opaque partition reference, exact account origin, and verified user ID.
- Modern New API refresh uses the account partition, same-origin `Origin`, a per-account mutex, memory-only Bearer/SID state, and one confirmed SID-mismatch retry without SID.
- Legacy browser mode uses the account `Session.fetch(..., { credentials: "include" })`; JavaScript never reads Cookies or builds a `Cookie` header.
- During interactive legacy login only, the manager may read `localStorage.uid` after both the window URL and the page execution context exactly match the bound account origin. The value must be normalized as a positive integer, may be sent as `New-Api-User` only on the `/api/user/self` identity probe, and becomes trusted only when the response returns the same identity. LinuxDo-origin storage and every credential-bearing storage field remain unread.
- Deprecated `session_cookie` records are migration-only, produce `login_required`, and are never sent directly.
- Browser partitions retain Cookies, localStorage, IndexedDB, Service Workers, and other Chromium storage across window closure and app restart.
- Login navigation is restricted to the account origin plus exact HTTPS origins `https://connect.linux.do` and `https://linux.do`; all other cross-origin navigation, popups, downloads, webviews, and permissions are denied.
- Browser identity slots are global across Profiles and backend origins. Every binding labeled `账号1` uses slot 1, every binding labeled `账号2` uses slot 2, and so on; bindings in the same slot share one opaque persistent partition and LinuxDo state.
- Different slot numbers must map to different opaque partition references. A configured slot number cannot be rebound to another partition identity.
- Slot numbers are stable and sparse. Deleting slot 1 never renumbers slot 2; allocation always chooses the lowest unused positive slot.
- Existing browser records migrate without merging identities: records with the same partition reference reuse one slot, while different references receive different slots.
- A shared partition does not broaden request or navigation authority. Each binding remains restricted to its own exact `browser_origin` plus the two trusted LinuxDo origins.
- Logout clears transient account state and calls `clearStorageData({ origin: browser_origin })`; it does not clear the whole partition, shared LinuxDo state, or another binding's origin.
- Deletion clears only the binding origin while another binding references the same partition. The final reference clears storage and cache for the whole partition, then removes the slot registry entry.
- Account-bound management fetches use `redirect: "manual"`; code must never silently follow an API redirect outside the bound account origin.
- A failed new-account login keeps its tentative partition in Electron main for a bounded retry lifetime. Repeated attempts for the same normalized base URL reuse that reference and one in-flight promise, preserving LinuxDo state without exposing it to the renderer.
- A successful new-account login consumes the tentative reference into the saved account. Retry expiry and normal application shutdown clear an unpersisted tentative partition. Failed migration and re-login behavior remains account-bound: a newly allocated migration partition is cleared immediately, while an existing browser account keeps its referenced partition.
- `GET /api/user/checkin?month=YYYY-MM` may return `data.checkin_nonce`; the following POST must send `{ "checkin_nonce": "..." }`.

### 4. Validation & Error Matrix

- Empty PAT -> missing backend credential.
- Missing browser reference/origin/identity -> invalid browser record.
- Missing or non-positive `browser_slot` -> invalid browser record.
- Slot number already mapped to another `browser_session_id` -> reject the save; never overwrite or merge identities.
- Slot removal while any browser account still references it -> reject the removal.
- Confirmed anonymous, expired, or revoked browser session -> `login_required`; no legacy/PAT downgrade.
- `404`, `405`, or a response unrelated to the pinned AuthBundle -> legacy browser-cookie capability.
- Modern-shaped `401`, `409`, `429`, revocation, or protocol error -> terminal modern result; never downgrade.
- Identity mismatch during re-login -> reject without changing the saved account.
- Closing, canceling, logging out, or deleting during an identity probe rejects every late result; it cannot restore `ready` state or persist an identity.
- `manual_required` remains CAPTCHA-specific and must not be used for expired login state.
- API redirect -> expose the redirect response to authentication handling; never auto-follow it across origins.
- Canceled/failed new-account login -> retain the tentative reference only for the bounded retry lifetime; expiry/shutdown clears storage/cache/Cookies and drops runtime state.

### 5. Good/Base/Bad Cases

- Good: Profile A and Profile B both bind their first backend account to slot 1 and reuse one LinuxDo login; deleting either binding preserves the other, while deleting the final binding clears the partition and frees slot 1.
- Base: a PAT account continues using explicit Bearer transport and never touches browser-session state.
- Bad: deleting one shared binding clears the whole slot, or deleting slot 1 compacts slot 2 into slot 1.

### Forbidden Patterns

- Persisting or logging refresh Cookies, AuthBundle payloads, dashboard Bearers, or SIDs.
- Sending browser secrets to renderer IPC or generic profile persistence.
- Copying browser Cookies into `access_token` or a manual `Cookie` header.
- Calling `/api/user/token` or fabricating `localStorage.user` in browser-session mode.
- Reading legacy identity candidates from LinuxDo or any non-account origin, reading any localStorage field other than `uid`, or treating the candidate as proof of login without a matching `/api/user/self` response.
- Opening a login window from balance, check-in, or scheduler background work.
- Clearing persistent partition storage when a login/check-in window closes normally.
- Clearing a whole browser partition from account logout or from deletion while another binding references the slot.
- Renumbering sparse slots, or deriving browser account labels from array order.
- Allowing account-bound `Session.fetch` to use automatic redirect following.
- Retaining a tentative new-account partition beyond its bounded retry lifetime or application shutdown, or retaining a failed migration partition.

### 6. Tests Required

- Persistence tests prove browser records drop credential fields and migrate legacy Cookie accounts in place.
- Persistence tests cover legacy one-to-one slot migration, same-reference slot reuse, conflicting references, stable sparse labels, and lowest-hole allocation.
- Manager tests cover slot-isolated partitions, origin-only logout/shared-reference deletion, final-reference partition cleanup, refresh serialization, cold-start SID omission, bounded SID retry, legacy classification, identity matching, and late-result rejection.
- Interactive legacy-login tests cover exact-origin `localStorage.uid` access, positive-integer validation, the one-request `New-Api-User` scope, response identity matching, and refusal to read LinuxDo-origin storage.
- Navigation tests allow only account origin and the two fixed LinuxDo HTTPS origins.
- Lifecycle tests prove shutdown/window closure preserves all Chromium storage, logout clears only the binding origin, shared-reference deletion preserves LinuxDo state, and final-reference deletion clears the whole partition.
- Request tests assert `redirect: "manual"`; tentative-reference tests assert same-origin retry reuse, concurrent coalescing, success handoff, cross-origin isolation, TTL cleanup, and shutdown cleanup.
- Balance/check-in tests assert browser Cookie mode has no synthesized `Cookie` header and browser Bearer mode has no legacy user headers.
- Scheduler/state tests cover explicit `login_required` and no-window/no-retry behavior.

### 7. Wrong vs Correct

```typescript
// Wrong: follows redirects without re-validating the destination.
accountSession.fetch(url, { credentials: "include" });

// Correct: the authentication layer owns redirect classification.
accountSession.fetch(url, {
  credentials: "include",
  redirect: "manual",
});

// Correct: retry a failed new-account login through the bounded registry.
pendingReferences.run(normalizedBaseUrl, (pending) =>
  completeBrowserAccountLogin(pending.reference),
);

// Wrong: deleting one account always destroys the shared identity slot.
await manager.deleteAccount(accountKey, account, true);

// Correct: the main-process owner decides cleanup from the remaining references.
const clearWholePartition = remainingReferences.length === 0;
await manager.deleteAccount(accountKey, account, clearWholePartition);
```
