import { beforeEach, describe, expect, it, vi } from "vitest";
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

    fakePty.emitData("■ We're currently experiencing high demand, which may cause temporary errors.");

    expect(fakePty.writes).toEqual(["继续\r", "继续\r"]);
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
});
