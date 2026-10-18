# AnyRouter check-in and visible failure feedback

Status: approved by the user's subsequent `确认` message on 2026-09-12. Implement within this reviewed scope.

## Architecture and boundaries

Use the existing account model, browser-session manager, check-in service, result persistence, and renderer subscriptions. A saved browser session remains the source of authentication; the check-in service only selects and executes the supported site action. Renderer components consume sanitized account states.

There is no new password store, cookie export, background login automation, scheduler, or notification service.

## AnyRouter action contract

1. Recognize the canonical management origin `https://anyrouter.top` from pinned upstream evidence, using the parsed exact HTTPS origin rather than substring matching. Keep aliases and inference mirrors without management-protocol evidence under the existing explicit custom-rule mechanism. Custom check-in rules retain precedence. The site's recommended check-in navigation page is `/console/topup`.
2. Use the already verified browser request context to issue `POST /api/user/sign_in` with JSON `{}` and `X-Requested-With: XMLHttpRequest`. Preserve the context's authoritative account identity headers and Chromium-owned credentials. Do not synthesize generic vendor aliases, read cookies, or swap in an unrelated API key.
3. AnyRouter's path has no verified read-only daily status endpoint. Do not require generic `/api/user/checkin?month=...` to succeed before calling the action, and never treat successful `/api/user/self`, login, or balance retrieval as successful check-in.
4. Classify a successful HTTP response using the provider's evidenced business envelope: strict `success === true`, numeric `ret === 1`, or numeric `code === 0`. Recognize explicit check-in-related already-checked messages, reject malformed/HTML responses and contradictory success/error fields, and preserve actionable auth, challenge, rate-limit, network, and server outcomes. Apply these extra success fields only within this strategy, not to arbitrary upstreams. A lost action response remains unconfirmed with retry guidance; never retry an uncertain POST automatically or claim a reward.
5. Existing account state marks a day satisfied only after a confirmed action result. Reward is optional; do not infer a fixed daily dollar value or convert balance deltas into a check-in reward.
6. Reuse the action-only semantics on subsequent runs and after restart. A learned sign_in path must not lead back into a nonexistent generic status probe; deterministic path failure invalidates only the relevant account capability entry.
7. An access-token-only AnyRouter account that cannot perform session-authenticated check-in should receive a clear browser-login action. Do not reinterpret a PAT as a Cookie or acquire a new PAT by rotating user credentials.

## Authentication challenges and manual recovery

- Automatic jobs remain silent background work. A challenge produces `manual_required`; expired authentication produces `login_required`. No login or verification window opens automatically.
- User-triggered recovery reuses the same account partition and exact-origin navigation rules.
- Generic New API verification retains its existing identity-plus-read-only-status proof.
- AnyRouter verification must not depend on the generic monthly check-in status endpoint. After the user completes the site challenge, an explicit `验证完成并重试` action checks the matching account identity and performs one bounded sign_in confirmation attempt. If proof is unavailable, preserve `manual_required` and let the user explicitly retry; do not repeatedly poll a POST action. Reuse the existing verification UI/window instead of adding a second browser subsystem.
- Window closure, an avatar, successful page loading, or authenticated identity alone does not clear the failed check-in state. Cancellation/timeout remains recoverable, and account mismatch is rejected.
- Prefer the existing account-bound fetch and page transport. Only extend transport behavior if a focused real failure demonstrates a gap; do not add an independent WAF bypass runtime.

## Persistent state and scheduling

Continue deriving status from `checkin_states_by_account` keyed by normalized base URL plus account ID. Preserve the existing per-local-day opt-in scheduling and daily satisfied markers. No second persisted `hasError` boolean is needed.

List feedback reflects unresolved results of enabled automatic check-in accounts. It survives selection changes and reload because the state already persists. During a new attempt, show the active state; after confirmed success/already-checked, remove the attention cue. Disabling automatic check-in removes its list attention cue, while the detail view can still show the previous result with its timestamp. Old results are described as the latest attempt rather than today's failure.

Multiple profiles bound to the same account display the same result; same-site accounts with different IDs remain distinct. A profile with no saved account binding must not inherit another account's status.

## Visible UI proposal

Introduce shared, pure check-in presentation derived from the authoritative result, following the existing balance/health presentation pattern.

| Result | List attention for enabled auto check-in | Detail area | Recovery |
| --- | --- | --- | --- |
| `failed` | Red warning icon + 签到失败 | Red-tinted result panel, concise cause and last attempt | 重新签到 |
| `login_required` | Amber warning icon + 需重新登录 | Amber result panel and account-specific instruction | Existing browser-login action |
| `manual_required` | Amber warning icon + 需人工验证 | Amber result panel | Open the existing account-bound recovery window |
| `unsupported` | Amber warning icon + 暂不支持签到 | Explain the result instead of silently muting it | Existing custom compatibility settings / disable automatic check-in |
| `running` / `verifying` | No stale failure label; optional existing active treatment | Existing active state and disabled duplicate actions | Wait / user completes verification |
| `success` / `already_checked` | Remove attention cue | Green state and confirmed reward when present | No duplicate daily check-in |

Use color plus readable text/icon, semantic accessible status announcement in the selected detail view, and available theme tokens. Do not mark the whole profile unhealthy: CLI availability and check-in outcome are separate. Avoid flashing, blocking dialogs, OS notifications, and sounds.

The list badge belongs to `ProfileItem` via `ProfileListPanel`; selecting it continues to open the current profile details. The detail treatment belongs to the existing `BalanceTestButton`. Keep any new props narrow and derive account mapping in the established renderer composition layer.

## Approved testing seams

1. Public check-in execution: the result, origin-bound transport, request method/path, and subsequent run behavior from `CheckinService.checkin`.
2. Public verification workflow: matching account, bounded recovery attempt, confirmed result, and cancellation without false success.
3. Rendered list/detail behavior: visible labels, recovery callbacks, exact account binding, persisted failure hydration, and failure-to-success transitions.

Use test-first vertical slices and independent upstream fixture examples. Existing scheduler/state regression coverage is extended only where behavior changes. No tests target private helpers solely to mirror their implementation.

## Migration and recovery

No user-data migration is planned. Preserve browser sessions, profile/account IDs, and unrelated configuration. Existing custom rules remain opt-in overrides. Invalidating a stale learned capability is scoped to that account and does not clear browser storage.

The repository has unrelated uncommitted changes, including overlapping main-process/form files. Apply scoped patches and review those hunks against the starting worktree. Git is the recovery path for code; no extra credential/data backup is needed because the plan does not alter them. No commit, push, release, or public issue publication is authorized.

## Risks and deferred evidence

Pinned upstream implementations establish a credible protocol, but cannot prove the current user's deployed site, account eligibility, or WAF behavior. Implementation must report live verification separately from fixture tests. Do not claim a real reward without an action response from the user's runtime. Endpoint or challenge changes should produce actionable failure, not speculative success or repeated retries.
