# Instant Arguments And Persistent Agent Discussions

## Goal

Make reusable CLI argument selection behave like the working-directory field by persisting immediately, and extend the local AI delegation bridge so a monitored session can launch a second agent with per-run model/reasoning overrides and receive that agent's final answer as the next terminal turn.

The intended discussion flow is asynchronous: monitored session A starts delegated session B and ends its current reply; when B finishes, CodeDeck injects B's final answer into A and submits it, causing A to start a new turn.

## Background And Confirmed Facts

- Saved CLI argument libraries already persist globally per provider under `parameter_settings.cli_settings.<provider>.saved_extra_args`.
- Clicking a saved argument currently only changes the Profile draft's `extra_args`, so the selection is lost unless the Profile is saved.
- Working-directory-only, selected-model-only, and reasoning-effort-only Profile changes already have immediate persistence paths in `src/App.tsx`.
- The local delegation protocol already supports listing Profiles, starting a monitored task, waiting, inspecting status, continuing it, and cancelling it.
- Delegated sessions are currently marked with `CODEDECK_DELEGATED=1`, and `electron/agent-cli.ts` rejects every bridge call from such a process.
- Agent task records currently live in the Electron main process. A client request ending does not stop its delegated terminal, but disabling the bridge or quitting CodeDeck does.
- The terminal manager can inject and submit input to a running monitored terminal and exposes activity transitions for detecting turn completion.
- Profile model and reasoning-effort settings already have provider-specific normalization and launch-command support.

## Requirements

### Immediate Saved-Argument Selection

1. Adding, editing, enabling/disabling, and deleting a saved argument remains an immediate global provider-level settings update.
2. Clicking a saved argument must immediately persist the resulting `extra_args` for the selected existing Profile, without requiring the Profile Save button.
3. Hand-written argument text must be preserved when a saved argument is selected or deselected.
4. Argument selection must continue to affect command preview and actual launch through the same runtime value.
5. A persistence failure must surface an error and reconcile the optimistic UI with stored state.

### Delegated Agent Launch Overrides

6. A bridge `run` request may optionally override the launched model and reasoning effort for that run only; omitted values inherit the selected Profile.
7. Model and reasoning options must be discoverable from the bridge/CLI interface, and invalid provider-specific reasoning levels must be rejected before launch.
8. Per-run overrides must not mutate the underlying Profile.

### Parent-Bound Automatic Return

9. A monitored session A may asynchronously launch B and end its current reply without waiting for B.
10. CodeDeck must bind B to the exact monitored terminal A that created it. B cannot target arbitrary terminal sessions or create an unrestricted delegation chain.
11. When B completes a turn, CodeDeck must inject a clearly delimited form of B's final assistant answer into A and submit it as A's next input.
12. If A is not idle when B completes, CodeDeck must queue the return and inject it only after A becomes idle; returns for an exited or closed A must fail safely and remain inspectable from B's task status.
13. The delegated B terminal must remain alive independently of A ending the initiating turn or the original bridge client disconnecting.
14. Choosing to show B opens its monitored terminal window. Closing that window remains an explicit terminal-close action; merely ending A's turn or the launching command must not close B.
15. Existing external/local callers that are not running inside a CodeDeck-managed parent terminal retain the current `run/status/wait/continue/cancel` behavior.
16. Each parent/child binding has an automatic-return policy: `once`, `continuous`, or `manual`. `once` returns the next completed B turn then becomes `manual`; `continuous` returns every completed B turn; `manual` keeps results queryable without waking A.
17. A may choose the initial policy when starting B and may change it when continuing B. B may change the policy for its own parent binding through its scoped capability. Neither side may change another binding.
18. If A creates B with verified parent context but omits the policy, the policy defaults to `once`. Calls without parent context default to `manual` and retain existing behavior.
19. A may send an ESC-equivalent interrupt to its own B, and B may use its scoped capability to interrupt its bound A. Interrupt stops only the peer's current turn; it must not close the terminal or destroy the discussion binding.

### Security And Capacity

20. Existing bridge enablement, Profile blacklist, authentication token, request-size limits, and concurrency limits remain enforced.
21. A delegated child receives only a scoped capability to report to its bound parent, change that binding's automatic-return policy, and interrupt the bound parent's current turn. It must not receive the global bridge token or permission to list/start/control unrelated sessions.
22. Disabling the bridge or quitting CodeDeck continues to shut down delegated sessions cleanly.

## Acceptance Criteria

- [ ] Selecting or deselecting a saved argument survives reload and Profile switching without clicking Save, while unrelated unsaved Profile edits remain drafts.
- [ ] Saved argument edits preserve provider separation and hand-written argument text.
- [ ] Preview and launch commands contain the same immediately persisted argument text.
- [ ] `run` accepts valid provider-specific model/reasoning overrides, rejects invalid values, and leaves the Profile unchanged.
- [ ] A monitored A can launch B asynchronously; A finishes its current turn and B remains running.
- [ ] B's completed answer is automatically submitted to its bound A, causing a new A turn.
- [ ] A and B can independently select `once`, `continuous`, or `manual` for their own binding; policy changes affect later completed turns without changing permissions.
- [ ] `once` automatically becomes `manual` after one successful delivery, `continuous` delivers each later completed turn, and `manual` never injects automatically.
- [ ] A can interrupt B's current turn and B can interrupt A's current turn with ESC semantics; both terminals and their binding remain usable afterward.
- [ ] A busy-state race queues B's answer instead of interleaving terminal input.
- [ ] A closed/exited parent produces an explicit, inspectable delivery failure without sending to another terminal.
- [ ] A child cannot address unrelated terminals, list Profiles, or recursively launch another child through its scoped callback capability.
- [ ] Hidden and visible delegated terminals both outlive the initiating request; closing a visible child window still closes that child intentionally.
- [ ] Existing bridge clients without parent context remain backward compatible.
- [ ] Focused unit tests cover protocol validation, scoped parent binding, queued delivery, model/reasoning overlays, task lifecycle, and immediate argument persistence.

## Out Of Scope

- Arbitrary peer-to-peer control of any CodeDeck terminal.
- Unbounded recursive delegation (A starts B, B starts C, and so on).
- A general-purpose multi-agent graph/workflow editor.
- Persisting live delegated task records across a full CodeDeck application restart.
- Changing the existing behavior where explicitly closing a visible monitored terminal window stops that terminal.
