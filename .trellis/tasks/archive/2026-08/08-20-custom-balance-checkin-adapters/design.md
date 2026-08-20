# Technical design

## 1. Data model and compatibility boundary

Add an optional `custom_compatibility` field to `SiteBalanceSession`. Keep it absent for existing accounts and normalize it to `undefined` when disabled. The persisted rule contains only declarative, non-secret data:

```ts
type CustomCompatibilityMode = "api" | "page";
type CustomCredentialForwarding = "none" | "explicit_origin";
type CustomValueSource = {
  kind: "json_path" | "css_selector";
  path_or_selector: string;
  attribute?: string;
  regex?: string;
  number_format?: "plain" | "comma" | "decimal";
};

interface CustomBalanceRule {
  mode: CustomCompatibilityMode;
  target_url: string;
  method?: "GET" | "POST";
  request_body?: string; // template without secrets
  remaining?: CustomValueSource;
  total?: CustomValueSource;
  used?: CustomValueSource;
  unit?: string;
  success_path?: string;
  page_url?: string;
  credential_forwarding: CustomCredentialForwarding;
  credential_source_origin?: string;
  confirmed_at?: string;
}

interface CustomCheckinRule {
  mode: CustomCompatibilityMode;
  target_url: string;
  method?: "GET" | "POST";
  request_body?: string;
  action_selector?: string;
  success?: CustomValueSource;
  already_checked?: CustomValueSource;
  page_url?: string;
  credential_forwarding: CustomCredentialForwarding;
  credential_source_origin?: string;
  confirmed_at?: string;
}

interface SiteCustomCompatibility {
  enabled: boolean;
  login_url?: string;
  identity_mode: "standard" | "user_confirmed";
  balance?: CustomBalanceRule;
  checkin?: CustomCheckinRule;
}
```

Use a discriminated `api`/`page` rule rather than arbitrary JavaScript. Normalize URLs to exact origins/absolute URLs, reject non-HTTP(S), reject empty selectors/paths, cap body/regex/selector lengths, and ensure a rule is complete before `enabled` can be true. A custom target URL is not used as the account's canonical grouping key; the account remains grouped under its existing Profile/base URL.

## 2. Shared parsing module

Create one pure utility (for example `src/shared/services/custom-compatibility.ts`) that owns:

- dot/bracket JSON-path traversal without expression evaluation;
- numeric extraction from JSON values or sanitized element text/attributes;
- HTML extraction through a DOM implementation available to the renderer/main test setup;
- balance item construction and success/already-checked classification;
- rule normalization and target-origin authorization checks.

The module accepts `unknown`/text and returns typed outcomes. No service or React component should duplicate field parsing.

## 3. Main-process request execution

Add a small custom-rule executor owned by Electron/main orchestration or a shared service with injected request/page dependencies:

```text
runBalance(Profile, SiteBalanceSession)
  ├─ custom rule enabled + valid -> CustomCompatibilityExecutor
  └─ otherwise -> existing BalanceService discovery unchanged

runCheckin(account)
  ├─ custom API rule -> executor request + classifier
  ├─ custom page rule -> persistent BrowserWindow/page executor
  └─ no custom rule -> existing CheckinService path
```

API execution uses the exact rule target URL and does not follow redirects across origins. PAT or browser Bearer forwarding is permitted only when `credential_forwarding === "explicit_origin"`, `confirmed_at` exists, and the current source origin and exact target origin match the saved authorization. The default is no credential forwarding. Browser Cookie transport is never synthesized; a page request uses the selected persistent partition and browser-native `fetch` so the target domain receives only its own cookies.

For browser-session accounts, the existing manager remains strict for standard requests. Add a separate target-allowlist operation that accepts an already validated custom target origin and an explicit authorization record; do not loosen `buildBoundFetch` or standard balance/check-in contexts.

## 4. Page rules and CAPTCHA flow

Extend the verification/page executor with options for `page_url`, `action_selector`, and success/already-checked sources. Navigation allowlisting is the union of:

- the saved login origin;
- the exact custom page origin;
- fixed trusted OAuth origins only where the existing login flow requires them.

The page executor runs in the account's persistent partition, has sandbox/context isolation/no Node/no downloads/popups/permissions, and uses `redirect: "manual"` for programmatic page fetches. It may click only the saved selector, never a guessed text match in custom mode. If a challenge is detected or the action requires human interaction, return `manual_required` and open the page only for a direct manual request. After the user finishes, poll only the saved success/already-checked sources.

The selector assistant is a dedicated, constrained BrowserWindow action. It highlights hovered elements, lets the user confirm one element, generates a stable CSS selector, and sends back only `{ selector, previewText }` through a narrow IPC. It must reject selectors that target scripts, inputs containing password/token values, or elements outside the declared page origin.

## 5. Renderer and persistence UX

Keep the existing `SiteBalanceSessionPanel` default layout unchanged. Add a collapsed “自定义兼容规则” section visible only for a saved/new backend account. It provides:

- enable toggle and rule type (API / webpage) for balance and check-in;
- URL/method/body and JSON-path fields;
- page URL, selector fields, and “打开元素选择器” actions;
- a clear source-origin/target-origin credential-forwarding warning and explicit confirmation control;
- per-rule test/preview and validation errors.

The renderer receives sanitized rule metadata only. Saving uses the existing `ProfileService.saveSiteBalanceSession` path so encryption, credential-change invalidation, and update timestamps remain centralized.

## 6. IPC contracts

Add typed preload/main handlers for:

- validate/preview custom rules;
- open selector assistant for a declared page and account target;
- return a sanitized selector result;
- optional direct rule test for the selected account.

Do not expose generic `executeJavaScript`, raw response bodies, page HTML, headers, cookies, or storage to the renderer.

## 7. Error and fallback policy

- Explicit custom mode + malformed/incomplete rule: fail with an actionable configuration error; do not fall back to API Key or standard discovery.
- Custom target 401/403: report authentication failure for that rule; do not try another account, origin, or transport.
- Custom target 3xx: report redirect/authorization error unless the redirect remains the exact declared origin and is explicitly allowed by the executor.
- Missing selector/path or parse failure: report which configured rule field failed and retain the saved rule.
- No custom mode / disabled rule: preserve all current BalanceService and CheckinService behavior.

## 8. Rollout and rollback

Implement in layers: pure rule types/normalization/parsers; service executor; persisted account field; main-process routing/IPC; selector assistant and verification integration; renderer panel; tests. The feature is opt-in and can be disabled by removing/turning off the rule without changing standard account records. If page execution is unavailable, API/custom rules and all legacy paths remain usable.

