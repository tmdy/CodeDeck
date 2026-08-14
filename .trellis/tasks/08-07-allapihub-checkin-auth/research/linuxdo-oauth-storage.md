# Research: LinuxDo OAuth storage persistence

- Date: 2026-08-11
- User requirement: A browser-managed account must retain LinuxDo login and other browser storage so later site re-login does not require signing into LinuxDo again.

## Findings

- Electron `persist:` partitions own normal Chromium storage, including persistent Cookies, localStorage, IndexedDB, Cache Storage, and Service Worker registrations. Closing a BrowserWindow does not clear these stores.
- New API's LinuxDo provider defaults its token endpoint to `https://connect.linux.do/oauth2/token` and user endpoint to `https://connect.linux.do/api/user` in `QuantumNous/new-api/oauth/linuxdo.go`.
- New API receives the provider callback on the original site at `/api/oauth/linuxdo`.
- The safe navigation contract is therefore a fixed allowlist: the exact account origin, `https://connect.linux.do`, and `https://linux.do`, followed by a return to the account origin.
- The account's persistent partition should retain LinuxDo storage for subsequent re-login. Different CodeDeck account partitions should not share that storage because sharing would weaken account isolation and increase cross-account confusion risk.
- Explicit logout or account deletion must clear all storage in that partition, including LinuxDo-origin data.

## Implementation implications

- Do not call `clearStorageData()` or `clearCache()` when a login/verification window merely closes.
- Continue blocking unrelated cross-origin navigation, popups, downloads, webviews, permissions, Node integration, and devtools.
- Add tests for allowed LinuxDo origins, blocked unrelated origins, storage-preserving window closure, and whole-partition cleanup.

## References

- <https://github.com/QuantumNous/new-api/blob/main/oauth/linuxdo.go>
- <https://www.electronjs.org/docs/latest/api/session#sessionfrompartitionpartition-options>
- <https://www.electronjs.org/docs/latest/api/cookies>
