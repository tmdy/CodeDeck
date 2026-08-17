# Bug Analysis: logged-in legacy site remains unrecognized

## 1. Root Cause Category

- **Category**: B - Cross-Layer Contract, with E - Implicit Assumption.
- **Specific Cause**: CodeDeck made two unsupported assumptions: a storage token defined the management transport, and Electron `Session.fetch` was equivalent to the loaded page's request context. Removing Bearer fixed the first assumption but the live site still rejected the main-process transport with 403.

## 2. Why Earlier Fixes Failed

1. The earlier fix correctly aligned Profile browsing and login-probe partitions, but stopped once it removed the first proven mismatch.
2. Its scope explicitly deferred protocol expansion until the same-partition runtime was retested; the follow-up runtime evidence was not yet available.
3. Existing tests modeled only `Session.fetch` responses and never represented a site where page fetch succeeds while main-process fetch is forbidden.
4. The first follow-up build was declared based on unit logic before a live `ready` log and working balance/check-in result existed.

## 3. Prevention Mechanisms

| Priority | Mechanism | Specific Action | Status |
|----------|-----------|-----------------|--------|
| P0 | Architecture | Centralize interactive and cold-start legacy identity verification, returning the candidate that actually succeeded | DONE |
| P0 | Test Coverage | Cover Bearer rejection followed by Cookie + user-ID success and mismatch rejection | DONE |
| P0 | Transport | Fall back to strict same-origin page requests when New API `Session.fetch` remains 401/403 | DONE |
| P0 | End-to-end | Require live `page_fetch` ready plus working balance/check-in before declaring completion | PENDING LIVE VERIFICATION |
| P1 | Documentation | Record that storage credential presence does not define endpoint transport | DONE |
| P1 | Runtime | Keep diagnostics secret-free while reporting auth mode, HTTP status, and terminal result | DONE |

## 4. Systematic Expansion

- **Similar Issues**: Other New API forks may expose legacy tokens for selected operations while management APIs rely on Cookie and user-ID headers.
- **Design Improvement**: Runtime authentication must represent both verified credentials and the transport actually accepted by the backend.
- **Process Improvement**: After fixing session routing, retest the real backend response before declaring the whole login flow adapted.

## 5. Knowledge Capture

- [x] Updated `.trellis/spec/frontend/management-auth-contract.md`.
- [x] Updated `.trellis/spec/guides/cross-layer-thinking-guide.md`.
- [x] Added regression tests for interactive and cold-start flows.
