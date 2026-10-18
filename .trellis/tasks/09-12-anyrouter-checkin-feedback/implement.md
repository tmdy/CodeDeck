# Implementation plan

Status: user approved the final planning summary with `确认` on 2026-09-12. Execution is authorized.

## Before execution

- [x] Record the user's task-creation authorization and requested Matt Pocock workflow.
- [x] Inspect existing authentication, check-in, scheduler, UI, and regression seams.
- [x] Finish pinned All API Hub / MetAPI / supporting AnyRouter research.
- [x] Converge `prd.md` and validate both context manifests (6 real entries each; validation passed).
- [x] Present the complete proposed behavior, scope, risks, and testing seams to the user.
- [x] Receive a subsequent explicit approval of that summary, then run `task.py start`.
- [x] Recheck the dirty worktree before dispatch; never revert pre-existing changes.

## Slice 1: confirmed AnyRouter check-in

- [x] Implement directly in the main session, per the user's later `请你不要开子代理,直接开始` instruction; preserve others' edits. Earlier attempted agents failed before modifying code.
- [x] Start with one failing public-service test showing a browser-session AnyRouter account can successfully execute sign_in without the generic monthly status endpoint.
- [x] Implement the minimum provider action strategy and authoritative browser transport use.
- [x] Add subsequent red/green cycles for explicit already-checked results, malformed/HTML rejection, auth/challenge outcomes, and repeat execution/learned-path behavior.
- [x] Confirm ordinary New API status + nonce flow, opt-in custom-rule precedence, and account isolation remain intact.
- [x] Verify the public result reaches the existing persisted account state and successful-day marker through the current IPC execution path.

## Slice 2: manual recovery with check-in proof

- [x] Add a failing public verification test for AnyRouter without a generic status endpoint.
- [x] Reuse the existing account partition/window and add an explicit `验证完成并重试` action with matching identity and one bounded action-based confirmation; do not poll sign_in repeatedly.
- [x] Check challenge still required, cancellation/timeout, and account mismatch remain unsuccessful and retryable.
- [x] Keep automatic jobs from opening interactive windows.

## Slice 3: visible automatic check-in failure and recovery

- [x] Add a failing rendered-behavior test showing an unselected profile's enabled auto-check-in failure in the list.
- [x] Derive account-scoped presentation once and pass narrow display props to existing list/detail components.
- [x] Implement red failure and amber login/verification/unsupported cues with readable text/icon and stronger detail styling.
- [x] Wire recovery to existing check-in/login/verification actions.
- [x] Verify exact account mapping, shared-account consistency, persistence hydration, disabled-auto behavior, and replacement of failure cues after success.
- [x] Inspect light/dark appearance and compact list layout using the available renderer/browser workflow; make accessibility/text verification part of the same slice.

## Validation and review

During each slice run the smallest relevant existing Vitest files. Expected areas:

```powershell
npm test -- src/shared/__tests__/services/checkin-service.test.ts src/shared/__tests__/electron/checkin-verification-service.test.ts
npm test -- src/shared/__tests__/components/balance-test-button.test.tsx src/shared/__tests__/checkin/presentation.test.ts
```

Use the actual discovered profile-list/component/IPC test paths when their behavior is changed. Do not run stale guessed paths.

After integration:

- [x] Review the complete task scope and curated context directly in the main session, per the user's no-sub-agent instruction.
- [x] Run `npm run typecheck` for the modified shared/renderer/IPC contracts.
- [x] Run `npm test` once as the repository's final test gate; report pre-existing failures separately without expanding scope.
- [x] Build Electron and renderer successfully. On the user's later explicit request, close the old packaged processes and generate a new Windows NSIS package. Keep CodeDeck closed afterward; no real account check-in was executed.
- [x] Provide the account-bound login and explicit verification retry actions. No real login interaction was initiated, and no credentials were requested or exported.
- [x] Record what was actually verified, including any unavailable real-site/WAF evidence. Unit fixtures do not prove a live reward.
- [x] Review `git diff --check` and the explicit changed-file/hunk list; preserve unrelated dirty work.
- [x] Update the relevant Trellis contract for provider-specific proof and presentation behavior, then report results.
- [x] No commit/push/archive as a substitute for unfinished user acceptance. Follow the user's later explicit requests for Git operations.

## Scoped recovery

Product code uses the existing Git recovery path; do not create parallel backups or touch browser storage. Preserve baseline hunks in overlapping files. Invalid capability cache entries may be cleared only by the existing account-scoped mechanism. If the upstream protocol changes, retain clear failure feedback and the manual recovery path instead of broadening authentication or retry policy.

## Completion evidence (2026-09-13)

- Full suite: 107 files / 1119 tests passed; TypeScript and renderer/Electron builds passed.
- Review regressions: HTTP 403 HTML/JSON identity challenges remain recoverable; unrelated English already-checked/sign-out messages cannot establish check-in success. Each correction followed failing tests.
- Actual component rendering with synthetic accounts was inspected in light/dark Chromium screenshots; 270 px rows had no overflow. Recovery-button colors remain readable in both themes.
- See `evidence.md` for commands, package hash, scope and runtime limits. No live reward or website login-trigger mechanism is claimed.
- Added `.trellis/spec/frontend/checkin-provider-contract.md` and its index entry. No commit, push or archive; the task remains available for user acceptance.
