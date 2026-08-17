# Implementation Plan

1. Extend legacy identity verification to return the credential candidate that actually succeeded.
2. Add a New API-only 401/403 retry without Bearer while preserving the user ID header and bound Cookie session.
3. Update interactive login and cold-start recovery to store the verified candidate rather than the originally observed candidate.
4. Add regression tests for successful fallback, failed fallback, identity mismatch, and post-login request headers.
5. Run the manager test suite, related balance/check-in tests, and `npm run typecheck`.
6. Update the management authentication spec with the verified fallback contract and repeat-bug prevention note.
7. Add a strict same-origin page transport fallback for interactive identity verification and saved-account management requests after `Session.fetch` 401/403.
8. Add secret-safe diagnostics that distinguish candidate shape and `session_fetch` versus `page_fetch` without exposing IDs or credentials.
