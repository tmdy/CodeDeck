# Session Restore Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce perceived and actual latency when loading and restoring recent sessions from the Profiles page.

**Architecture:** Keep the renderer responsive by scheduling Profiles session loading immediately after paint and preventing low-priority global history warmup from competing with it. Make session listing summary-first: use Codex index entries without building fallback maps when possible, read Claude project files only as far as needed for summaries, and defer expensive details to explicit selection. Carry known Codex source file metadata through launch so global session restore can copy directly instead of scanning.

**Tech Stack:** Electron main/preload IPC, React renderer, TypeScript services, Vitest.

---

### Task 1: Renderer Scheduling

**Files:**
- Modify: `src/App.tsx`
- Test: `src/shared/__tests__/components/app-startup-flow.test.tsx` or a focused renderer test if an existing harness can exercise Profiles effects.

- [ ] Add a failing test or source-level assertion proving Profiles auto-load uses `requestAnimationFrame` instead of `requestIdleCallback`/`800ms`.
- [ ] Implement the scheduling change in the Profiles session auto-load effect.
- [ ] Add a guard so global history warmup does not start while the Profiles restore list is loading or uninitialized on the Profiles tab.
- [ ] Run the targeted renderer tests.

### Task 2: Codex Index Fast Path

**Files:**
- Modify: `src/shared/services/session-service.ts`
- Test: `src/shared/__tests__/services/session-service.test.ts`

- [ ] Add a failing test where a complete Codex `session_index.jsonl` page coexists with invalid session files and listing still succeeds without reading fallback files.
- [ ] Add a helper that turns complete index entries into lightweight `SessionSummary` values.
- [ ] Change `listCodexSessionsFromIndexPage()` to return the requested page from complete index entries when enough matching entries exist, and only build the fallback map for incomplete/insufficient index data.
- [ ] Run `npm test -- --run src/shared/__tests__/services/session-service.test.ts`.

### Task 3: Summary Detail Split And Claude Fast Summary

**Files:**
- Modify: `src/shared/services/session-service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/env.d.ts`
- Modify: `src/App.tsx`
- Modify: `src/components/launcher/SessionPicker.tsx`
- Test: `src/shared/__tests__/services/session-service.test.ts`

- [ ] Extend `ListSessionsRequest` with `detail?: "summary" | "full"` and default current callers to full behavior unless they explicitly request summary.
- [ ] Add a failing test proving Claude project summary reads only the first records needed for preview/prompts and tolerates invalid trailing JSONL in summary mode.
- [ ] Implement bounded JSONL reading for summary mode and keep full parsing for full detail.
- [ ] Add `session:get-detail` IPC that returns full detail for one selected session.
- [ ] Make Profiles restore list request `detail: "summary"` and load full detail on selection, merging it into the selected session.

### Task 4: Cache TTL

**Files:**
- Modify: `electron/main.ts`
- Test: `src/shared/__tests__/electron/session-list-cache.test.ts` if TTL behavior needs direct validation.

- [ ] Change `createSessionListCache({ ttlMs: 5_000 })` to `60_000`.
- [ ] Confirm manual refresh still invalidates caches through existing `session:refresh`.

### Task 5: Codex Global Restore Source Path

**Files:**
- Modify: `src/shared/services/session-service.ts`
- Modify: `src/shared/launcher/types.ts`
- Modify: `src/shared/state/local-state.ts`
- Modify: `src/App.tsx`
- Modify: `electron/main.ts`
- Test: `src/shared/__tests__/services/session-service.test.ts`

- [ ] Add optional `source_file_relative_path` metadata to `SessionSummary` and `LaunchSessionSource`.
- [ ] Populate relative path when listing Codex sessions from fallback files or day-root index lookup.
- [ ] Pass this metadata from `sessionSourceFromSummary()` into launch.
- [ ] Change `importCodexSessionToRuntimeHome()` to copy the known relative path first, then try index day-root lookup, then fallback scan.
- [ ] Add tests proving import with a known relative path succeeds even when unrelated bad session files exist elsewhere.

### Task 6: Verification

**Files:**
- Modify only as required by test failures.

- [ ] Run `npm test -- --run src/shared/__tests__/services/session-service.test.ts`.
- [ ] Run focused renderer/electron tests touched by the implementation.
- [ ] Run `npm run typecheck`.
- [ ] Inspect `git diff` and verify each of the seven recommendations is represented by code or an explicit scoped decision.
