# Implementation plan

## Ordered checklist

1. Add typed custom-rule models, normalization, redacted cloning, and backward-compatible `SiteBalanceSession`/draft persistence.
2. Add pure JSON-path, HTML/CSS extraction, numeric mapping, success classification, and exact-origin authorization helpers.
3. Add focused service executor tests and implement custom API balance/check-in execution with manual redirect handling.
4. Add main-process routing: custom rules first only when explicitly enabled; otherwise retain current balance/check-in paths byte-for-byte where possible.
5. Add target-aware browser request/page execution without weakening standard account-origin fetch restrictions.
6. Extend manual verification to custom page URLs/selectors and preserve CAPTCHA/Turnstile `manual_required` behavior, scheduler no-window behavior, and persistent partitions.
7. Add selector-assistant BrowserWindow and narrow typed IPC; return selector plus sanitized preview only.
8. Add the collapsed advanced UI, explicit cross-origin credential confirmation, rule validation/test actions, and saved-account hydration.
9. Add/update tests for old configs, custom persistence, parser edge cases, API/page check-in, CAPTCHA handoff, origin isolation, IPC redaction, and fallback behavior.
10. Run the quality gate and review the diff for unrelated worktree changes.

## Validation commands

- `npm test -- --run src/shared/__tests__/balance/site-balance-sessions.test.ts src/shared/__tests__/services/balance-service.test.ts src/shared/__tests__/services/checkin-service.test.ts`
- `npm test -- --run src/shared/__tests__/electron/checkin-verification-service.test.ts src/shared/__tests__/electron/profile-balance-session-ipc.test.ts`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `git diff --check`

If the full suite is blocked by an unrelated environment issue, report the exact failing test/error and retain the focused evidence.

## Risky files / rollback points

- `src/shared/balance/site-balance-sessions.ts`: persisted schema and normalization; rollback by disabling optional field while preserving unknown-field tolerance.
- `src/shared/services/balance-service.ts`, `checkin-service.ts`: routing branches; rollback by removing only the explicit custom-rule branch.
- `src/shared/electron/browser-account-session-manager.ts`, `checkin-verification-service.ts`, `electron/main.ts`: origin/security and window lifecycle; rollback must not weaken existing allowlists.
- `src/components/profiles/SiteBalanceSessionPanel.tsx`, `src/App.tsx`, `electron/preload.ts`: UI/IPC compatibility; keep old controls functional when custom rules are absent.

## Pre-start gate

- [ ] PRD has no unresolved blocking product decisions.
- [ ] `design.md` and this `implement.md` reflect the explicit cross-origin confirmation decision.
- [ ] Real `implement.jsonl` and `check.jsonl` entries are curated for the sub-agent workflow.
- [ ] User has explicitly approved the final planning summary before `task.py start`.
