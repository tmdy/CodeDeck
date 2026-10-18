# Provider check-in proof and failure presentation

## 1. Scope / Trigger

Applies to provider-specific check-in execution, account-bound manual recovery, and renderer feedback. Read alongside [management authentication](./management-auth-contract.md) and [custom compatibility](./custom-compatibility-contract.md). An authenticated account is not proof that a daily reward was claimed.

## 2. Signatures

- `CheckinService.checkin(account, timeoutMs?, options?): Promise<CheckinResult>` selects the canonical AnyRouter action before generic learned-path/status probing.
- `isAnyRouterBaseUrl(baseUrl: string): boolean` compares the parsed origin to `https://anyrouter.top` and rejects URL userinfo.
- `CheckinVerificationServiceDependencies.configureRecoveryAction?: (window: BrowserWindow, retry: () => Promise<void>) => void` installs the explicit recovery action. Electron must supply it for AnyRouter.
- `CheckinVerificationResultStatus` includes `login_required`; main-process result merging preserves that status.
- `buildProfileCheckinEntries(profiles, sessions, states): Record<ProfileKey, CheckinAttentionEntry>` derives list attention from account state without another persisted flag.

## 3. Contracts

- Canonical action: `POST https://anyrouter.top/api/user/sign_in`, JSON `{}`, `X-Requested-With: XMLHttpRequest`, a saved `browser_session` account and verified `ManagementRequestContext`. Merge verified headers last; Chromium retains ownership of credentials. Never export Cookies or invent user-ID aliases.
- Only parsed exact HTTPS origin is supported by this built-in strategy. Similar hosts, subdomains, HTTP and nondefault ports do not select it. Explicit custom rules retain precedence in the main execution path.
- No verified read-only daily status endpoint exists for this provider. Do not require `/api/user/checkin?month=...`, including after a learned path was persisted. Login, `/api/user/self`, balance refresh and ordinary UI rendering never substitute for the action result.
- Require a successful HTTP status and a JSON object. An explicit check-in-related already-completed message may return `already_checked` even with `success: false`; otherwise require strict `success === true`, numeric `ret === 1` or numeric `code === 0`, with no contradictory envelope or failure message. Reward is optional and never inferred from balance growth.
- Manual recovery opens `/console/topup` in the same account partition. The visible `验证完成并重试` menu action verifies matching `/api/user/self` identity, then runs one check-in attempt. Concurrent clicks are coalesced. No injected generic auto-click script, monthly status polling or repeated POST polling is permitted for AnyRouter.
- Pending challenge responses keep the window open. Closing or timing out cannot report success, and identity responses arriving after cancellation cannot submit the action. Automatic jobs keep the existing deferred-verification policy and never open an interactive window.
- Main execution persists results by normalized base URL plus account ID. Only confirmed success/already-checked supplies the successful-day marker through the existing persistence path.
- List attention applies only to explicitly bound accounts with auto check-in enabled. Same-account profiles agree; other accounts and unbound profiles receive no inherited result. Failed is red; login/manual/unsupported is amber. Running/verifying/scheduled and confirmed success do not display stale failure attention. Disabling auto check-in removes the list cue while leaving detail history.
- Selected details show readable text/icon, reason, last attempt time, and `role="status"`; recovery reuses existing retry/login/verification/disable actions. Theme colors apply to panels, labels and recovery controls. Profile health stays independent.
- No new environment variables or credential storage are introduced.

## 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| PAT-only AnyRouter account or missing browser request context | `login_required`, explicit browser-login guidance; no Cookie guessing |
| Missing verified user ID | Unsuccessful `user_id_missing` result |
| Confirmed JSON authentication rejection | `login_required` |
| HTML or JSON challenge | `manual_required`; recovery identity probe stays open and sends no check-in action |
| Identity mismatch | `account_mismatch`, no action |
| 404/405 action response | `unsupported` |
| Rate limit, server failure or rejected business envelope | `failed`, existing actionable error classification |
| Ordinary HTML/empty JSON/plain HTTP 200 | Unconfirmed failure |
| Lost action response | `failed` with unconfirmed-result guidance; never replay automatically |
| `already checked balance` / `already signed out` | Not check-in proof |
| Explicit close or timeout | Recoverable manual state, no success marker |

## 5. Good / Base / Bad Cases

- Good: an opted-in canonical account with a stale generic capability still sends exactly one authenticated `sign_in` action; `{ "success": true }` satisfies the day.
- Base: a challenge leaves amber feedback until the user completes verification and explicitly retries. A normal New API account keeps its existing monthly nonce flow.
- Bad: treating successful identity lookup, a signed-in avatar, generic `already` text or a closed verification window as successful check-in; mixing same-site account failures; showing only a color without text.

## 6. Tests Required

- `services/checkin-service.test.ts`: canonical origin, body/headers/transport, repeated execution with stale cache, strict envelopes, already-completed messages, login/challenge/HTML/rate-limit/lost-response handling, no POST replay, and unchanged generic flows.
- `electron/checkin-verification-service.test.ts`: explicit retry, matching partition/identity, one in-flight action, challenge persistence including identity HTTP 403 HTML/JSON, mismatch, close-before-identity, and unchanged generic/custom recovery.
- `checkin/presentation.test.ts`: exact binding, same-account consistency, disabled-auto behavior, hydrated failure and successful-state replacement.
- Component tests: unselected list feedback, recovery callbacks, semantic status, attempt timestamp and removal after success. Inspect both themes and a compact list with actual components and synthetic data.
- Record automated/visual evidence separately from a real account attempt; fixtures and builds cannot establish a live reward or the website's login-trigger behavior.

## 7. Wrong vs Correct

```typescript
// Wrong: identity is not daily check-in proof.
return { success: identityResponse.success, status: "success" };

// Correct: an explicit user recovery action checks identity before one action.
if (task.finished || task.retryRunning) return;
// Verify the target identity with the authoritative request context first.
const result = await new CheckinService().checkin(account, 12_000, {
  managementRequestContext,
});
// Preserve the returned challenge/failure unless action evidence confirms completion.
```

Source provenance: `.trellis/tasks/09-12-anyrouter-checkin-feedback/research/upstream-anyrouter.md` records pinned All API Hub, MetAPI and supporting AnyRouter client revisions. It does not claim a live server verification.
