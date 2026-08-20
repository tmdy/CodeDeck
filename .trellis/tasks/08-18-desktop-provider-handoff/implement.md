# Implementation Plan

## 1. UI and request intent

- [x] Replace the standalone Desktop button with an independent Codex-only Desktop handoff checkbox near the monitor toggle.
- [x] Keep monitor mode state and persistence independent.
- [x] Thread `desktop_handoff` through existing launch callbacks/request types without changing normal launch modes.

## 2. Monitored handoff lifecycle

- [x] Start the selected Profile through the existing monitored launch path.
- [x] Force `disable_codex_hooks=true` only for the temporary handoff request.
- [x] Inject `/app` through the bound terminal session after startup readiness.
- [x] Add bounded handoff evidence and timeout handling.
- [x] Close the temporary writer only after confirmed handoff.

## 3. Desktop/provider verification

- [x] For direct launch, create and persist an empty app-server thread under the selected provider, then open its exact Desktop URI.
- [x] For resume selected, retain the existing `/app` acknowledgement flow.
- [x] Verify the target session retains the original `site_provider_<hash>` metadata.
- [x] Verify broker request uses exactly that provider ID and no token is logged.

## 4. Hook and failure handling

- [x] Add tests for hooks disabled on the temporary request.
- [x] Add tests for hook review blocking and timeout; never auto-confirm trust-all.
- [x] Add tests for active writer cleanup and failed cleanup.

## 5. Validation

- [x] Run focused UI/launch/agent-bridge tests.
- [x] Run `npm run typecheck` and `npm run build:electron`.
- [x] Build a release EXE.
- [ ] Perform one real third-party Profile Desktop smoke. Protocol smoke passed for blank-thread creation/persistence: empty preview, exact `site_provider_46af...`, persisted rollout, and released writer lock. Desktop UI/composer verification remains pending because the user stopped UI automation.

## Rollback Points

- Revert only the new desktop handoff intent and lifecycle code; preserve existing provider registry/broker changes.
- Do not alter session JSONL, global provider tokens, lock files, or user hooks files during rollback.
