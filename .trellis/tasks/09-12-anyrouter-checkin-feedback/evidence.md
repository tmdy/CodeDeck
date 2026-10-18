# Verification evidence

Date: 2026-09-13 (Asia/Shanghai).

## Result

The approved feature is implemented in source and compiled development outputs. Canonical AnyRouter uses an explicit browser-session `POST /api/user/sign_in`; automatic failures appear in bound profile rows and account details. Human recovery requires a visible explicit retry and matching identity before one action.

The main session performed implementation and review directly after the user's instruction prohibiting further sub-agents. On 2026-09-13 the user explicitly requested closing the current CodeDeck and generating a new package. The old packaged processes were closed and a local Windows package was generated. No commit, push, external publication, browser-storage mutation or archive was performed.

## Automated checks

| Check | Result |
| --- | --- |
| `npm run typecheck` | Exit 0 |
| `npm test -- --reporter=dot` | Exit 0; 107 files / 1119 tests passed; 8.89 s Vitest duration |
| Focused provider/recovery suite | 57 service tests + 21 verification tests passed before the final full suite |
| `npx vite build` | Exit 0; 88 modules transformed |
| `npm run build:electron` | Exit 0 after the final service edit |
| `git diff --check` | Exit 0 |
| `git diff --cached --name-only` | Empty |

Final review reproduced and corrected two issues using failing public-boundary tests: HTTP 403 HTML/JSON identity challenges incorrectly closed the recovery window as expired login; broad English already-completed parsing accepted unrelated balance/sign-out messages. Existing generic check-in, custom-rule, authentication, scheduler and persistence suites stayed green.

## Visual checks

Actual `ProfileListPanel`, `BalanceTestButton`, shared account mapping and the current stylesheet were rendered with synthetic accounts using React static rendering and visible Chromium through the installed Playwright skill. Temporary scripts/HTML stayed in the OS temp directory.

- [Light theme](./ui-light.png)
- [Dark theme](./ui-dark.png)

Both renders contained four semantic result panels and five profile rows. Each row had `clientWidth === scrollWidth === 270`. Failure, login, manual verification and unsupported states showed their corresponding text/icon and red/amber cues; the successful account had no failure cue. Theme transitions were disabled while taking screenshots. Recovery buttons use the status color for readable text and borders in both themes.

These are real component styles with test data, not a real-account result or a complete interactive Electron test. Component tests separately verify recovery callbacks and successful rerenders.

## Research and live-runtime boundary

Pinned All API Hub, MetAPI and supporting AnyRouter source agree on session-authenticated `POST /api/user/sign_in`. See [upstream research](./research/upstream-anyrouter.md) and its SHA-256 manifest. They do not establish that `GET /api/user/self` performs check-in.

The exact frontend mechanism behind the user's observed automatic check-in on website login remains unverified. No real account check-in response or reward was obtained.

After the user's packaging request, four processes from `D:/CodeDeck/release/win-unpacked/CodeDeck.exe` were closed and `npm run dist:win` completed successfully. The new installer is `release/CodeDeck-Setup-0.2.1.exe` (101,674,176 bytes, SHA-256 `3B2A596733994A2A9607590F84C49FE31D8C4E84430B746548176010B492E1D5`). The unpacked executable and `app.asar` were also regenerated; direct archive inspection confirmed the packaged check-in service contains `/api/user/sign_in` and `X-Requested-With`. CodeDeck remained closed after packaging. No installer launch, installation or real account action was performed.

## Changed scope

- Provider: `src/shared/checkin/anyrouter.ts`, `src/shared/services/checkin-service.ts`.
- Recovery/contract: `src/shared/electron/checkin-verification-service.ts`, `src/shared/checkin/types.ts`, and only recovery-menu wiring/result merging in `electron/main.ts`.
- Presentation: `src/shared/checkin/presentation.ts`, `src/App.tsx`, `ProfileItem.tsx`, `ProfileListPanel.tsx`, `BalanceTestButton.tsx`, `src/styles.css`.
- Five existing test files: service, verification, presentation, list panel and balance button.
- This Trellis task, provider code-spec and frontend index.

Pre-existing config, profile editing/types, terminal/launch/agent-bridge and earlier Trellis changes are outside the task. Their diffs were not staged or reverted. `electron/main.ts` contains unrelated pre-existing hunks; the whole file must not be treated as this task's ownership boundary.
