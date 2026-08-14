# Implementation Plan

## 1. Immediate Saved-Argument Persistence

- [ ] Add an explicit saved-argument toggle callback between `ProfileEditForm` and `App`.
- [ ] Persist only chip-driven `extra_args` changes through `updateProfileRuntimeSettings`; keep free-form typing save-gated.
- [ ] Update editor baseline and optimistic state consistently, with failure reconciliation.
- [ ] Extend component/state tests for reload, Profile switching, handwritten text preservation, and failure behavior.

## 2. Protocol And Launch Overrides

- [ ] Extend agent bridge request/response types and runtime parser with model, reasoning, parent, return-policy, and delivery metadata.
- [ ] Add CLI flags and concise usage output for per-run overrides and asynchronous parent-bound launch.
- [ ] Apply model/reasoning overlays to cloned launch inputs and reuse existing provider normalization/builders.
- [ ] Add protocol, CLI, and launch-service tests for both providers and invalid values.

## 3. Scoped Parent-Bound Delivery

- [ ] Expose verified monitored terminal identity to processes launched by CodeDeck.
- [ ] Add server-owned parent/child binding and scoped callback credentials without exposing the global bridge token.
- [ ] Track delivery status in `AgentTaskManager` and deliver completed child answers idempotently.
- [ ] Implement serialized `once` / `continuous` / `manual` policy changes from A and from B's scoped command.
- [ ] Add bound-peer ESC interrupt commands that do not cancel tasks or close terminals.
- [ ] Queue while the parent is busy; flush on parent idle/turn completion; fail explicitly when the parent exits.
- [ ] Retain the recursion guard for all operations outside the scoped callback path.
- [ ] Add unit tests for binding validation, policy transitions, scoped interrupt, unrelated-target rejection, busy queueing, duplicate events, parent exit, and child longevity.

## 4. Settings UI And Documentation

- [ ] Update the local AI delegation settings copy/help so model, reasoning, visibility, asynchronous lifetime, and callback behavior are discoverable without adding a workflow editor.
- [ ] Keep controls compact and consistent with the existing settings panel.
- [ ] Update CLI/README documentation if the bridge command is documented there.

## 5. Verification

- [ ] Run focused Vitest suites for agent bridge, launch service, Profile editor state, and Profile form/App interactions.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build:electron`.
- [ ] Manually verify A -> B -> automatic B answer injection -> new A turn in hidden and visible modes.
- [ ] Verify closing B's visible window is the only parent-independent UI action that intentionally stops B.

## Risky Files And Rollback Points

- `electron/main.ts`: parent identity injection and launch overlays; keep changes isolated to monitored launch/bridge wiring.
- `src/shared/agent-bridge/task-manager.ts`: lifecycle and delivery state machine; require focused tests before UI work is considered complete.
- `src/App.tsx`: dirty-draft/baseline races; do not broaden immediate persistence to manual argument typing.
- Protocol changes are additive; revert them independently if delivery reliability fails without reverting saved-argument persistence.
