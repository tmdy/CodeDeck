# Research: Profile Base URL window appears slower than browser login

## Scope

- Date: 2026-08-20
- Query: Why does the Profile editor's `打开` action appear slow while `浏览器登录` becomes visible quickly?
- Method: read-only comparison of renderer handlers, preload IPC, Electron main handlers, BrowserWindow lifecycle, tests, task history, and current application logs.

## Confirmed call-chain comparison

### Profile Base URL: hidden until navigation completes

1. `src/App.tsx:3302-3329` (`handleOpenBaseUrl`) resolves the selected browser target and awaits `window.profileManager.openBaseUrl(...)`. It does not set a busy state or display a loading placeholder.
2. `electron/preload.ts:196-197` forwards the request to `profile:open-base-url`.
3. `electron/main.ts:5018-5024` routes the IPC request to `openProfileSiteBrowser` through the common IPC logger. The IPC promise therefore remains pending for the whole browser-open operation.
4. `electron/main.ts:2971-3019` creates a `BrowserWindow` with `show: false` at lines 2978-2994, calls `await browserWindow.loadURL(targetUrl)` at line 3010, and only then calls `show()`/`focus()` at lines 3011-3014.

The first visible response is therefore gated by the target site's DNS/TCP/TLS/redirect/document-load path. A slow or stalled target is perceived as CodeDeck's window being slow, and there is no visible feedback during that wait.

### Browser login: visible before navigation completes

1. `src/App.tsx:2025-2062` sets the renderer busy state and invokes the browser-login IPC.
2. `electron/main.ts:3139-3144` calls `BrowserAccountSessionManager.openLogin`.
3. `src/shared/electron/browser-account-session-manager.ts:1088-1115` creates the window, configures it, calls `browserWindow.show()` and `focus()` at lines 1099-1100, and only then awaits the initial `loadWindowUrlWithTimeout(...)` navigation at lines 1101-1105.
4. `src/shared/__tests__/electron/browser-account-session-manager.test.ts:1047-1084` explicitly asserts that `show()` and `focus()` have already run while `loadURL()` is still unresolved.

This is why the login window feels fast even when the same site still needs network time: window visibility and page readiness are deliberately decoupled.

## Root cause

Primary root cause: the two paths use opposite visibility ordering. The `打开` path waits for full initial navigation before showing a hidden window; the login path shows first and loads second.

Secondary issue: the login path bounds initial navigation with `DEFAULT_NAVIGATION_TIMEOUT_MS` (30 seconds) via `loadWindowUrlWithTimeout`, while `openProfileSiteBrowser` has no equivalent explicit navigation timeout. A target that never settles can make the IPC request appear to hang indefinitely, although the window remains invisible.

Renderer amplification: `handleOpenBaseUrl` does not set `isBusy` or show a progress state, so the user receives no feedback while the main process is waiting.

## Factors checked but not identified as the primary cause

- Partition selection is required and can resolve saved-session, browser-slot, pending, or default partitions (`src/shared/electron/profile-browser-partition.ts:29-84`). These checks are synchronous and do not explain a network-scale delay.
- Both paths use sandboxed, isolated BrowserWindows with Node integration disabled. Login uses `cache: false` when creating its account Session (`electron/main.ts:1432-1442`), whereas the Profile browser uses the default Session cache (`electron/main.ts:2971-2976`). This difference is not consistent with the observed faster login and should not be treated as the root cause.
- Both paths install navigation restrictions and the same visible browser menu. Window size, parent-window wiring, icon lookup, and menu construction may affect a small amount of creation time but occur before the decisive `loadURL` wait and are not the dominant difference.
- The Base URL is normalized to the site origin (`src/shared/electron/open-url.ts:45-63`), so `/v1` in the form is not itself loaded. The target may still be slow because the origin redirects or renders a heavy page, but that is page-load latency exposed by the hidden-window ordering.

## Runtime evidence limitations

- The current `app-data/logs/codedeck.log` contains the generic IPC timing mechanism but no recent `profile:open-base-url` sample, so this investigation cannot assign an exact observed duration to the target site.
- The logger already records IPC duration (`src/shared/electron/debug-log.ts:247-287`); after a fix, this can distinguish window-visible latency from navigation-completion latency without logging credentials or page contents.

## Minimal recommended direction (not implemented in this planning turn)

1. Align `openProfileSiteBrowser` with the login lifecycle: create/configure the window, call `show()`/`focus()` immediately, then await navigation.
2. Preserve the existing `try/catch` close-on-load-failure behavior.
3. Add a bounded initial-navigation wait equivalent to the login path, so a stalled origin produces a controlled error rather than an unbounded hidden IPC wait.
4. Add a narrow ordering regression assertion around the existing Profile browser IPC test, then run the focused Electron/browser tests and typecheck.

## History note

Commit `2d266dc` used `shell.openExternal`, which returned control to the system browser immediately. The internal CodeDeck browser was introduced in `4e5d932`; its current `show: false` + `await loadURL()` ordering explains the regression in perceived responsiveness after that architectural change.
