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

  it("can start a turn from a provider lifecycle event", async () => {
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

    fakePty.emitData("Working");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("idle");
    manager.reportTurnLifecycle(session.sessionId, "started");
    expect(manager.getSnapshot(session.sessionId)?.activity).toBe("busy");
  });

  it("sends the configured prompt back into the PTY when a keyword is detected", async () => {
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

    fakePty.emitData("service is in high demand");

    expect(fakePty.writes).toEqual(["继续\r"]);
    expect(manager.getSnapshot(session.sessionId)?.autoContinue.matchCount).toBe(1);
  });

  it("emits diagnostics before queueing and flushing auto continue input", async () => {
    const events: string[] = [];
    const manager = new TerminalSessionManager({
      createPtyProcess: vi.fn(() => fakePty),
      onAutoContinueEvent: (event) => {
        events.push(`${event.phase}:${event.visibleExcerpt ?? event.reason ?? ""}`);
      },
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
      provider: "codex",
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
    expect(manager.getSnapshot(session.sessionId)?.status).toBe("closed");
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
