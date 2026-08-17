# Repository Findings

## Existing Profile And UI Flow

- `src/shared/profile/types.ts` owns Profile, channel, selected-model normalization, and active-channel helpers.
- `src/components/profiles/ProfileEditForm.tsx` currently renders a two-column channel editor with a permanent channel-name input. Add and delete actions already exist; rename is performed through that permanent input.
- `src/App.tsx` owns draft channel/model state and passes it through `ProfileEditForm`.
- `src/components/profiles/ProfileItem.tsx` and `ProfileListPanel.tsx` already render a compact balance badge, so health must be a separate compact signal rather than replacing balance.

## Persistence Boundary

- Runtime projections belong in `LocalState` and are normalized by `src/shared/state/local-state.ts` and serialized by `src/shared/state/store.ts`.
- Health results and rolling conversation state are local runtime data. They should not be added to the encrypted/synchronized Profile payload.
- The state store already contains a legacy `connectivity_tests_by_profile` raw field but does not load it. The new implementation should use an explicit typed health field and preserve backward compatibility with old files that lack it.

## Network And Provider Boundary

- Electron main already owns monitored Codex/Claude terminal launches and Provider-session lifecycle discovery; active health should reuse that path instead of the Chromium-backed `fetch` transport.
- Claude launch configuration uses `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`.
- Codex launch configuration uses the normalized Profile Base URL, a generated Bearer-token environment variable, and the configured `wire_api` (normally `responses`).
- Model catalog fetching is GET-only and cannot prove model generation or context continuity.

## Passive Health Boundary

- `terminal-turn-lifecycle.ts` recognizes authoritative Claude/Codex completion records from session JSONL.
- `TerminalSessionManager` emits an activity change with reason `turn_completed`.
- The monitored terminal session currently stores provider/cwd but not Profile identity. Electron main can bind the returned terminal session ID to a health target immediately after `launcher:launch` succeeds.
- Direct external terminals have no reliable lifecycle event and must remain outside passive health updates.

## Product Decisions

- Automatic active probing is off and out of scope for the first release.
- Manual detection targets the current channel and uses the current model configuration.
- The permanent channel-name field is replaced by a transient add/rename editor; the freed right-side area hosts channel health controls.
- Manual probes require a saved Profile whose current editor values, active channel, model, and credential still match; completion rechecks the match before persisting.
