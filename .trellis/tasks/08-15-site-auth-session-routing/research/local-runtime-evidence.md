# Local runtime evidence

## Observed sequence

The user-provided screenshots show the LinuxDO login page, then the target New API site with a visible logged-in user. The CodeDeck form nevertheless remains on `新建会话`.

The local sanitized application log records the exact failure sequence on 2026-08-15:

- `browser-auth:login started` for `https://x666.me/v1`;
- after the interactive window is closed, `browser-auth:login failed` with `已取消浏览器登录`;
- the following `balance:test` starts with `authKind: "none"`;
- balance completes with `余额接口鉴权失败，请检查 API Key`.

No credential values are needed to establish this sequence.

## Code path

- `src/shared/electron/browser-account-session-manager.ts:575` maps any unfinished window `closed` event directly to cancellation.
- `src/shared/electron/browser-account-session-manager.ts:582` is the only path that verifies the browser account and completes the task as `ready`.
- `electron/main.ts:2091` persists the browser account only after the manager returns `ready`.
- `src/App.tsx:2003` updates the draft selection only after that IPC resolves successfully.
- `src/App.tsx:312` converts an empty `new` session draft to `auto` during generic profile saving.
- `src/App.tsx:2148` resolves unsaved changes before invoking balance testing, so a canceled login can be silently converted to API auto.

## Test gaps

- Existing manager tests assert that close wins over an in-flight identity result, but do not cover a deliberate final probe when the user closes after completing login.
- Existing renderer tests verify the browser-slot argument but do not assert that login success binds the current Profile or changes the dropdown from `new` to the saved account.
- Existing renderer tests cover PAT autosave before balance testing but not the incomplete-browser-login guard.
