import { describe, expect, it, vi } from "vitest";
import { TerminalSessionManager, type PtyProcess, type PtyProcessExitEvent, type TerminalSessionSnapshot } from "../../electron/terminal-session-manager.js";

class ResourcePty implements PtyProcess {
  pid = 123;
  write = vi.fn();
  resize = vi.fn();
  dataListeners = new Set<(data: string) => void>();
  exitListeners = new Set<(event: PtyProcessExitEvent) => void>();
  kill = vi.fn(() => this.emitExit());
  onData(callback: (data: string) => void) { this.dataListeners.add(callback); return () => { this.dataListeners.delete(callback); }; }
  onExit(callback: (event: PtyProcessExitEvent) => void) { this.exitListeners.add(callback); return () => { this.exitListeners.delete(callback); }; }
  emit(data: string) { for (const callback of this.dataListeners) callback(data); }
  emitExit() { for (const callback of this.exitListeners) callback({ exitCode: 0 }); }
}

async function setup() {
  const pty = new ResourcePty();
  const manager = new TerminalSessionManager({ createPtyProcess: () => pty });
  const snapshot = await manager.createSession({
    provider: "codex", cwd: "C:/test", commandExecutable: "fixture", commandArgs: [], env: {},
    autoContinue: { enabled: false, limit: 2, prompt: "继续", keywords: [] },
  });
  return { pty, manager, id: snapshot.sessionId };
}

describe("terminal resource lifecycle", () => {
  it("keeps ownership when killing the PTY fails so closing can be retried", async () => {
    const { pty, manager, id } = await setup();
    pty.kill.mockImplementationOnce(() => { throw new Error("kill failed"); });
    await expect(manager.closeSession(id)).rejects.toThrow("kill failed");
    expect(manager.getSnapshot(id)?.status).toBe("running");
    expect(pty.dataListeners.size + pty.exitListeners.size).toBe(2);
    await manager.closeSession(id);
    expect(manager.getSnapshot(id)).toBeUndefined();
    expect(pty.dataListeners.size + pty.exitListeners.size).toBe(0);
  });

  it("drains final output after resize discovers process exit, then releases listeners", async () => {
    const { pty, manager, id } = await setup();
    const output = vi.fn();
    manager.attachSession(id, { onOutput: output, onStatus() {} });
    pty.resize.mockImplementationOnce(() => { throw new Error("PTY already exited"); });
    manager.resizeSession(id, 120, 40);
    pty.emit("最后的中文🙂\r\n");
    expect(output).toHaveBeenCalledWith("最后的中文🙂\r\n");
    pty.emitExit();
    expect(manager.getSnapshot(id)).toMatchObject({ status: "exited", exitCode: 0, output: "最后的中文🙂\r\n" });
    expect(pty.dataListeners.size + pty.exitListeners.size).toBe(0);
    await manager.closeSession(id);
  });

  it("releases a closed session despite synchronous PTY exit and late callbacks", async () => {
    const { pty, manager, id } = await setup();
    const lateData = [...pty.dataListeners][0];
    const lateExit = [...pty.exitListeners][0];
    const output = vi.fn();
    const statuses: string[] = [];
    const detach = manager.attachSession(id, { onOutput: output, onStatus: (snapshot) => statuses.push(snapshot.status) });
    pty.emit("保留到关闭的输出");
    await manager.closeSession(id);
    expect(statuses.at(-1)).toBe("closed");
    expect(statuses).not.toContain("exited");
    expect(manager.getSnapshot(id)).toBeUndefined();
    expect(pty.dataListeners.size + pty.exitListeners.size).toBe(0);
    const before = output.mock.calls.length;
    lateData("迟到输出");
    lateExit({ exitCode: 1 });
    expect(output).toHaveBeenCalledTimes(before);
    await manager.closeSession(id);
    detach();
    expect(pty.kill).toHaveBeenCalledTimes(1);
  });

  it("keeps exited history available while releasing PTY subscriptions", async () => {
    const { pty, manager, id } = await setup();
    pty.emit("\x1b[32m中文🙂\x1b[0m\r\n");
    pty.emitExit();
    expect(manager.getSnapshot(id)).toMatchObject({ status: "exited", output: "\x1b[32m中文🙂\x1b[0m\r\n" });
    expect(pty.dataListeners.size + pty.exitListeners.size).toBe(0);
    const replay = vi.fn();
    manager.attachSession(id, { onOutput: replay, onStatus() {} });
    expect(replay).toHaveBeenCalledWith("\x1b[32m中文🙂\x1b[0m\r\n");
    await manager.closeSession(id);
    // node-pty still owns a ConPTY output worker after its process exit event.
    expect(pty.kill).toHaveBeenCalledTimes(1);
  });

  it("streams unchanged raw chunks without redundant status snapshots", async () => {
    const { pty, manager, id } = await setup();
    const chunks = ["\x1b[", "32m中文\ud83d", "\ude42\x1b[0m\r", "\n", ...Array.from({ length: 30 }, (_, i) => `${i}\r\n`)];
    const output: string[] = [];
    const statuses: TerminalSessionSnapshot[] = [];
    const detach = manager.attachSession(id, { onOutput: (chunk) => output.push(chunk), onStatus: (snapshot) => statuses.push(snapshot) });
    for (const chunk of chunks) pty.emit(chunk);
    expect(output).toEqual(chunks);
    expect(statuses).toHaveLength(1);
    expect(manager.getSnapshot(id)?.output).toBe(chunks.join(""));
    manager.reportTurnLifecycle(id, "started");
    expect(statuses.at(-1)?.activity).toBe("busy");
    manager.reportTurnLifecycle(id, "completed");
    expect(statuses.at(-1)?.activity).toBe("idle");
    manager.updateDisplayTitle(id, "新标题");
    expect(statuses.at(-1)?.displayTitle).toBe("新标题");
    manager.updateAutoContinueConfig(id, { enabled: true, limit: 3, keywords: ["retry"] });
    expect(statuses.at(-1)?.autoContinue).toMatchObject({ enabled: true, limit: 3, keywords: ["retry"] });
    const count = statuses.length;
    manager.updateDisplayTitle(id, "新标题");
    manager.updateAutoContinueConfig(id, { enabled: true });
    expect(statuses).toHaveLength(count);
    detach();
    await manager.closeSession(id);
  });

  it("preserves the bounded reattach suffix and does not mutate previous snapshots", async () => {
    const { pty, manager, id } = await setup();
    const first = "a".repeat(40_000);
    const second = "中".repeat(40_000);
    pty.emit(first);
    const previous = manager.getSnapshot(id);
    pty.emit(second);
    expect(previous?.output).toBe(first);
    expect(manager.getSnapshot(id)?.output).toBe((first + second).slice(-64_000));
    const replay = vi.fn();
    const detach = manager.attachSession(id, { onOutput: replay, onStatus() {} });
    expect(replay).toHaveBeenCalledWith((first + second).slice(-64_000));
    detach();
    await manager.closeSession(id);
  });
});
