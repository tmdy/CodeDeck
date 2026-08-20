# Design: immediate visibility for Profile browser navigation

## Boundaries

The candidate implementation stays inside the existing Profile browser ownership boundary:

- `electron/main.ts` remains responsible for BrowserWindow creation, partition selection, navigation restrictions, and cleanup.
- `src/App.tsx` remains responsible for the button action and user-facing error state.
- Existing browser-account partitions and authentication code remain unchanged.

No new browser abstraction, loading service, or renderer credential flow is needed.

## Data and lifecycle

```text
ProfileEditForm
  -> App.handleOpenBaseUrl
  -> preload openBaseUrl
  -> profile:open-base-url
  -> resolve target partition
  -> create/configure hidden BrowserWindow
  -> show + focus immediately
  -> bounded loadURL(origin)
  -> keep window on success / close and propagate error on failure
```

The IPC promise may still resolve only after the initial navigation settles; the user-visible window must not wait for that promise. This preserves the current partition and navigation contract while separating visibility latency from page readiness.

## Proposed changes if approved

1. Move `show()`/`focus()` before the initial `loadURL()` await in `openProfileSiteBrowser`.
2. Reuse the existing bounded-navigation behavior or add the smallest local equivalent for this path; do not silently follow new origins or weaken current URL validation.
3. Keep the existing close-on-error cleanup and `profileBrowserWindows` bookkeeping.
4. Add one focused regression assertion that the Profile browser shows before navigation completion. Do not add broad UI or network tests.

## Compatibility and risks

- The window may briefly show a blank/partially loaded page, matching the already-tested login UX. This is preferable to a hidden, unresponsive action and can be mitigated only if the existing window style requires a local loading shell.
- `loadURL` errors still reject the IPC call and close the window.
- Persistent partition selection, selected account reuse, origin validation, popup/webview blocking, and permission denial are unchanged.
- Network/server latency is not removed; it becomes visible and measurable instead of being mistaken for window creation latency.

## Rollback

Revert only the ordering/timeout change and its focused test. No persisted-data migration or runtime cleanup is required.
