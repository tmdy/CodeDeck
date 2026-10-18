import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TerminalSessionManager,
  type PtyProcess,
  type PtyProcessExitEvent,
} from "../../electron/terminal-session-manager.js";

class FakePtyProcess implements PtyProcess {
  pid = 4242;
  writes: string[] = [];
  kills = 0;
  resizes: Array<{ cols: number; rows: number }> = [];
  onWrite?: (data: string) => void;
  private dataListeners = new Set<(data: string) => void>();
  private exitListeners = new Set<(event: PtyProcessExitEvent) => void>();

  onData(listener: (data: string) => void): () => void {
    this.dataListeners.add(listener);
    return () => {
      this.dataListeners.delete(listener);
    };
  }

  onExit(listener: (event: PtyProcessExitEvent) => void): () => void {
    this.exitListeners.add(listener);
    return () => {
      this.exitListeners.delete(listener);
    };
  }

  write(data: string): void {
    this.writes.push(data);
    this.onWrite?.(data);
  }

  resize(cols: number, rows: number): void {
    this.resizes.push({ cols, rows });
  }

  kill(): void {
    this.kills += 1;
  }

  emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  emitExit(event: PtyProcessExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

describe("TerminalSessionManager", () => {
  let fakePty: FakePtyProcess;

  beforeEach(() => {
    fakePty = new FakePtyProcess();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function codexSession(intervalMs = 0, limit = -1) {
    const onActivityChange = vi.fn();
    const manager = new TerminalSessionManager({ createPtyProcess: () => fakePty, onActivityChange });
    const snapshot = await manager.createSession({
      provider: "codex", cwd: "C:/test", commandExecutable: "codex", commandArgs: [], env: {},
      autoContinue: { enabled: true, limit, prompt: "继续", keywords: ["high demand", "503"], intervalMs },
    });
    return { manager, id: snapshot.sessionId, onActivityChange };
  }

  it("preserves the real 65-second retry deadline through focus events at 48 seconds", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const { manager, id } = await codexSession(65_608);
    const onStatus = vi.fn();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    const scheduled = manager.getSnapshot(id)?.autoContinueSchedule;
    const statuses = onStatus.mock.calls.length;
    await vi.advanceTimersByTimeAsync(48_791);
    manager.sendInput(id, "\x1b[I");
    manager.sendInput(id, "\x1b[O");
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toEqual(scheduled);
    expect(onStatus).toHaveBeenCalledTimes(statuses);
    await vi.advanceTimersByTimeAsync(16_817);
    expect(fakePty.writes).toEqual(["\x1b[I", "\x1b[O", "继续\r"]);
    expect(manager.getSnapshot(id)?.autoContinue.matchCount).toBe(1);
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
  });

  it("forwards mouse and device replies without changing queue or polluting the next blank Enter", async () => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(5_000);
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    const packets = ["\x1b[<0;12;34M", "\x1b[?1;2c", "\x1b[0n", "\x1b]11;rgb:0000/0000/0000\x1b\\"];
    for (const packet of packets) manager.sendInput(id, packet);
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeDefined();
    manager.sendInput(id, "\r");
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fakePty.writes).toEqual([...packets, "\r"]);
  });

  it.each(["\x1b[Ityped", "\x1b[A", "\x1b", "\x03", "\x1b[200~\x1b[I\x1b[201~", "\x1b[1;2R"])("keeps actual/ambiguous input %j cancelling and forwarded", async (data) => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(5_000);
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    manager.sendInput(id, data);
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fakePty.writes).toEqual([data]);
  });

  it("recognizes query-correlated and fragmented replies without polluting submitted input", async () => {
    const { manager, id } = await codexSession();
    fakePty.emitData("\x1b[6n");
    manager.sendInput(id, "\x1b[1;2R");
    manager.sendInput(id, "\x1b[");
    manager.sendInput(id, "I");
    manager.sendInput(id, "\r");
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    expect(fakePty.writes).toEqual(["\x1b[1;2R", "\x1b[", "I", "\r"]);
  });

