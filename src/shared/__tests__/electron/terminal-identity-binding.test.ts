import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { buildTerminalWindowTitle, normalizeTerminalDisplayTitle } from "../../electron/terminal-session-title.js";

// Execute the actual main-process handlers without starting Electron or a PTY.
async function bindingFixture() {
  const source = await fs.readFile(path.join(process.cwd(), "electron/main.ts"), "utf8");
  const file = ts.createSourceFile("main.ts", source, ts.ScriptTarget.Latest, true);
  const handlers = file.statements.filter((node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && ["handleTerminalIdentityHint", "applyTerminalDisplayTitle"].includes(node.name?.text ?? ""));
  expect(handlers).toHaveLength(2);
  const compiled = ts.transpileModule(handlers.map((node) => node.getText(file)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const oldId = "01234567-89ab-cdef-0123-456789abcdef";
  const binding = { home: "C:/test", hint: oldId.slice(0, 29), providerSessionId: oldId, generation: 0 };
  const manager = { resetProviderSession: vi.fn(), updateDisplayTitle: vi.fn() };
  const window = { isDestroyed: () => false, setTitle: vi.fn() };
  const stopWatcher = vi.fn();
  const dependencies = {
    pendingTerminalIdentityHints: new Map(), codexTerminalBindings: new Map([["terminal", binding]]),
    terminalSessionManager: manager, terminalWindows: new Map([["terminal", window]]),
    stopTerminalLifecycleWatcher: stopWatcher, normalizeTerminalDisplayTitle, buildTerminalWindowTitle,
    CodexTerminalIdentityResolver: class {},
  };
  const handle = new Function(...Object.keys(dependencies), `${compiled}\nreturn handleTerminalIdentityHint;`)(...Object.values(dependencies));
  return { handle, oldId, manager, window, stopWatcher };
}

describe("main-process terminal identity binding", () => {
  it("clears the old thread title immediately on switch before a new name exists", async () => {
    const { handle, manager, window, stopWatcher } = await bindingFixture();
    handle("terminal", "aaaaaaaa-89ab-cdef-0123-45678");
    expect(stopWatcher).toHaveBeenCalledWith("terminal");
    expect(manager.resetProviderSession).toHaveBeenCalledWith("terminal");
    expect(manager.updateDisplayTitle).toHaveBeenCalledWith("terminal", undefined);
    expect(window.setTitle).toHaveBeenCalledWith("Codex 终端");
  });

  it("retains the current thread title for repeated or full UUID hints", async () => {
    const { handle, oldId, manager, window } = await bindingFixture();
    handle("terminal", oldId.slice(0, 29));
    handle("terminal", oldId);
    expect(manager.resetProviderSession).not.toHaveBeenCalled();
    expect(manager.updateDisplayTitle).not.toHaveBeenCalled();
    expect(window.setTitle).not.toHaveBeenCalled();
  });
});
