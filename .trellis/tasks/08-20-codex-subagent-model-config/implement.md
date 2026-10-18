# Implementation Plan

1. Extend the Codex profile mapping type, normalization, editor clone, and
   equality comparison with `subagentReasoningEffort`.
2. Replace the disabled Codex mapping card with editable controls matching the
   existing model configuration pattern.
3. Add a small LaunchService conversion for enabled Codex subagent values and
   include it in both managed and native Codex command construction.
4. Re-read the changed regions and inspect the scoped diff/status. Do not run
   the final test suite in this turn per user instruction.

## Scoped files

- `src/shared/profile/types.ts`
- `src/shared/profile-editor-state.ts`
- `src/components/profiles/ProfileEditForm.tsx`
- `src/shared/services/launch-service.ts`

## Validation

- Read-only `git diff --check` / scoped diff review if the concurrent worktree
  remains stable.
- `npm test` and the final test suite are intentionally not run in this turn.
