# New API authentication isolation

## Goal

Separate API key, access token, and session-cookie authentication for balance and check-in without silent fallback.

## Requirements

1. Add an explicit backend-account authentication kind: `access_token` or `session_cookie`; legacy accounts remain readable.
2. Keep Profile API keys separate from backend-account credentials.
3. Access-token accounts use Bearer authorization; session-cookie accounts use Cookie authentication.
4. Balance and check-in share the same account authentication resolver.
5. Authentication failures never fall back to a different kind or the Profile API key.
6. Account/authentication changes invalidate stale results and learned authentication paths.
7. Errors and diagnostics describe the actual kind while redacting credentials.
8. The account editor lets users choose the authentication kind.

## Acceptance Criteria

- [ ] Legacy accounts load as `access_token` without migration errors.
- [ ] Saving an account persists its explicit authentication kind.
- [ ] Access-token requests use Bearer and never Cookie candidates.
- [ ] Session-cookie requests use Cookie and never Bearer candidates.
- [ ] Balance and check-in honor the selected authentication kind without fallback.
- [ ] Switching authentication kind cannot reuse a conflicting learned path.
- [ ] 401 errors identify access-token versus session-cookie failure accurately.
- [ ] UI and service tests cover migration, isolation, invalidation, and redaction.
- [ ] Full tests, typecheck, build, and diff checks pass.

## Out of Scope

- Browser/Chrome cookie capture.
- Bypassing Cloudflare, Turnstile, or CAPTCHA.
- Converting a cookie into an access token.
- Guessing a kind by trying every transport and persisting the result.

## Open Questions

None. The user approved the first implementation stage on August 7, 2026.
