import { describe, expect, it, vi } from "vitest";
import {
  AgentTaskManager,
  type AgentTaskTerminalAdapter,
} from "../../agent-bridge/task-manager.js";
import type {
  TerminalSessionSnapshot,
  TerminalSessionSubscriber,
} from "../../electron/terminal-session-manager.js";

function makeSnapshot(sessionId: string): TerminalSessionSnapshot {
  return {
    sessionId,
    provider: "codex",
    cwd: "C:\\repo",
    pid: 123,
    commandExecutable: "codex",
    commandArgs: [],
    status: "running",
    activity: "idle",
    output: "",
    autoContinue: {
      enabled: false,
      limit: 1,
      matchCount: 0,
      remaining: 1,
      lastMatchedKeyword: null,
      paused: false,
      keywords: [],
      intervalMs: 0,
      intervalMode: "fixed",
      intervalStdDevMs: 0,
    },
  };
}

function createFixture(options: {
  blocked?: boolean;
  limit?: number;
  initialPromptSubmitted?: boolean;
  parentActivity?: "idle" | "busy";
  assistantTexts?: string[];
} = {}) {
  let nextTerminal = 0;
  const snapshots = new Map<string, TerminalSessionSnapshot>();
  const subscribers = new Map<string, TerminalSessionSubscriber>();
  const sentInputs: Array<{ sessionId: string; data: string }> = [];
  const assistantTexts = [...(options.assistantTexts ?? [])];
  const readLastAssistantText = vi.fn(async () => assistantTexts.shift() ?? "clean assistant result");
  const terminal: AgentTaskTerminalAdapter = {
    launch: vi.fn(async () => {
      const terminalSessionId = "terminal-" + (++nextTerminal);
      snapshots.set(terminalSessionId, makeSnapshot(terminalSessionId));
      return {
        terminalSessionId,
        provider: "codex" as const,
        initialPromptSubmitted: options.initialPromptSubmitted,
      };
    }),
    attach: (sessionId, subscriber) => {
      subscribers.set(sessionId, subscriber);
      subscriber.onStatus(snapshots.get(sessionId)!);
      return () => subscribers.delete(sessionId);
    },
    sendInput: (sessionId, data) => sentInputs.push({ sessionId, data }),
    close: vi.fn(async (sessionId) => {
      const snapshot = snapshots.get(sessionId)!;
      snapshot.status = "closed";
      subscribers.get(sessionId)?.onStatus(snapshot);
    }),
    getSnapshot: (sessionId) => snapshots.get(sessionId),
    verifyParentContext: (sessionId, token) =>
      (sessionId === "parent-terminal" && token === "parent-secret")
      || (snapshots.has(sessionId) && token === `token-${sessionId}`),
  };
  snapshots.set("parent-terminal", {
    ...makeSnapshot("parent-terminal"),
    activity: options.parentActivity ?? "idle",
  });
  const manager = new AgentTaskManager({
    terminal,
    listProfiles: () => [{
      profile_key: "codex::demo",
      provider: "codex",
      name: "Demo",
      model: "gpt-test",
      available: true,
    }],
    isProfileBlocked: () => options.blocked === true,
    getConcurrencyLimit: () => options.limit ?? 4,
    readLastAssistantText,
  });
  return { manager, terminal, subscribers, sentInputs, snapshots, readLastAssistantText };
}

