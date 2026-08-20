# Custom Balance and Check-in Compatibility Contract

## Scenario: Opt-in rules for non-standard management sites

### 1. Scope / Trigger

- Applies only when a saved `SiteBalanceSession` has `custom_compatibility.enabled === true`.
- Existing accounts with no custom rule, or a disabled draft, keep the legacy balance discovery and check-in learning paths unchanged.
- Electron main owns requests, browser partitions, page execution, and selector windows. The renderer receives declarative rule metadata and sanitized selector results only.

### 2. Signatures

```typescript
interface SiteCustomCompatibility {
  enabled: true;
  identity_origin?: string;
  login_url?: string;
  identity_mode: "standard" | "user_confirmed";
  balance?: CustomBalanceRule;
  checkin?: CustomCheckinRule;
}

class CustomCompatibilityExecutor {
  queryBalance(profile, rule, timeoutMs, options): Promise<BalanceCheckState>;
  checkin(rule, timeoutMs, options): Promise<CheckinResult>;
}

function customCompatibilityPartitionName(accountKey: string): string;
function createChromiumFetch(
  challengeTimeoutMs?: number,
  fixedPartition?: string,
): typeof fetch;

interface OpenCheckinVerificationOptions {
  browserSessionPartition?: string;
  customPageRule?: CustomCheckinRule;
  customApiRule?: CustomCheckinRule;
  customApiProbe?: () => Promise<CheckinResult>;
}
```

### 3. Contracts

- Rules are declarative. They may contain HTTP(S) URLs, GET/POST method, bounded request body, JSON path, CSS selector, attribute, regex, numeric format, unit, and success/already-checked sources. Arbitrary JavaScript is forbidden.
- Profile inference URL, management/identity origin, login URL, balance target, check-in API target, and check-in page URL are independent fields.
- `identity_mode: "standard"` still requires verified backend identity and a positive user ID. `identity_mode: "user_confirmed"` completes only when the user closes the login window to confirm the current browser identity; it persists no fabricated user ID and never enters standard endpoint discovery.
- Same-origin API credentials may use the account's existing verified transport. Cross-origin PAT/Bearer forwarding requires `credential_forwarding: "explicit_origin"`, exact normalized source and target origins, and a valid `confirmed_at`. Changing the target origin invalidates confirmation.
- Chromium sends page Cookies according to the target domain. Code must not read, synthesize, return, or persist browser Cookies, runtime Bearers, SIDs, challenge answers, raw headers, full HTML, or storage payloads.
- Every saved custom account has one stable account-scoped partition. Browser accounts reuse their opaque browser partition; non-browser accounts use a hashed `buildCheckinAccountKey(baseUrl, sessionId)` partition. Custom API fetch, balance/check-in page execution, CAPTCHA handoff, API re-probe, and element selection must all use that same partition.
- API requests use `redirect: "manual"`. A custom API challenge opens only the configured `page_url` for a direct manual action, then polls the original custom API through `customApiProbe`. A non-`manual_required` probe failure is terminal. Scheduled automatic check-in never opens a window.
- A custom page rule clicks only the saved `action_selector` and polls only saved success/already-checked selectors. It never falls back to guessed button text.
- For a saved account, the selector assistant may open only a URL already declared by that account's custom rule. For a new unsaved account, it is restricted to the Profile/base origin. It returns only `{ selector, previewText }`.
- Saving and hydration use the existing encrypted Profile configuration path. Disabled rules normalize to `undefined`; incomplete enabled rules fail without replacing the saved configuration.

### 4. Validation & Error Matrix

- No custom rule -> legacy balance/check-in behavior.
- Enabled rule with neither balance nor check-in -> configuration error.
- `user_confirmed` without `login_url` -> configuration error.
- Non-HTTP(S) URL, empty path/selector, invalid regex, GET body, or incomplete page action -> configuration error.
- Stale or mismatched cross-origin confirmation -> credential forwarding becomes `none`.
- Custom target 3xx -> explicit redirect/security failure; never follow to another origin.
- Custom target 401/403 -> rule authentication/login failure; never try Profile API Key or another account.
- Missing JSON path/CSS selector or numeric parse failure -> actionable rule failure naming the configured field.
- API challenge without `page_url` -> remain `manual_required` with an actionable request to configure the page URL.
- Verification cancellation/timeout -> remain retryable `manual_required`; success/already-checked -> terminal success.
- Deleting a non-browser custom account -> clear only its custom partition and cache. Browser-account deletion continues to follow the shared-slot cleanup contract.

### 5. Good/Base/Bad Cases

- Good: Profile API is `api.vendor.test`, login is `id.vendor.test`, balance is `wallet.vendor.test`, and check-in is `daily.vendor.test`; each exact target executes from the saved rule without changing Profile grouping.
- Good: an API returns Turnstile HTML, the user completes the configured challenge page, and the original API succeeds because both paths share the account partition.
- Base: a standard New API account has no custom rules and continues using learned balance/check-in endpoints.
- Bad: opening the challenge page in a default partition while probing the API in an isolated fetch partition, causing the completed challenge Cookie to be invisible.
- Bad: exporting page HTML/Cookies to renderer, following redirects automatically, guessing a check-in button, or falling back to the Profile API Key after a custom-rule failure.

### 6. Tests Required

- Normalization tests cover disabled/partial rules, URL/path/selector bounds, exact-origin confirmation invalidation, and user-confirmed login requirements.
- Persistence tests prove encrypted round-trip, cloning, update/delete, old-config compatibility, and removal of unknown secret-like fields.
- Executor tests cover GET/POST JSON balance, page balance, API/page check-in, redirects, 401/403, timeout, and challenge classification.
- Browser-login tests cover independent login/identity origins, `user_confirmed` close-to-ready behavior, no fabricated user ID, and allowed-origin navigation.
- Verification tests cover configured challenge page -> original API success, non-challenge probe failure, cancellation, timeout, and no page-action script for API mode.
- Partition tests assert stable per-account isolation and shared use by API, page execution, verification, and selector routing.
- Renderer tests cover collapsed default UI, independent balance/check-in toggles, saved hydration, and unchanged two-argument login calls when no custom rule is enabled.

### 7. Wrong vs Correct

```typescript
// Wrong: challenge completion and API polling cannot share Cookies.
const request = createChromiumFetch();
const page = pageService.createTransport(DEFAULT_PROFILE_BROWSER_PARTITION);

// Correct: all custom operations use the saved account partition.
const partition = customCompatibilityPartition(account);
const request = createChromiumFetch(8_000, partition);
const page = pageService.createTransport(partition);
```

```typescript
// Wrong: changes the legacy renderer call shape for every account.
loginBrowserAccount(baseUrl, slot, undefined);

// Correct: pass custom metadata only when the opt-in rule is enabled.
customCompatibility
  ? loginBrowserAccount(baseUrl, slot, customCompatibility)
  : loginBrowserAccount(baseUrl, slot);
```
