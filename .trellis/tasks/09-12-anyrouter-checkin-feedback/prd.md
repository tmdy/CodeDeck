# 支持 AnyRouter 自动签到与失败状态提示

## Goal

Allow the user to earn AnyRouter's available daily check-in reward through CodeDeck's saved browser account and see an unsuccessful automatic check-in without opening every account's details.

## Background and Confirmed Facts

- The user requested research of All API Hub and MetAPI before implementation and specifically requested the Matt Pocock workflow. Task creation was authorized on 2026-09-12; the final plan was subsequently approved. Implementation and repository checks completed on 2026-09-13.
- All API Hub's pinned AnyRouter provider uses a session-authenticated check-in action, and its account refresh explicitly has no verified read-only daily check-in status endpoint. MetAPI's inherited Cookie branch uses the same action. A successful login or balance response is not sufficient proof of check-in. Source revisions and comparisons belong to `research/upstream-anyrouter.md`.
- CodeDeck browser accounts currently skip the legacy sign_in fallback (`src/shared/services/checkin-service.ts:656-690`), despite receiving a verified request context (`electron/main.ts:3613-3659`). Learned paths and generic manual verification also depend on the monthly check-in status endpoint (`src/shared/services/checkin-service.ts:511-550`; `src/shared/electron/checkin-verification-service.ts:524-570`).
- Result state already persists by account with automatic/manual trigger and attempt/day timestamps (`src/shared/checkin/types.ts:58-70`; `electron/main.ts:3761-3784`). Scheduling is opt-in and bounded to one automatic attempt per local day (`electron/main.ts:3452-3463`).
- Existing detail controls have a badge but collapse login-required into generic failure; the failure explanation uses muted styling (`src/components/balance/BalanceTestButton.tsx:121-141,168-177`; `src/styles.css:2097-2109`). The profile list receives no check-in state (`src/components/profiles/ProfileListPanel.tsx:27-42`).

## Requirements

- **R1 — Evidence-backed AnyRouter support:** support the canonical `https://anyrouter.top` management site using the evidenced session-authenticated daily check-in behavior. Distinguish completed, already completed, and unsuccessful attempts. Do not invent reward amounts or infer completion from authentication alone.
- **R2 — Reliable repeated use and recovery:** work through the existing saved account on later runs and after restart. Show a useful login/verification/retry action when needed, with account matching and bounded attempts. Manual challenge recovery includes an explicit `验证完成并重试` action. Automatic work must not unexpectedly open a browser window.
- **R3 — Discoverable failure feedback:** show unresolved failures of enabled automatic check-in accounts on their bound profile list entries, even when another profile is selected. Add a clearer result panel in account details. Use red for failed check-in and amber for login, verification, or unsupported-action attention; always include text/icon, not color alone.
- **R4 — Truthful state transitions:** show the latest attempt and its cause, preserve visibility through selection/reload, and clear the attention cue on confirmed success/already-checked. A new run shows its current progress, and turning off auto-check-in removes its automatic list reminder while retaining the latest detail result. Shared-account profiles agree; different accounts do not share state.
- **R5 — Existing behavior and data:** reuse the current scheduler, per-account browser context, persisted results, and explicit custom-rule overrides. Preserve ordinary New API flows and all unrelated user work and configuration.

## Acceptance Criteria

- [x] **AC1 / R1:** source research records pinned revisions, exact URLs, successful/failed response criteria, the MetAPI comparison, and the boundary between source inspection and live verification.
- [x] **AC2 / R1-R2:** a supported AnyRouter browser account can confirm success or already-checked through the actual check-in action even when the generic monthly status endpoint is absent; repeat execution and restart do not reintroduce that dependency.
- [x] **AC3 / R1-R2:** a login/self/balance response, HTML challenge page, canceled window, or unmatched account cannot mark today's check-in complete. Auth, challenge, network, rate-limit, and service errors retain actionable meanings without a repeated POST loop.
- [x] **AC4 / R3:** an unselected profile bound to an enabled failing auto-check-in account visibly shows the appropriate red/amber text/icon cue; detail view explains the cause and provides the existing recovery action.
- [x] **AC5 / R4:** selection change and state hydration preserve the failure cue; rerendering confirmed success/already-checked removes it. A profile without that account binding does not inherit its failure. Disabled auto-check-in does not leave a misleading automatic list reminder.
- [x] **AC6 / R5:** focused tests at public execution, verification, and rendered UI boundaries pass; existing authentication isolation, daily scheduling, generic nonce handling, and custom-rule behavior remain valid.
- [x] **AC7 / R1-R5:** the final report distinguishes automated tests, visual inspection, and any real account check-in. If a real session/challenge prevents live confirmation, that limit is recorded explicitly.

## Out of Scope

- New scheduling policy, recurring retry service, OS notifications/sounds, or flashing/blocking alerts.
- Saving usernames/passwords, exporting cookies, rotating credentials, or introducing another browser/WAF runtime.
- Account health/CLI availability redesign, changes to unrelated providers, or speculative support for unverified AnyRouter aliases.
- Git commit/push, release/publication, global skill installation, and cleanup of existing dirty work.

## Decisions and Review Status

- Proposed UI scope is profile list plus existing account details; check-in status remains separate from profile health.
- Proposed testing seams are public check-in execution, public manual-verification workflow, and observable rendered list/detail behavior, using small test-first vertical slices.
- Detailed contracts, trade-offs, and runtime evidence limits are in `design.md`; sequence and checks are in `implement.md`.
- The user approved this complete proposal with `确认` on 2026-09-12, including scope, UI behavior, and testing seams. Implementation is authorized.

## Acceptance evidence

The checked criteria refer to source research, public-boundary regression tests, code review and component rendering. `evidence.md` records their limits: real-account reward and the website's login-trigger mechanism remain unverified; the running old packaged app has not been replaced. No Git operations or archive were performed.