  it("does not let an old turn's cursor query exempt a new Shift+F3 key from cancellation", async () => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(5_000);
    fakePty.emitData("\x1b[6n");
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    manager.sendInput(id, "\x1b[1;2R");
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
    expect(fakePty.writes).toEqual(["\x1b[1;2R"]);
  });

  it("publishes the actual sampled queue, not its mean, and clones schedule metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    const { manager, id } = await codexSession(10_000);
    manager.updateAutoContinueConfig(id, { intervalMode: "normal", intervalStdDevMs: 2_000 });
    const onStatus = vi.fn();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    const schedule = manager.getSnapshot(id)?.autoContinueSchedule;
    expect(schedule?.phase).toBe("waiting");
    expect(schedule?.delayMs).toBe(7_645);
    expect(schedule?.dueAtMs).toBe(8_645);
    expect(schedule?.queuedAtMs).toBe(1_000);
    expect(onStatus.mock.calls.at(-1)?.[0].autoContinueSchedule).toEqual(schedule);
    schedule!.dueAtMs = 999;
    expect(manager.getSnapshot(id)?.autoContinueSchedule?.dueAtMs).toBe(8_645);
    await vi.advanceTimersByTimeAsync(7_645);
    expect(fakePty.writes).toEqual(["继续\r"]);
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
    expect(onStatus.mock.calls.at(-1)?.[0].autoContinueSchedule).toBeUndefined();
    random.mockRestore();
  });

  it("publishes renderer-wait state when delay expires and clears it on successful send", async () => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(1_000);
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(manager.getSnapshot(id)?.autoContinueSchedule?.phase).toBe("waiting_for_renderer");
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    expect(fakePty.writes).toEqual(["继续\r"]);
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
  });

  it.each(["success", "pause", "disable", "input", "switch", "exit", "close"])("publishes cancellation on %s without sending", async (reason) => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(1_000);
    const onStatus = vi.fn();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeDefined();
    if (reason === "success") manager.reportTurnLifecycle(id, "completed");
    else if (reason === "pause") manager.updateAutoContinueConfig(id, { paused: true });
    else if (reason === "disable") manager.updateAutoContinueConfig(id, { enabled: false });
    else if (reason === "input") manager.sendInput(id, "x");
    else if (reason === "switch") manager.resetProviderSession(id);
    else if (reason === "exit") fakePty.emitExit({ exitCode: 0 });
    else await manager.closeSession(id);
    expect(onStatus.mock.calls.at(-1)?.[0].autoContinueSchedule).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fakePty.writes).toEqual(reason === "input" ? ["x"] : []);
  });

  it("publishes a write failure instead of claiming the queued input was sent", async () => {
    const { manager, id } = await codexSession();
    const events = vi.fn();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: events });
    vi.spyOn(fakePty, "write").mockImplementation(() => { throw new Error("test pipe closed"); });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toMatchObject({ phase: "send_failed", error: "test pipe closed" });
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    expect(events.mock.calls.at(-1)?.[0].autoContinueSchedule.phase).toBe("send_failed");
  });

  it("preserves a failed send through renderer reattachment until new input cancels it", async () => {
    const { manager, id } = await codexSession();
    const detach = manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    const write = vi.spyOn(fakePty, "write").mockImplementation(() => { throw new Error("test pipe closed"); });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand", retryable: true });
    detach();
    const onStatus = vi.fn();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus });
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toMatchObject({ phase: "send_failed", error: "test pipe closed" });
    expect(onStatus.mock.calls.at(-1)?.[0].autoContinueSchedule?.phase).toBe("send_failed");
    expect(write).toHaveBeenCalledTimes(1);
    write.mockRestore();
    manager.sendInput(id, "new request\r");
    expect(manager.getSnapshot(id)?.autoContinueSchedule).toBeUndefined();
  });

  it.each(["completed", "failed"] as const)("keeps an authoritative %s turn idle through old Working redraws", async (phase) => {
    const { manager, id } = await codexSession();
    manager.sendInput(id, "test\r");
    fakePty.emitData("Working (1s • esc to interrupt)");
    manager.reportTurnLifecycle(id, phase);
    fakePty.emitData("\r\nWorking (1s • esc to interrupt)");
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    manager.sendInput(id, "next\r");
    expect(manager.getSnapshot(id)?.activity).toBe("busy");
  });

  it("emits authoritative completion once after a stable prompt fallback", async () => {
    vi.useFakeTimers();
    const { manager, id, onActivityChange } = await codexSession();
    manager.sendInput(id, "test\r");
    fakePty.emitData("answer\r\n› ");
    await vi.advanceTimersByTimeAsync(250);
    manager.reportTurnLifecycle(id, "completed", undefined, { turnId: undefined });
    manager.reportTurnLifecycle(id, "completed");
    expect(onActivityChange.mock.calls.filter(([event]) => event.reason === "turn_completed")).toHaveLength(1);
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
  });

  it("settles the screenshot completion without an identity/lifecycle watcher and keeps a new submission busy", async () => {
    vi.useFakeTimers();
    const { manager, id, onActivityChange } = await codexSession();
    manager.sendInput(id, "inspect repository\r");
    fakePty.emitData("› inspect repository\r\nWorking (83m • esc to interrupt)\r\n");
    fakePty.emitData([
      "• completed result", "  Worked for 1h 23m 3s • 02:34",
      "› Ask Codex to do anything", "  GPT-6-Astra xhigh · D:\\CodeDeck",
    ].join("\r\n"));
    await vi.advanceTimersByTimeAsync(249);
    expect(manager.getSnapshot(id)?.activity).toBe("busy");
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    expect(onActivityChange.mock.calls.filter(([event]) => event.reason === "idle_prompt")).toHaveLength(1);
    fakePty.emitData("\r\nWorking (83m • esc to interrupt)");
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
    manager.sendInput(id, "new task\r");
    fakePty.emitData("› new task\r\nWorking (1s • esc to interrupt)\r\n› Ask Codex to do anything");
    await vi.advanceTimersByTimeAsync(500);
    expect(manager.getSnapshot(id)?.activity).toBe("busy");
    expect(manager.getSnapshot(id)?.autoContinue.matchCount).toBe(0);
  });

  it("ignores old completed events after a new submission and accepts the new turn", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const { manager, id } = await codexSession();
    manager.sendInput(id, "first\r");
    manager.reportTurnLifecycle(id, "started", undefined, { turnId: "first", timestampMs: 1_001 });
    manager.reportTurnLifecycle(id, "completed", undefined, { turnId: "first", timestampMs: 1_002 });
    vi.setSystemTime(2_000);
    manager.sendInput(id, "second\r");
    manager.reportTurnLifecycle(id, "completed", undefined, { turnId: "first", timestampMs: 1_002 });
    expect(manager.getSnapshot(id)?.activity).toBe("busy");
    manager.reportTurnLifecycle(id, "started", undefined, { turnId: "second", timestampMs: 2_001 });
    manager.reportTurnLifecycle(id, "completed", undefined, { turnId: "first", timestampMs: 2_002 });
    expect(manager.getSnapshot(id)?.activity).toBe("busy");
    manager.reportTurnLifecycle(id, "completed", undefined, { turnId: "second", timestampMs: 2_003 });
    expect(manager.getSnapshot(id)?.activity).toBe("idle");
  });

  it("never authorizes Codex retries from prose, user echo or split reconnect text", async () => {
    const { manager, id } = await codexSession();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    manager.sendInput(id, "explain high demand\r");
    fakePty.emitData("high demand 503 is a temporary server error\nReconnecting... 1/5");
    fakePty.emitData(" high demand");
    manager.reportTurnLifecycle(id, "completed");
    fakePty.emitData("■ high demand 503\n");
    expect(fakePty.writes).toEqual(["explain high demand\r"]);
    expect(manager.getSnapshot(id)?.autoContinue.matchCount).toBe(0);
  });

  it.each(["completed", "submitted", "started", "switched"])("cancels a pending retry on %s", async (change) => {
    vi.useFakeTimers();
    const { manager, id } = await codexSession(2_000);
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    manager.reportTurnLifecycle(id, "failed", { code: "provider_error", message: "high demand 503", retryable: true });
    expect(manager.getSnapshot(id)?.autoContinue.matchCount).toBe(1);
    if (change === "submitted") manager.sendInput(id, "next\r");
    else if (change === "switched") manager.resetProviderSession(id);
    else manager.reportTurnLifecycle(id, change === "started" ? "started" : "completed");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(fakePty.writes).toEqual(change === "submitted" ? ["next\r"] : []);
  });

  it("cancels renderer-deferred retry on success and preserves the cumulative budget", async () => {
    const { manager, id } = await codexSession(0, 1);
    const error = { code: "provider_error", message: "high demand 503", retryable: true };
    manager.reportTurnLifecycle(id, "failed", error);
    manager.reportTurnLifecycle(id, "completed");
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    expect(fakePty.writes).toEqual([]);
    manager.reportTurnLifecycle(id, "started");
    manager.reportTurnLifecycle(id, "failed", error);
    expect(fakePty.writes).toEqual([]);
    expect(manager.getSnapshot(id)?.autoContinue.matchCount).toBe(1);
  });

  it("sends one structured retryable failure and ignores auth failure and interrupted turns", async () => {
    const { manager, id } = await codexSession();
    manager.attachSession(id, { onOutput: vi.fn(), onStatus: vi.fn() });
    const error = { code: "provider_error", message: "high demand 503", retryable: true };
    manager.reportTurnLifecycle(id, "started", undefined, { turnId: "retry" });
    manager.reportTurnLifecycle(id, "failed", error, { turnId: "retry" });
    manager.reportTurnLifecycle(id, "failed", error, { turnId: "retry" });
    expect(fakePty.writes).toEqual(["继续\r"]);
    manager.reportTurnLifecycle(id, "started", undefined, { turnId: "auth" });
    manager.reportTurnLifecycle(id, "failed", { ...error, retryable: false }, { turnId: "auth" });
    expect(fakePty.writes).toEqual(["继续\r"]);
  });

  it("replays buffered output when a renderer attaches later", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });

    fakePty.emitData("hello codex");

    const received: string[] = [];
    const statuses: string[] = [];
    const detach = manager.attachSession(session.sessionId, {
      onOutput: (chunk) => received.push(chunk),
      onStatus: (snapshot) => statuses.push(snapshot.status),
    });

    expect(received).toEqual(["hello codex"]);
    expect(statuses.at(-1)).toBe("running");

    detach();
  });

  it("keeps submitted work busy until the provider reports turn completion", async () => {
    const activityEvents: string[] = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onActivityChange: (event) => {
        activityEvents.push(`${event.previousActivity}->${event.activity}:${event.reason}`);
      },
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");

    fakePty.emitData("完成\r\n› ");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
    manager.reportTurnLifecycle(session.sessionId, "completed");

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
    expect(activityEvents).toEqual([
      "idle->busy:submitted_input",
      "busy->idle:turn_completed",
    ]);
  });

  it("propagates provider failure lifecycle events even when activity is already idle", async () => {
    const events: Array<{
      reason: string;
      activity: string;
      error?: { code: string; message: string; retryable: boolean };
    }> = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onActivityChange: (event) => events.push(event),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });
    const error = {
      code: "provider_error",
      message: "unexpected status 503 Service Unavailable",
      retryable: true,
    };

    manager.reportTurnLifecycle(session.sessionId, "failed", error);

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      reason: "turn_failed",
      activity: "idle",
      error,
    });
  });

  it("does not mark a multiline bracketed paste busy until Enter is sent", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "\u001b[200~first line\nsecond line\u001b[201~");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
    manager.sendInput(session.sessionId, "\r");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("falls back to a stable idle prompt after output subscribers inspect it", async () => {
    vi.useFakeTimers();
    const events: string[] = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onActivityChange: (event) => {
        events.push(`activity:${event.reason}`);
      },
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: () => events.push("output"),
      onStatus: vi.fn(),
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    events.length = 0;
    fakePty.emitData("完成\r\n› ");

    expect(events).toEqual(["output"]);
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
    await vi.advanceTimersByTimeAsync(249);
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
    await vi.advanceTimersByTimeAsync(1);
    expect(events).toEqual(["output", "activity:idle_prompt"]);
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
  });

  it("settles a Codex placeholder prompt to idle", async () => {
    vi.useFakeTimers();
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    fakePty.emitData("完成\r\n› Implement {feature}\r\n");
    await vi.advanceTimersByTimeAsync(250);

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
  });

  it("cancels a provisional idle prompt when the TUI resumes output", async () => {
    vi.useFakeTimers();
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    fakePty.emitData("\r\n› ");
    await vi.advanceTimersByTimeAsync(100);
    fakePty.emitData("Working (0s • esc to interrupt)");
    await vi.advanceTimersByTimeAsync(250);

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("cancels a provisional idle prompt when new input is submitted", async () => {
    vi.useFakeTimers();
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "first task\r");
    fakePty.emitData("完成\r\n› ");
    await vi.advanceTimersByTimeAsync(100);
    manager.sendInput(session.sessionId, "second task\r");
    await vi.advanceTimersByTimeAsync(250);

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("keeps an interactive confirmation prompt busy", async () => {
    vi.useFakeTimers();
    const activityReasons: string[] = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onActivityChange: (event) => activityReasons.push(event.reason),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    fakePty.emitData("Do you want to proceed? (y/n)\r\n› ");
    await vi.advanceTimersByTimeAsync(250);

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
    expect(activityReasons).toEqual(["submitted_input"]);
  });

  it("ignores prompt repaints and Working output as lifecycle transitions", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.sendInput(session.sessionId, "执行任务\r");
    fakePty.emitData("\r\n› 执行任务");
    fakePty.emitData(" • Working (0s • esc to interrupt)");

    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("marks provider busy output as a running turn without waiting for lifecycle metadata", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    fakePty.emitData("Working (0s • esc to interrupt)");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
    manager.reportTurnLifecycle(session.sessionId, "started");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("sends the configured prompt back into the PTY when a keyword is detected", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });

    fakePty.emitData("service is in high demand");

    expect(fakePty.writes).toEqual(["继续\r"]);
    expect(manager.getSnapshot(session.sessionId)?.autoContinue.matchCount).toBe(1);
  });

  it("waits for the sampled delay before writing auto continue input", async () => {
    vi.useFakeTimers();
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
        intervalMs: 2_000,
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });

    fakePty.emitData("service is in high demand");
    expect(fakePty.writes).toEqual([]);

    await vi.advanceTimersByTimeAsync(1_999);
    expect(fakePty.writes).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(fakePty.writes).toEqual(["继续\r"]);
  });

  it.each(["paused", "disabled"] as const)(
    "cancels a delayed auto continue when the session is %s",
    async (change) => {
      vi.useFakeTimers();
      const manager = new TerminalSessionManager({
        createPtyProcess: vi.fn(() => fakePty),
      });
      const session = await manager.createSession({
        provider: "claude",
        cwd: "C:/workspace/current-project",
        commandExecutable: "codex",
        commandArgs: [],
        env: {},
        autoContinue: {
          enabled: true,
          limit: -1,
          prompt: "继续",
          keywords: ["high demand"],
          intervalMs: 2_000,
        },
      });
      manager.attachSession(session.sessionId, {
        onOutput: vi.fn(),
        onStatus: vi.fn(),
      });
      fakePty.emitData("service is in high demand");

      manager.updateAutoContinueConfig(
        session.sessionId,
        change === "paused" ? { paused: true } : { enabled: false },
      );
      await vi.advanceTimersByTimeAsync(2_000);

      expect(fakePty.writes).toEqual([]);
      expect(manager.getSnapshot(session.sessionId)?.autoContinue.matchCount).toBe(1);
    },
  );

  it("cancels a delayed auto continue when the user types", async () => {
    vi.useFakeTimers();
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });
    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: [],
      env: {},
      autoContinue: {
        enabled: true,
        limit: -1,
        prompt: "继续",
        keywords: ["high demand"],
        intervalMs: 2_000,
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });
    fakePty.emitData("service is in high demand");

    manager.sendInput(session.sessionId, "手动处理\r");
    await vi.advanceTimersByTimeAsync(2_000);

    expect(fakePty.writes).toEqual(["手动处理\r"]);
  });

  it.each(["exit", "close"] as const)(
    "cancels a delayed auto continue when the session reaches %s",
    async (endState) => {
      vi.useFakeTimers();
      const manager = new TerminalSessionManager({
        createPtyProcess: vi.fn(() => fakePty),
      });
      const session = await manager.createSession({
        provider: "claude",
        cwd: "C:/workspace/current-project",
        commandExecutable: "codex",
        commandArgs: [],
        env: {},
        autoContinue: {
          enabled: true,
          limit: 1,
          prompt: "继续",
          keywords: ["high demand"],
          intervalMs: 2_000,
        },
      });
      manager.attachSession(session.sessionId, {
        onOutput: vi.fn(),
        onStatus: vi.fn(),
      });
      fakePty.emitData("service is in high demand");

      if (endState === "exit") {
        fakePty.emitExit({ exitCode: 0 });
      } else {
        await manager.closeSession(session.sessionId, "test");
      }
      await vi.advanceTimersByTimeAsync(2_000);

      expect(fakePty.writes).toEqual([]);
    },
  );

  it("emits diagnostics before queueing and flushing auto continue input", async () => {
    const events: string[] = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onAutoContinueEvent: (event) => {
        events.push(`${event.phase}:${event.visibleExcerpt ?? event.reason ?? ""}`);
      },
    });

    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });

    fakePty.emitData("We're currently experiencing high demand, which may cause temporary errors.");

    expect(events[0]).toContain("matched:We're currently experiencing high demand");
    expect(events.slice(1)).toEqual([
      "queued:",
      "flushed:",
    ]);
  });

  it("waits through reconnect progress and sends the next auto continue after a new final failure", async () => {
    const dateNow = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: -1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });

    fakePty.emitData("◦ Reconnecting... 1/5 (18s • esc to interrupt) └ We're currently experiencing high demand, which may cause temporary errors.");
    expect(fakePty.writes).toEqual([]);

    fakePty.emitData("■ We're currently experiencing high demand, which may cause temporary errors.");
    expect(fakePty.writes).toEqual(["继续\r"]);

    fakePty.emitData("■ We're currently experiencing high demand, which may cause temporary errors.\r\n› 继续");
    fakePty.emitData("\u001b[2KWorking (45s)");
    fakePty.emitData("◦ Reconnecting... 2/5 (12s • esc to interrupt) └ We're currently experiencing high demand, which may cause temporary errors.");

    expect(fakePty.writes).toEqual(["继续\r"]);

    dateNow.mockReturnValue(7_000);
    fakePty.emitData("■ We're currently experiencing high demand, which may cause temporary errors.");

    expect(fakePty.writes).toEqual(["继续\r", "继续\r"]);
    dateNow.mockRestore();
  });

  it("notifies renderer output before writing auto continue input", async () => {
    const events: string[] = [];
    fakePty.onWrite = (data) => events.push(`write:${data}`);
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: (chunk) => events.push(`output:${chunk}`),
      onStatus: vi.fn(),
    });

    fakePty.emitData("service is in high demand");

    expect(events).toEqual([
      "output:service is in high demand",
      "write:继续\r",
    ]);
  });

  it("waits for a renderer attachment before flushing auto continue input", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "claude",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });

    fakePty.emitData("service is in high demand");

    expect(fakePty.writes).toEqual([]);

    const received: string[] = [];
    manager.attachSession(session.sessionId, {
      onOutput: (chunk) => received.push(chunk),
      onStatus: vi.fn(),
    });

    expect(received).toEqual(["service is in high demand"]);
    expect(fakePty.writes).toEqual(["继续\r"]);
  });

  it("does not trigger auto continue from echoed user input", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
      },
    });
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: vi.fn(),
    });

    manager.sendInput(session.sessionId, "high demand\r");
    fakePty.emitData("> high demand\r\n");

    expect(fakePty.writes).toEqual(["high demand\r"]);
    expect(manager.getSnapshot(session.sessionId)?.autoContinue.matchCount).toBe(0);
  });

  it("ignores renderer input after the PTY exits", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    fakePty.emitExit({ exitCode: 0 });
    manager.sendInput(session.sessionId, "继续\r");

    expect(fakePty.writes).toEqual([]);
  });

  it("ignores renderer resize requests after the PTY exits", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    fakePty.emitExit({ exitCode: 0 });
    manager.resizeSession(session.sessionId, 120, 40);

    expect(fakePty.resizes).toEqual([]);
  });

  it("resizes and closes the underlying PTY", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    manager.resizeSession(session.sessionId, 120, 40);
    await manager.closeSession(session.sessionId, "window_closed");

    expect(fakePty.resizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(fakePty.kills).toBe(1);
    expect(manager.getSnapshot(session.sessionId)).toBeUndefined();
  });

  it("marks the session exited when the PTY exits naturally", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    fakePty.emitExit({ exitCode: 0 });

    expect(manager.getSnapshot(session.sessionId)).toMatchObject({
      status: "exited",
      exitCode: 0,
    });
  });

  it("updates the display title and notifies attached renderers", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: false,
        limit: 1,
        prompt: "继续",
        keywords: [],
      },
    });

    const displayTitles: Array<string | undefined> = [];
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: (snapshot) => displayTitles.push(snapshot.displayTitle),
    });

    manager.updateDisplayTitle(session.sessionId, "窗口标题来自会话");

    expect(manager.getSnapshot(session.sessionId)?.displayTitle).toBe("窗口标题来自会话");
    expect(displayTitles.at(-1)).toBe("窗口标题来自会话");
  });

  it("updates auto-continue settings for a running session and notifies attached renderers", async () => {
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
    });

    const session = await manager.createSession({
      provider: "codex",
      cwd: "C:/workspace/current-project",
      commandExecutable: "codex",
      commandArgs: ["--profile", "site-test"],
      env: {
        CODEX_HOME: "C:/codex-home",
      },
      autoContinue: {
        enabled: true,
        limit: 1,
        prompt: "继续",
        keywords: ["high demand"],
        intervalMs: 0,
      },
    });

    const snapshots: Array<ReturnType<TerminalSessionManager["getSnapshot"]>> = [];
    manager.attachSession(session.sessionId, {
      onOutput: vi.fn(),
      onStatus: (snapshot) => snapshots.push(snapshot),
    });

    fakePty.emitData("service is in high demand");
    manager.reportTurnLifecycle(session.sessionId, "failed", {
      code: "provider_error", message: "service is in high demand", retryable: true,
    });
    expect(fakePty.writes).toEqual(["继续\r"]);
    expect(manager.getSnapshot(session.sessionId)?.autoContinue.remaining).toBe(0);

    manager.updateAutoContinueConfig(session.sessionId, {
      limit: 3,
      paused: true,
      intervalMs: 2_000,
    });

    expect(manager.getSnapshot(session.sessionId)?.autoContinue).toMatchObject({
      limit: 3,
      matchCount: 1,
      remaining: 2,
      paused: true,
      intervalMs: 2_000,
    });
    expect(snapshots.at(-1)?.autoContinue).toMatchObject({
      limit: 3,
      paused: true,
      intervalMs: 2_000,
    });

    manager.sendInput(session.sessionId, "下一轮请求\r");
    fakePty.emitData("service is in high demand");
    expect(fakePty.writes).toEqual(["继续\r", "下一轮请求\r"]);
  });
});
