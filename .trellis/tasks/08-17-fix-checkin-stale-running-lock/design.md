# Design

## Boundaries

- Electron main process owns the global check-in execution queue because manual IPC and the scheduler converge there.
- `runCheckinBatch` becomes an ordered loop and no longer creates cross-site workers.
- Check-in state normalization owns cold-start recovery of interrupted persisted states.
- Renderer keeps its current global busy guard while a real task is active; the fix removes stale ownership rather than weakening the guard.

## Execution Contract

All calls that execute an account check-in enter one shared promise chain. Each queued operation starts only after the previous operation settles. Rejection must not poison the tail: the queue tail is advanced through a settled continuation, while each caller still receives its own result or error.

Batch execution feeds accounts into the same queue in input order. Scheduled and manual entry points therefore cannot overlap with each other or with a batch.

## Recovery Contract

During `normalizeCheckinStatesByAccount`:

- persisted `verifying` becomes `manual_required` as today;
- persisted `running` becomes `failed` with an interruption message;
- all terminal and scheduled states remain unchanged.

This conversion occurs only while loading/cloning persisted state, so a live in-memory `running` state remains a valid busy signal.

## Compatibility and Risk

- Serialization reduces request concurrency and may make large batches slower; this is the explicit user choice.
- A queue must not deadlock when an account requests manual verification. The account execution operation resolves to `manual_required`; the later interactive verification flow remains separately controlled and does not hold the network execution queue open.
- State writes and balance refresh behavior remain unchanged.

## Rollback

Revert the queue wrapper, restore the previous batch worker implementation, and remove only the `running` recovery branch. No data migration is required.
