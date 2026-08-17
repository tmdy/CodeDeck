# Design: legacy New API identity fallback

## Root cause

The failure has two layers. `LegacyIdentityCandidate` conflated storage-token presence with endpoint acceptance, and Electron `Session.fetch` was treated as equivalent to a request issued by the loaded page. The live deployment still returned 403 after Bearer removal while its account page loaded authenticated management data, so the main-process network transport itself is not authoritative for this deployment.

## Verification strategy

Keep the existing strict same-origin candidate extraction and positive user-ID checks. Centralize New API identity verification in one helper that:

1. sends the current candidate headers;
2. on 401/403 and only when the candidate is `new_api` with a Bearer, retries once with the same user ID and no Bearer;
3. if the New API session transport remains 401/403, retries from the strict same-origin BrowserWindow page context;
4. reports the verified candidate and transport together with the identity result;
5. requires the response user ID to match both the storage candidate and any persisted expected ID.

Interactive login uses its visible BrowserWindow for the page retry. Cold-start and later balance/check-in requests lazily reuse a hidden, sandboxed BrowserWindow with the same persistent partition and exact account origin. Runtime requests try `Session.fetch` first and use the page transport only after 401/403, preserving the existing fast path for compatible deployments.

Sub2API remains outside this fallback because its tokens and refresh lifecycle are explicit protocol requirements.

## Security

- Retry remains bound to the exact account origin and persistent browser partition.
- Cookie transport stays inside the account partition. Page fallback executes only at the exact account origin with `credentials: "include"`, `cache: "no-store"`, and `redirect: "manual"`.
- Success still requires a backend identity response with a matching positive user ID.
- No secret values enter logs, renderer IPC, persistence, tests, or task artifacts.
- Hidden page transports are closed on logout, deletion, discard, or application shutdown.
