# Bug Analysis: Legacy New API Login Was Visible but Unusable

## 1. Root Cause Category

- **Category**: B/E - Cross-layer contract and implicit assumption.
- **Specific cause**: CodeDeck treated every legacy New API deployment as Cookie plus `localStorage.uid`, while the affected deployment stores the authenticated user as `localStorage.user = { id, token, ... }` and requires `Authorization: Bearer <token>` for `/api/user/self`.

## 2. Why Earlier Fixes Failed

1. The window-close fix addressed a real race, but it did not explain the repeated legacy `/api/user/self` 401 responses while the page visibly showed an authenticated account.
2. The first legacy implementation assumed `localStorage.uid` was the only permitted same-origin identity field and therefore never inspected the site's actual production client contract.
3. Unit tests modeled only UID plus Cookie legacy sites, so they passed without exercising the affected token-backed legacy deployment.
4. After legacy login was fixed, the balance and check-in layers still treated the verified browser context like a generic manual credential and expanded one user ID into multiple vendor-specific headers. The login probe succeeded with the exact site contract, while the modified management requests were rejected.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
| --- | --- | --- | --- |
| P0 | Contract | Support exact-origin `localStorage.user.id/token` with UID/Cookie fallback | Done |
| P0 | Verification | Trust a candidate only after matching `/api/user/self` identity | Done |
| P0 | Secret isolation | Keep legacy Bearer only in Electron main-process runtime state | Done |
| P1 | Cold-start coverage | Recover the candidate from the persistent partition through a hidden same-origin window | Done |
| P1 | Tests | Cover token-backed legacy login, malformed user fallback, origin refusal, and restart recovery | Done |
| P1 | Specification | Record both modern and legacy browser-auth contracts in the management auth spec | Done |
| P0 | Cross-layer transport | Treat verified browser context headers as authoritative and do not append generic aliases | Done |

## 4. Systematic Expansion

- Browser-visible login state is not evidence that Electron `Session.fetch` has all headers used by the page's JavaScript client.
- Legacy protocol detection and legacy credential transport are separate concerns; a refresh endpoint can classify the site correctly while identity verification still fails.
- Persistent Chromium storage does not imply runtime header recovery after restart. Any storage-backed token must be reloaded inside the owning partition and revalidated.
- Compatibility expansion belongs at manual credential discovery boundaries. It must not mutate an already verified browser-origin request contract.

## 5. Knowledge Capture

- Update `.trellis/spec/frontend/management-auth-contract.md` with the minimal same-origin storage schema, runtime-only secret lifetime, hidden recovery flow, and required tests.
