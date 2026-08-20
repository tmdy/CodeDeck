# Implementation plan: Profile browser first-paint responsiveness

## Preconditions

- Obtain explicit approval of the final planning summary in a subsequent user message.
- Read `.trellis/spec/frontend/index.md` and `.trellis/spec/frontend/management-auth-contract.md` before editing Electron/browser code.
- Re-check `git status` and preserve the existing unrelated worktree changes.

## Ordered checklist

1. Patch only `electron/main.ts` so the Profile BrowserWindow is shown/focused before its initial navigation await, retaining current target/partition validation and error cleanup.
2. Add the smallest bounded-navigation handling needed for the Profile open path, reusing existing conventions where possible.
3. Extend the existing focused IPC/source test (or add the narrowest equivalent) to prevent a regression to hidden-until-load ordering.
4. Inspect the diff and verify that no unrelated files or credentials were touched.

## Validation

- `npm test -- --run src/shared/__tests__/electron/profile-balance-session-ipc.test.ts src/shared/__tests__/electron/browser-account-session-manager.test.ts`
- `npm run typecheck`
- If the app can be run safely, manually click `打开` once and compare first window visibility with the navigation-completion time in `app-data/logs/codedeck.log`; do not report page publication or login success from window visibility alone.

## Risk and rollback points

- Risk: showing before navigation may expose a blank page briefly; verify it is bounded and closes on navigation failure.
- Risk: a new timeout must not interrupt normal slow but valid pages prematurely; use the existing login timeout convention and report the chosen bound.
- Rollback: revert only the `openProfileSiteBrowser` ordering/timeout hunk and its focused test. Do not reset or checkout the worktree.

## Stop condition

Stop after the user-visible first-paint behavior, focused tests, and typecheck meet the acceptance criteria. Do not broaden into site performance optimization or browser architecture refactoring.