describe("AgentTaskManager", () => {
  it("runs a task, waits for lifecycle completion, and returns clean assistant text", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first line\nsecond line",
      cwd: "C:\\repo",
      waitMs: 0,
    });
    expect(initial.status).toBe("starting");
    expect(fixture.sentInputs).toEqual([]);
    fixture.subscribers.get("terminal-1")?.onOutput("› Run /review on my current changes\n");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fixture.manager.status(initial.session_id).status).toBe("running");
    expect(fixture.sentInputs[0].data).toBe(
      "\u001b[200~first line\nsecond line\u001b[201~",
    );
    expect(fixture.sentInputs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(249);
    expect(fixture.sentInputs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.sentInputs[1]).toEqual({ sessionId: "terminal-1", data: "\r" });

    fixture.manager.associateProviderSession(
      "terminal-1",
      "provider-session",
      "session.jsonl",
    );
    const waiting = fixture.manager.wait(initial.session_id, 1_000);
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });

    await expect(waiting).resolves.toMatchObject({
      ok: true,
      status: "completed",
      assistant_text: "clean assistant result",
      session_id: initial.session_id,
    });
    vi.useRealTimers();
  });

  it("returns interactive prompts and accepts an explicit continuation", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ limit: 1 });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "change files",
      waitMs: 0,
    });
    fixture.subscribers.get("terminal-1")?.onOutput("❯ Try a task\n");
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(250);
    fixture.subscribers.get("terminal-1")?.onOutput(
      "\u001b[33mDo you want to proceed? (y/n)\u001b[0m",
    );
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "awaiting_input",
      question: "Do you want to proceed? (y/n)",
    });

    const continued = await fixture.manager.continue(
      initial.session_id,
      "no",
      0,
    );
    expect(continued.status).toBe("running");
    expect(fixture.sentInputs.at(-1)?.data).toBe("no");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.at(-1)?.data).toBe("\r");
    vi.useRealTimers();
  });

  it("does not complete an interactive response before the resumed model turn starts", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "change files",
      waitMs: 0,
    });
    fixture.subscribers.get("terminal-1")?.onOutput(
      "Do you trust the contents of this directory?\r\n› 1. Yes, continue",
    );
    expect(fixture.manager.status(initial.session_id).status).toBe("awaiting_input");

    await fixture.manager.continue(initial.session_id, "1", 0);
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });
    expect(fixture.manager.status(initial.session_id).status).toBe("running");

    await vi.advanceTimersByTimeAsync(250);
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "busy",
      reason: "submitted_input",
    });
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      assistant_text: "",
    });
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\r" });
    vi.useRealTimers();
  });

  it("accepts only option one for an unobserved idle Codex trust screen", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "change files",
      waitMs: 0,
    });
    fixture.snapshots.get("terminal-1")!.activity = "idle";

    await expect(fixture.manager.continue(initial.session_id, "continue early", 0))
      .rejects.toMatchObject({ code: "session_busy" });
    await expect(fixture.manager.continue(initial.session_id, "1", 0))
      .resolves.toMatchObject({ status: "running" });
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "1" });

    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\r" });
    vi.useRealTimers();
  });

  it("completes from Codex lifecycle events, remains idempotent, and accepts another turn", async () => {
    const fixture = createFixture({
      initialPromptSubmitted: true,
      assistantTexts: ["first result", "second result"],
    });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");

    const idlePrompt = {
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy" as const,
      activity: "idle" as const,
      reason: "idle_prompt" as const,
    };
    fixture.manager.handleActivityChange(idlePrompt);
    fixture.manager.handleActivityChange({ ...idlePrompt, reason: "turn_completed" });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "first result",
    }));
    expect(fixture.readLastAssistantText).toHaveBeenCalledTimes(1);

    await expect(fixture.manager.continue(initial.session_id, "second task", 0)).resolves.toMatchObject({
      status: "running",
      session_id: initial.session_id,
    });
    fixture.manager.handleActivityChange({ ...idlePrompt, reason: "turn_completed" });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "second result",
    }));
    expect(fixture.readLastAssistantText).toHaveBeenCalledTimes(2);
  });

  it("waits for provider lifecycle completion after a session file is associated", async () => {
    const fixture = createFixture({
      initialPromptSubmitted: true,
      assistantTexts: ["authoritative result"],
    });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      assistant_text: "",
    });
    expect(fixture.readLastAssistantText).not.toHaveBeenCalled();

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "authoritative result",
    }));
  });

  it("reports provider failures and resumes the same session only on explicit continue", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      waitMs: 0,
    });
    const error = {
      code: "provider_error",
      message: "unexpected status 503 Service Unavailable: No available channel",
      retryable: true,
    };

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_failed",
      error,
    });

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      ok: false,
      status: "failed",
      session_id: initial.session_id,
      assistant_text: "",
      question: null,
      error,
    });

    await expect(fixture.manager.continue(initial.session_id, "retry explicitly", 0))
      .resolves.toMatchObject({
        ok: true,
        status: "running",
        session_id: initial.session_id,
        error: null,
      });
    expect(fixture.sentInputs.at(-1)).toEqual({
      sessionId: "terminal-1",
      data: "retry explicitly",
    });
  });

  it("does not let stale completion events overwrite a provider failure", async () => {
    let resolveRead!: (value: string) => void;
    const oldRead = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });
    const fixture = createFixture({ initialPromptSubmitted: true });
    fixture.readLastAssistantText.mockImplementationOnce(() => oldRead);
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.readLastAssistantText).toHaveBeenCalledTimes(1));

    const error = {
      code: "provider_error",
      message: "unexpected status 521 Web Server Is Down",
      retryable: true,
    };
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "idle",
      reason: "turn_failed",
      error,
    });
    resolveRead("stale assistant result");
    await Promise.resolve();

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "idle",
      reason: "turn_completed",
    });
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "idle",
      reason: "idle_prompt",
    });

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "failed",
      assistant_text: "",
      error,
    });
    expect(fixture.readLastAssistantText).toHaveBeenCalledTimes(1);
  });

  it("keeps an interactive prompt awaiting input when an idle prompt is reported", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "inspect hooks",
      waitMs: 0,
    });
    fixture.subscribers.get("terminal-1")?.onOutput(
      "Do you want to proceed with this hook? (y/n)\r\n› ",
    );
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "awaiting_input",
      question: expect.stringContaining("Do you want to proceed"),
    });
    expect(fixture.readLastAssistantText).not.toHaveBeenCalled();
    await expect(fixture.manager.continue(initial.session_id, "no", 0)).resolves.toMatchObject({
      status: "running",
    });
  });

  it("clears a repainted interactive prompt when the terminal reports busy output", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "inspect hooks",
      waitMs: 0,
    });
    fixture.subscribers.get("terminal-1")?.onOutput(
      "Do you want to proceed? (y/n)\r\n› ",
    );
    expect(fixture.manager.status(initial.session_id).status).toBe("awaiting_input");

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "busy",
      reason: "busy_output",
    });

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      question: null,
      terminal_tail: "",
    });
    fixture.subscribers.get("terminal-1")?.onOutput("Working (1s • esc to interrupt)");
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      question: null,
      terminal_tail: expect.stringContaining("Working"),
    });
  });

  it("prefers newer busy output over an older interactive prompt in the same repaint", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "inspect hooks",
      waitMs: 0,
    });

    fixture.subscribers.get("terminal-1")?.onOutput(
      "Do you want to proceed? (y/n)\r\n› 1. Yes\r\nWorking (1s • esc to interrupt)",
    );

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      question: null,
    });
  });

  it("opens a new tracked turn when input is submitted directly to a completed orchestrator", async () => {
    const fixture = createFixture({
      initialPromptSubmitted: true,
      assistantTexts: ["first result", "returned result"],
    });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate",
      orchestrator: true,
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "first result",
    }));

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "busy",
      reason: "submitted_input",
    });
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      assistant_text: "",
    });
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "returned result",
    }));
  });

  it("does not let an old completion overwrite a new directly submitted turn", async () => {
    let resolveOldRead = (_value: string): void => undefined;
    const oldRead = new Promise<string>((resolve) => {
      resolveOldRead = resolve;
    });
    const fixture = createFixture({ initialPromptSubmitted: true });
    fixture.readLastAssistantText.mockImplementationOnce(() => oldRead);
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      orchestrator: true,
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.readLastAssistantText).toHaveBeenCalledTimes(1));

    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "idle",
      activity: "busy",
      reason: "submitted_input",
    });
    resolveOldRead("stale first result");
    await Promise.resolve();

    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      assistant_text: "",
    });
  });

  it("waits for a stable CLI prompt and ignores permission text in the startup banner", async () => {
    vi.useFakeTimers();
    const fixture = createFixture();
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "inspect files",
      waitMs: 0,
    });

    fixture.subscribers.get("terminal-1")?.onOutput(
      "permissions: YOLO mode\n› Run /review on my current changes\n",
    );
    await vi.advanceTimersByTimeAsync(750);
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "starting",
      question: null,
    });
    expect(fixture.sentInputs).toEqual([]);

    fixture.subscribers.get("terminal-1")?.onOutput(
      "Starting MCP servers (2/4)\n› Run /review on my current changes\n",
    );
    await vi.advanceTimersByTimeAsync(999);
    expect(fixture.sentInputs).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fixture.sentInputs).toEqual([{
      sessionId: "terminal-1",
      data: "inspect files",
    }]);
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\r" });
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "running",
      question: null,
    });
    vi.useRealTimers();
  });

  it("does not retype a Unicode prompt when the launcher submitted it", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const prompt = "write codex::星辰\u00b7AI exactly";

    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt,
      waitMs: 0,
    });

    expect(initial.status).toBe("running");
    expect(fixture.terminal.launch).toHaveBeenCalledWith(expect.objectContaining({
      initialPrompt: prompt,
    }));
    expect(fixture.sentInputs).toEqual([]);
  });

  it("filters and rejects blacklisted profiles", async () => {
    const fixture = createFixture({ blocked: true });
    expect(fixture.manager.listProfiles().profiles).toEqual([]);
    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "task",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "profile_blocked" });
  });

  it("counts pending launches against the concurrency limit", async () => {
    let resolveLaunch!: (result: { terminalSessionId: string; provider: "codex" }) => void;
    const launch = vi.fn(() => new Promise<{ terminalSessionId: string; provider: "codex" }>(
      (resolve) => {
        resolveLaunch = resolve;
      },
    ));
    const snapshot = makeSnapshot("terminal-pending");
    const manager = new AgentTaskManager({
      terminal: {
        launch,
        attach: (_sessionId, subscriber) => {
          subscriber.onStatus(snapshot);
          return () => undefined;
        },
        sendInput: () => undefined,
        close: async () => undefined,
        getSnapshot: () => snapshot,
        verifyParentContext: () => false,
      },
      listProfiles: () => [{
        profile_key: "codex::demo",
        provider: "codex",
        name: "Demo",
        model: "gpt-test",
        available: true,
      }],
      isProfileBlocked: () => false,
      getConcurrencyLimit: () => 1,
      readLastAssistantText: async () => "",
    });

    const firstRun = manager.run({
      profileKey: "codex::demo",
      prompt: "first",
      waitMs: 0,
    });
    await vi.waitFor(() => expect(launch).toHaveBeenCalledTimes(1));
    await expect(manager.run({
      profileKey: "codex::demo",
      prompt: "second",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "capacity_exceeded" });
    resolveLaunch({ terminalSessionId: "terminal-pending", provider: "codex" });
    await expect(firstRun).resolves.toMatchObject({ status: "starting" });
  });

  it("validates provider reasoning levels before launching", async () => {
    const fixture = createFixture();
    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "task",
      reasoningEffort: "invalid",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "invalid_reasoning_effort" });
    expect(fixture.terminal.launch).not.toHaveBeenCalled();
  });

  it("rejects unverified parent bindings", async () => {
    const fixture = createFixture();
    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "task",
      parentSessionId: "unrelated-terminal",
      parentToken: "wrong",
      returnPolicy: "once",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "invalid_parent" });
  });

  it("rejects a delegated task terminal as the parent of another task", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first task",
      waitMs: 0,
    });

    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "recursive task",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "invalid_parent" });
    expect(fixture.terminal.launch).toHaveBeenCalledTimes(1);
  });

  it("lets a verified parent interrupt its busy child without closing it", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    });
    fixture.snapshots.get("terminal-1")!.activity = "busy";

    expect(fixture.manager.interruptChild(
      initial.session_id,
      "parent-terminal",
      "parent-secret",
    )).toMatchObject({ status: "running", session_id: initial.session_id });
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\x1b" });
    expect(fixture.snapshots.get("terminal-1")?.status).toBe("running");

    expect(() => fixture.manager.interruptChild(
      initial.session_id,
      "unrelated-terminal",
      "wrong",
    )).toThrow("只能中断当前父终端创建的代理会话");
  });

  it("requires the verified parent for every bound child continuation", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    });
    fixture.snapshots.get("terminal-1")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id).status).toBe("completed"));

    await expect(fixture.manager.continue(initial.session_id, "stolen turn", 0)).rejects.toMatchObject({
      code: "unauthorized",
    });
    await expect(fixture.manager.continue(
      initial.session_id,
      "owned turn",
      0,
      undefined,
      "parent-terminal",
      "parent-secret",
    )).resolves.toMatchObject({ status: "running" });
  });

  it("recovers an interrupted child at the idle prompt without closing its session", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "long review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.snapshots.get("terminal-1")!.activity = "busy";

    fixture.manager.interruptChild(
      initial.session_id,
      "parent-terminal",
      "parent-secret",
    );
    expect(fixture.sentInputs.filter((input) => input.data === "\x1b")).toHaveLength(1);

    fixture.snapshots.get("terminal-1")!.activity = "idle";
    fixture.subscribers.get("terminal-1")?.onOutput("^C\r\n› ");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "",
      delivery_status: "not_requested",
    }));

    expect(() => fixture.manager.interruptChild(
      initial.session_id,
      "parent-terminal",
      "parent-secret",
    )).toThrow("代理会话当前没有可中断的运行轮次");
    expect(fixture.sentInputs.filter((input) => input.data === "\x1b")).toHaveLength(1);
    expect(fixture.terminal.close).not.toHaveBeenCalled();
    expect(fixture.snapshots.get("terminal-1")?.status).toBe("running");
  });

  it("lets a scoped child interrupt only its busy parent", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true, parentActivity: "busy" });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    });
    const callbackToken = vi.mocked(fixture.terminal.launch).mock.calls[0]?.[0].callbackToken;
    expect(callbackToken).toBeTruthy();

    expect(fixture.manager.scopedPolicy(callbackToken!, "continuous")).toMatchObject({
      return_policy: "continuous",
      parent_session_id: "parent-terminal",
    });

    expect(fixture.manager.scopedInterruptParent(callbackToken!)).toMatchObject({
      status: "running",
      session_id: initial.session_id,
    });
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "parent-terminal", data: "\x1b" });
    expect(fixture.snapshots.get("parent-terminal")?.status).toBe("running");

    fixture.snapshots.get("parent-terminal")!.activity = "idle";
    expect(() => fixture.manager.scopedInterruptParent(callbackToken!)).toThrow(
      "父会话当前没有可中断的运行轮次",
    );
    expect(() => fixture.manager.scopedInterruptParent("wrong-token")).toThrow(
      "作用域回传凭据无效或已过期",
    );
  });

  it("settles a tracked parent after its scoped child interrupts the current turn", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const parent = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate a debate",
      orchestrator: true,
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "parent-provider-session", "parent.jsonl");
    fixture.snapshots.get("terminal-1")!.activity = "busy";

    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "prepare the opposing case",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    const callbackToken = vi.mocked(fixture.terminal.launch).mock.calls[1]?.[0].callbackToken;

    fixture.manager.scopedInterruptParent(callbackToken!);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\x1b" });

    fixture.snapshots.get("terminal-1")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "idle_prompt",
    });

    await vi.waitFor(() => expect(fixture.manager.status(parent.session_id)).toMatchObject({
      status: "completed",
      assistant_text: "",
    }));
    expect(fixture.readLastAssistantText).not.toHaveBeenCalled();
    expect(fixture.snapshots.get("terminal-1")?.status).toBe("running");
  });

  it("lets a scoped child inspect and continue only its bound orchestrator", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({
      initialPromptSubmitted: true,
      assistantTexts: ["parent ready"],
    });
    const parent = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate a debate",
      orchestrator: true,
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "parent-session", "parent.jsonl");
    fixture.subscribers.get("terminal-1")?.onOutput("parent terminal evidence");
    fixture.snapshots.get("terminal-1")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(parent.session_id).status).toBe("completed"));

    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "prepare the opposing case",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      returnPolicy: "manual",
      waitMs: 0,
    });
    const callbackToken = vi.mocked(fixture.terminal.launch).mock.calls[1]?.[0].callbackToken;

    expect(fixture.manager.scopedStatusParent(callbackToken!)).toMatchObject({
      session_id: parent.session_id,
      status: "completed",
      terminal_tail: "parent terminal evidence",
    });
    await expect(fixture.manager.scopedContinueParent(
      callbackToken!,
      "Here is B's argument; start A's next turn now.",
    )).resolves.toMatchObject({
      session_id: parent.session_id,
      status: "running",
    });
    expect(fixture.manager.status(parent.session_id).status).toBe("running");
    expect(fixture.manager.status(vi.mocked(fixture.terminal.launch).mock.calls[1][0].childTaskId).status)
      .toBe("running");
    expect(fixture.sentInputs.at(-1)).toEqual({
      sessionId: "terminal-1",
      data: "Here is B's argument; start A's next turn now.",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "terminal-1", data: "\r" });
    vi.useRealTimers();
  });

  it("rejects scoped parent continuation while the exact parent is busy or stopped", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate a debate",
      orchestrator: true,
      waitMs: 0,
    });
    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "prepare the opposing case",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      returnPolicy: "manual",
      waitMs: 0,
    });
    const callbackToken = vi.mocked(fixture.terminal.launch).mock.calls[1]?.[0].callbackToken;

    await expect(fixture.manager.scopedContinueParent(callbackToken!, "too early"))
      .rejects.toMatchObject({ code: "session_busy", retryable: true });
    fixture.snapshots.get("terminal-1")!.status = "closed";
    await expect(fixture.manager.scopedContinueParent(callbackToken!, "too late"))
      .rejects.toMatchObject({ code: "session_not_running", retryable: false });
    expect(() => fixture.manager.scopedStatusParent("wrong-token"))
      .toThrow("作用域回传凭据无效或已过期");
  });

  it("allows one tracked orchestrator to launch one bound child", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    const parent = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate a debate",
      orchestrator: true,
      waitMs: 0,
    });
    expect(parent.status).toBe("running");
    expect(vi.mocked(fixture.terminal.launch).mock.calls[0]?.[0]).toMatchObject({
      orchestrator: true,
    });

    const child = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "prepare the opposing case",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    expect(child).toMatchObject({
      status: "running",
      parent_session_id: "terminal-1",
      return_policy: "continuous",
    });
    expect(vi.mocked(fixture.terminal.launch).mock.calls[1]?.[0]).toMatchObject({
      orchestrator: false,
    });

    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "start another child",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "child_already_bound" });

    fixture.snapshots.get("terminal-2")!.status = "closed";
    fixture.subscribers.get("terminal-2")?.onStatus(fixture.snapshots.get("terminal-2")!);
    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "replace the stopped child",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    })).resolves.toMatchObject({
      status: "running",
      parent_session_id: "terminal-1",
    });
  });

  it("reserves an orchestrator parent while its first child is still launching", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "coordinate a debate",
      orchestrator: true,
      waitMs: 0,
    });

    let releaseLaunch = (): void => undefined;
    const launchGate = new Promise<void>((resolve) => {
      releaseLaunch = resolve;
    });
    vi.mocked(fixture.terminal.launch).mockImplementationOnce(async () => {
      await launchGate;
      const terminalSessionId = "terminal-pending-child";
      fixture.snapshots.set(terminalSessionId, makeSnapshot(terminalSessionId));
      return {
        terminalSessionId,
        provider: "codex" as const,
        initialPromptSubmitted: true,
      };
    });

    const firstChild = fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "prepare the opposing case",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    });
    expect(fixture.terminal.launch).toHaveBeenCalledTimes(2);

    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "race another child",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "child_already_bound", retryable: true });

    releaseLaunch();
    await expect(firstChild).resolves.toMatchObject({
      status: "running",
      parent_session_id: "terminal-1",
    });
    expect(fixture.terminal.launch).toHaveBeenCalledTimes(2);
  });

  it("does not allow ordinary tracked tasks or nested orchestrators to become parents", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true });
    await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "ordinary child",
      waitMs: 0,
    });

    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "nested task",
      parentSessionId: "terminal-1",
      parentToken: "token-terminal-1",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "invalid_parent" });
    await expect(fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "nested orchestrator",
      orchestrator: true,
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    })).rejects.toMatchObject({ code: "invalid_parent" });
  });

  it("queues while the parent is busy, delivers once when idle, and stays idempotent", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ initialPromptSubmitted: true, parentActivity: "busy" });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.runAllTicks();
    await vi.advanceTimersByTimeAsync(0);
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      delivery_status: "pending",
      return_policy: "once",
    });
    expect(fixture.sentInputs).toEqual([]);

    fixture.snapshots.get("parent-terminal")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    expect(fixture.sentInputs[0]).toMatchObject({ sessionId: "parent-terminal" });
    expect(fixture.sentInputs[0].data).toContain("[[CodeDeck delegated opinion:");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "parent-terminal", data: "\r" });
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      delivery_status: "delivered",
      return_policy: "manual",
    });

    const inputCount = fixture.sentInputs.length;
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs).toHaveLength(inputCount);
    vi.useRealTimers();
  });

  it("does not paste a delivery twice when idle is reported again before Enter", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ initialPromptSubmitted: true, parentActivity: "idle" });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.sentInputs).toHaveLength(1));

    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "idle",
      activity: "idle",
      reason: "idle_prompt",
    });
    expect(fixture.sentInputs).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs).toHaveLength(2);
    expect(fixture.sentInputs.at(-1)).toEqual({ sessionId: "parent-terminal", data: "\r" });
    expect(fixture.manager.status(initial.session_id).delivery_status).toBe("delivered");
    vi.useRealTimers();
  });

  it("cancels a queued automatic return when the parent continues in manual mode", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({ initialPromptSubmitted: true, parentActivity: "busy" });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id).status).toBe("completed"));

    await fixture.manager.continue(
      initial.session_id,
      "follow up",
      0,
      "manual",
      "parent-terminal",
      "parent-secret",
    );
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      delivery_status: "not_requested",
      return_policy: "manual",
    });

    fixture.snapshots.get("parent-terminal")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.filter((input) => input.sessionId === "parent-terminal")).toEqual([]);
    vi.useRealTimers();
  });

  it("preserves continuous results across child turns and submits them one parent turn at a time", async () => {
    vi.useFakeTimers();
    const fixture = createFixture({
      initialPromptSubmitted: true,
      parentActivity: "busy",
      assistantTexts: ["first child result", "second child result"],
    });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "first review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id).assistant_text).toBe("first child result"));

    await fixture.manager.continue(
      initial.session_id,
      "second review",
      0,
      undefined,
      "parent-terminal",
      "parent-secret",
    );
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id).assistant_text).toBe("second child result"));

    fixture.snapshots.get("parent-terminal")!.activity = "idle";
    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    expect(fixture.sentInputs.filter((input) => input.sessionId === "parent-terminal")).toHaveLength(1);
    expect(fixture.sentInputs.at(-1)?.data).toContain("first child result");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.filter((input) => input.sessionId === "parent-terminal")).toHaveLength(2);

    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    expect(fixture.sentInputs.filter((input) => input.sessionId === "parent-terminal")).toHaveLength(3);
    expect(fixture.sentInputs.at(-1)?.data).toContain("second child result");
    await vi.advanceTimersByTimeAsync(250);
    expect(fixture.sentInputs.filter((input) => input.sessionId === "parent-terminal")).toHaveLength(4);
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      delivery_status: "delivered",
      return_policy: "continuous",
    });
    vi.useRealTimers();
  });

  it("keeps the child result inspectable when the parent exits before delivery", async () => {
    const fixture = createFixture({ initialPromptSubmitted: true, parentActivity: "busy" });
    const initial = await fixture.manager.run({
      profileKey: "codex::demo",
      prompt: "review",
      parentSessionId: "parent-terminal",
      parentToken: "parent-secret",
      returnPolicy: "continuous",
      waitMs: 0,
    });
    fixture.manager.associateProviderSession("terminal-1", "provider-session", "session.jsonl");
    fixture.manager.handleActivityChange({
      sessionId: "terminal-1",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "turn_completed",
    });
    await vi.waitFor(() => expect(fixture.manager.status(initial.session_id).status).toBe("completed"));
    fixture.snapshots.get("parent-terminal")!.status = "closed";
    fixture.manager.handleActivityChange({
      sessionId: "parent-terminal",
      provider: "codex",
      previousActivity: "busy",
      activity: "idle",
      reason: "session_closed",
    });
    expect(fixture.manager.status(initial.session_id)).toMatchObject({
      assistant_text: "clean assistant result",
      delivery_status: "failed",
      delivery_error: expect.stringContaining("父终端已退出或关闭"),
    });
  });
});
