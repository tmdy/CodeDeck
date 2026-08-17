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

type ProfileBrowserTarget =
  | { kind: "default" }
  | { kind: "saved_session"; session_id: string }
  | { kind: "browser_slot"; slot: number }
  | { kind: "pending_browser_account" };

class BrowserAccountSessionManager {
  logout(accountKey: string, account: BrowserSiteBalanceSession): Promise<void>;
  deleteAccount(
    accountKey: string,
    account: BrowserSiteBalanceSession,
    clearWholePartition: boolean,
  ): Promise<void>;
}

class ProfileService {
  bindProfileSiteBalanceSession(
    profileKey: ProfileKey,
    baseUrl: string,
    sessionId: string,
  ): Promise<Profile>;
}

class PendingBrowserAccountReferenceRegistry {
  prepare(baseUrl: string): PendingBrowserAccountReference;
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
- Legacy browser mode uses the account `Session.fetch(..., { credentials: "include" })`; JavaScript never reads Cookies or builds a `Cookie` header. Legacy deployments may additionally require their page-client Bearer and user ID headers.
- For legacy identity only, the manager may read a minimal candidate after both the BrowserWindow URL and page execution context exactly match the bound account origin. It prefers positive-integer `localStorage.user.id` plus a non-empty `localStorage.user.token`, then falls back to positive-integer `localStorage.uid`; no other user fields are returned. LinuxDo and every other origin remain unread.
- Sub2API browser identity is another strict-origin legacy candidate: read positive-integer `localStorage.auth_user.id`, non-empty `auth_token`, and optional `refresh_token`; verify the root-level `id` returned by `/api/v1/auth/me`. Both tokens remain main-process runtime secrets and never enter renderer IPC or `SiteBalanceSession` persistence.
- A Sub2API 401 may call `/api/v1/auth/refresh` once per credential generation. Delayed 401 responses compare the Bearer/Refresh Token snapshot that issued the request: if credentials already rotated, retry with the latest Bearer; otherwise join the one in-flight refresh. An old response must never clear a newer `ready` state.
- A legacy candidate may produce `Authorization: Bearer <token>` and `New-Api-User: <id>` only through the account-origin bound fetch. The candidate becomes trusted only when `/api/user/self` returns the same user ID. The token remains in Electron main-process runtime memory and never enters `SiteBalanceSession`, renderer IPC, logs, or diagnostics.
- On cold start, legacy resolution first verifies Cookie plus the persisted account user ID. After an unauthenticated result, it may load the exact account origin in a hidden sandboxed BrowserWindow using the account's persistent partition, recover the minimal candidate, close the window, and re-run `/api/user/self`. This recovery never opens the interactive login UI.
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
- `ManagementRequestContext.headers` from browser authentication is the authoritative verified header set. Balance/check-in services merge it last, never replace its `Authorization`, and never expand its user ID into generic multi-vendor aliases; compatibility probing remains limited to manual PAT/Cookie credentials.
- A failed new-account login keeps its tentative partition in Electron main for a bounded retry lifetime. Repeated attempts for the same normalized base URL reuse that reference and one in-flight promise, preserving LinuxDo state without exposing it to the renderer.
- A successful new-account login consumes the tentative reference into the saved account. Retry expiry and normal application shutdown clear an unpersisted tentative partition. Failed migration and re-login behavior remains account-bound: a newly allocated migration partition is cleared immediately, while an existing browser account keeps its referenced partition.
- Closing an unfinished interactive login window is a verification request, not immediate cancellation: prevent destruction, await the coalesced active probe or run one final probe, then complete as `ready` only after the same-origin identity check succeeds; otherwise complete as `canceled` and close programmatically.
- Interactive login navigation and identity probes are bounded operations. A stalled page load or probe must fail/cancel within its configured timeout; a close request must never remain blocked behind an unbounded network promise. Programmatic completion must stop loading and ignore `beforeunload` handlers before closing.
- CodeDeck browser windows expose `back`, `forward`, `reload`, `stop`, and `close` navigation actions through the visible window menu, backed by Electron `webContents.navigationHistory`; browser navigation controls never use the system default browser.
- A verified browser login persists the sanitized account first. Existing Profiles bind through `ProfileService.bindProfileSiteBalanceSession`, which may change only `balance_session_id`; unsaved new Profiles keep the saved session selected only in renderer draft state.
- Balance testing must reject an empty `selection === "new"` draft before generic empty-new-to-auto normalization. Browser mode prompts for login; PAT mode prompts for credentials/save. A complete PAT draft may continue through the existing save-then-test flow, while explicit `selection === "auto"` remains unchanged.
- Profile Base URL opening uses a sandboxed CodeDeck BrowserWindow and a strict `ProfileBrowserTarget`. Saved sessions reuse their verified account partition, existing slots reuse their global opaque partition, and a new browser identity prepares/reuses a bounded pending partition before login. Auto/PAT browsing uses the dedicated application browser partition. Malformed targets, missing sessions/slots, and saved-session origin mismatches fail closed; this action never calls `shell.openExternal`.
- Entering a new browser-session draft defaults to the lowest numbered existing identity slot. It falls back to a new identity only when no slot exists, and later data refreshes must not overwrite an explicit user selection.
- `GET /api/user/checkin?month=YYYY-MM` may return `data.checkin_nonce`; the following POST must send `{ "checkin_nonce": "..." }`.
- Native verification polling must treat an explicit record for the current local date in `checkin_history`, `checkins`, `records`, or `history` as today's check-in only when the record is not an explicit failure; historical records and failed/error payloads must not complete the verification task.

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
- Malformed `localStorage.user`, an empty token, or a non-positive ID -> ignore that field and use a valid UID/Cookie fallback when available; otherwise `login_required`.
- Recovered legacy candidate ID differs from the saved or `/api/user/self` ID -> `login_required` with account-mismatch semantics; never retain the recovered Bearer.
- Sub2API `auth_user.id` differs from `/api/v1/auth/me.id` or the saved account ID -> `login_required`; clear only the matching credential generation, never a newer rotated runtime credential.
- Profile binding with a missing Profile -> `profile not found`; normalized Profile URL mismatch -> `Profile 与后台账号 Base URL 不一致`; missing session -> `后台账号不存在`.
- A manual close request may still accept the currently active or one final verified probe. After the task is formally completed as canceled/failed, or after explicit cancel/logout/delete, every late result is rejected and cannot restore `ready` or persist an identity.
- Empty new browser/PAT draft on balance test -> renderer error and no `profileManager.testBalance`; complete PAT draft -> save session/Profile first, then test.
- `manual_required` remains CAPTCHA-specific and must not be used for expired login state.
- API redirect -> expose the redirect response to authentication handling; never auto-follow it across origins.
- Canceled/failed new-account login -> retain the tentative reference only for the bounded retry lifetime; expiry/shutdown clears storage/cache/Cookies and drops runtime state.
- Malformed Profile browser target, missing slot/session, or saved-session origin mismatch -> reject the open request; never fall back to the default partition.

### 5. Good/Base/Bad Cases

- Good: Profile A and Profile B both bind their first backend account to slot 1 and reuse one LinuxDo login; deleting either binding preserves the other, while deleting the final binding clears the partition and frees slot 1.
- Good: a new browser-session draft opens the site in its pending/selected-slot partition, and the later login probe observes that exact same Chromium storage.
- Base: a PAT account continues using explicit Bearer transport and never touches browser-session state.
- Bad: opening a new browser-session draft in the generic Profile partition, silently falling back after an invalid target, deleting one shared binding's whole slot, or compacting slot 2 after deleting slot 1.

### Forbidden Patterns

- Persisting or logging refresh Cookies, AuthBundle payloads, modern or legacy Bearers, complete `localStorage.user` payloads, or SIDs.
- Sending browser secrets to renderer IPC or generic profile persistence.
- Copying browser Cookies into `access_token` or a manual `Cookie` header.
- Calling `/api/user/token` or fabricating `localStorage.user` in browser-session mode.
- Reading legacy identity candidates from LinuxDo or any non-account origin, returning fields beyond `user.id`, `user.token`, and fallback `uid`, or treating storage contents as proof of login without a matching `/api/user/self` response.
- Opening a login window from balance, check-in, or scheduler background work.
- Clearing persistent partition storage when a login/check-in window closes normally.
- Clearing a whole browser partition from account logout or from deletion while another binding references the slot.
- Renumbering sparse slots, or deriving browser account labels from array order.
- Allowing account-bound `Session.fetch` to use automatic redirect following.
- Adding generic `Veloera-User`, `X-Api-User`, or other vendor aliases to an already verified browser request context.
- Persisting Sub2API `auth_token`/`refresh_token`, sending them through renderer IPC, or refreshing again from a delayed 401 after credentials already rotated.
- Opening a Profile Base URL in the system default browser or a partition different from its selected browser account.
- Retaining a tentative new-account partition beyond its bounded retry lifetime or application shutdown, or retaining a failed migration partition.

### 6. Tests Required

- Persistence tests prove browser records drop credential fields and migrate legacy Cookie accounts in place.
- Persistence tests cover legacy one-to-one slot migration, same-reference slot reuse, conflicting references, stable sparse labels, and lowest-hole allocation.
- Manager tests cover slot-isolated partitions, origin-only logout/shared-reference deletion, final-reference partition cleanup, refresh serialization, cold-start SID omission, bounded SID retry, legacy classification, identity matching, and late-result rejection.
- Interactive close tests cover in-flight probe coalescing, one final probe after an earlier miss, verified close-to-ready, true close cancellation, programmatic close non-recursion, and rejection after confirmed cancellation.
- Interactive lifecycle tests cover stalled initial navigation and stalled final probes completing as bounded `failed`/`canceled` results, forced loading stop, and ignored `beforeunload` handlers.
- Browser-window navigation tests cover guarded history back/forward, reload, stop, visible menu wiring, and selected browser-session partition reuse.
- Interactive legacy-login tests cover exact-origin `localStorage.user.id/token`, malformed-user UID fallback, positive-integer validation, legacy request headers, response identity matching, secret non-disclosure, and refusal to read LinuxDo-origin storage.
- Cold-start legacy tests cover Cookie/user-ID first attempt, hidden persistent-partition recovery, candidate mismatch rejection, immediate hidden-window closure, and runtime secret cleanup on cancel/logout/delete/shutdown.
- Sub2API manager tests cover strict-origin storage reads, root-level identity, hidden-window recovery, runtime-only refresh tokens, one refresh for concurrent 401 responses, and delayed-401 retry with the latest Bearer.
- Navigation tests allow only account origin and the two fixed LinuxDo HTTPS origins.
- Lifecycle tests prove shutdown/window closure preserves all Chromium storage, logout clears only the binding origin, shared-reference deletion preserves LinuxDo state, and final-reference deletion clears the whole partition.
- Request tests assert `redirect: "manual"`; tentative-reference tests assert same-origin retry reuse, concurrent coalescing, success handoff, cross-origin isolation, TTL cleanup, and shutdown cleanup.
- Balance/check-in tests assert browser Cookie mode has no synthesized `Cookie` header and browser Bearer mode has no legacy user headers.
- Balance and check-in tests assert browser request-context headers cannot be overridden, do not trigger user-ID alias retries, and preserve manual PAT/Cookie compatibility probing, including learned and scheduled check-in paths.
- Scheduler/state tests cover explicit `login_required` and no-window/no-retry behavior.
- Profile service/IPC tests prove binding validates normalized URL/session existence and changes only `balance_session_id` plus related balance caches.
- Profile browser routing tests cover strict target parsing, default/saved/slot/pending partitions, missing slots, saved-session origin mismatch, normalized pending keys, and no silent default fallback.
- Renderer tests prove existing Profiles bind without saving unrelated draft fields, unsaved new Profiles remain unsaved, browser reference fields survive hydration, empty new browser/PAT drafts never route to API auto during balance testing, complete PAT drafts save before testing, and new browser drafts default to the lowest existing slot without overwriting later manual choices.

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

// Wrong: closing the login window immediately finalizes cancellation.
browserWindow.on("closed", () => completeLogin(task, canceledResult));

// Correct: close first performs one controlled verification decision.
browserWindow.on("close", (event) => {
  event.preventDefault();
  void finalizeLoginOnClose(task);
});

// Wrong: balance testing normalizes an unfinished new account to API auto.
await saveCurrentProfile();
await profileManager.testBalance(profileKey);

// Correct: reject empty new drafts before the generic normalization path.
if (isEmptyNewBalanceSessionDraft(selection, draft)) return showActionableError();

// Wrong: loses the browser account partition and opens outside CodeDeck.
await shell.openExternal(baseUrl);

// Correct: describe the intended partition explicitly and validate it in main.
await openProfileSiteBrowser(baseUrl, {
  kind: "saved_session",
  session_id: selectedBrowserSessionId,
});
```
