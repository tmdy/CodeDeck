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
} = {}) {
  let nextTerminal = 0;
  const snapshots = new Map<string, TerminalSessionSnapshot>();
  const subscribers = new Map<string, TerminalSessionSubscriber>();
  const sentInputs: Array<{ sessionId: string; data: string }> = [];
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
  };
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
    readLastAssistantText: vi.fn(async () => "clean assistant result"),
  });
  return { manager, terminal, subscribers, sentInputs };
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
    await vi.advanceTimersByTimeAsync(25);
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
    await vi.advanceTimersByTimeAsync(25);
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
    await vi.advanceTimersByTimeAsync(25);
    expect(fixture.sentInputs.at(-1)?.data).toBe("\r");
    vi.useRealTimers();
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
    await vi.advanceTimersByTimeAsync(25);
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
});
