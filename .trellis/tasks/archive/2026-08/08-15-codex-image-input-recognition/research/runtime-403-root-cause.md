# Runtime evidence: logged-in page and login probe used different partitions

## Observed sequence

The user confirmed that the target site page was logged in but CodeDeck did not recognize the browser account.

The sanitized local log on 2026-08-16 records:

1. `profile:open-base-url` for `https://muyuan.do/v1` with `balanceSessionId = null`.
2. Eleven seconds later, `browser-auth:login` for the same Base URL and requested global slot 1.
3. The browser-auth task enters `authMode: browser_cookie`, repeatedly receives identity HTTP 403, and closes as `window_close_unverified`.

No credential value is required to establish this sequence.

## Repository evidence

- `App.tsx:3239-3245` passes a session ID to `openBaseUrl()` only for an already saved browser account. A `new` browser-session draft therefore passes `undefined` just like API auto/PAT.
- `electron/main.ts:2007-2015` resolves a missing saved account to `DEFAULT_PROFILE_BROWSER_PARTITION`.
- `electron/main.ts:2090-2138` uses an existing slot reference or a newly allocated pending reference for `loginBrowserAccount()`.
- `PendingBrowserAccountReferenceRegistry.run()` reuses a tentative reference only after the login operation has begun; the earlier generic Profile browser never acquires it.

## Root cause

The “打开 Base URL” action loses the renderer's new-browser-account intent. It opens the site in a generic partition, while the later login action verifies a different account-specific partition. The prior legacy New API implementation is active (`browser_cookie` proves that) but observes no login state because it is looking at the correct account partition rather than the generic window where the user logged in.

## Decision

Align partition routing instead of expanding authentication heuristics. A new-browser draft must prepare/reuse its pending account reference before opening the site; an existing slot must use that slot's reference. Authentication remains backend-verified and no storage is copied.

## Related work

- `.trellis/tasks/08-15-site-auth-session-routing/` owns the broader browser account persistence, legacy New API support, and Profile binding flow.
- `.trellis/spec/frontend/management-auth-contract.md` requires selected browser-session partition reuse, global slot isolation, bounded pending references, and secret non-disclosure.
