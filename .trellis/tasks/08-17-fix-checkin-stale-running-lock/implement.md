# Implementation Plan

1. Add focused state-normalization tests for interrupted `running` and existing `verifying` recovery.
2. Add a main-process check-in serialization helper or queue at the narrowest shared execution boundary.
3. Route manual, batch, and scheduled account execution through that queue.
4. Replace the three-worker grouped batch implementation with ordered sequential iteration.
5. Add focused tests proving cross-site maximum concurrency is one, input ordering is stable, errors do not poison the queue, and subsequent work continues.
6. Run focused Vitest suites, `npm run typecheck`, then the relevant full test command if feasible.
7. Review state transitions and the management-auth contract; update the spec with the global serialization and interrupted-running recovery invariant.

## Risky Files

- `electron/main.ts`: shared runtime coordination and scheduler/manual IPC convergence.
- `src/shared/checkin/types.ts`: persisted state recovery semantics.

## Validation

- `npm test -- --run src/shared/__tests__/checkin/types.test.ts`
- focused main-process check-in tests selected during implementation
- `npm run typecheck`
- `npm test`
