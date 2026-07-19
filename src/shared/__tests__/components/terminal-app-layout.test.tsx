// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TerminalSessionSnapshot } from "../../electron/terminal-session-manager.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fitMock = vi.fn();
const openMock = vi.fn();
const loadAddonMock = vi.fn();
const writeMock = vi.fn();
const disposeMock = vi.fn();
const onDataDisposeMock = vi.fn();

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: fitMock,
  })),
}));

vi.mock("@xterm/xterm", () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    cols: 120,
    rows: 36,
    loadAddon: loadAddonMock,
    open: openMock,
    write: writeMock,
    dispose: disposeMock,
    onData: vi.fn(() => ({ dispose: onDataDisposeMock })),
    attachCustomKeyEventHandler: vi.fn(),
    getSelection: vi.fn(() => ""),
    hasSelection: vi.fn(() => false),
    clearSelection: vi.fn(),
  })),
}));

function cssRule(selector: string): string {
  const css = readFileSync(join(process.cwd(), "src", "styles.css"), "utf8");
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{(?<body>[^}]*)\\}`));
  return match?.groups?.body ?? "";
}

function createSnapshot(overrides: Partial<TerminalSessionSnapshot> = {}): TerminalSessionSnapshot {
  return {
    sessionId: "session-1",
    provider: "codex",
    cwd: "C:\\work",
    pid: 1234,
    commandExecutable: "codex",
    commandArgs: [],
    status: "running",
    activity: "idle",
    output: "",
    displayTitle: "https://github.com/TencentCloud/TencentDB-Agent-Memory 请你帮我研究一下这个是怎么使用的？我的 hermes 能",
    autoContinue: {
      enabled: true,
      limit: -1,
      matchCount: 0,
      remaining: -1,
      lastMatchedKeyword: null,
      paused: false,
      intervalMs: 0,
    },
    ...overrides,
  };
}

describe("TerminalApp layout", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete window.terminalManager;
    window.history.replaceState(null, "", "/");
  });

  it("keeps the monitored terminal header compact and bounds the terminal pane", () => {
    expect(cssRule(".terminal-shell")).toContain("height: 100vh");
    expect(cssRule(".terminal-shell")).toContain("min-height: 0");
    expect(cssRule(".terminal-shell")).toContain("grid-template-rows: auto minmax(0, 1fr)");
    expect(cssRule(".terminal-shell")).toContain("overflow: hidden");

    expect(cssRule(".terminal-header h1")).toContain("overflow: hidden");
    expect(cssRule(".terminal-header h1")).toContain("text-overflow: ellipsis");
    expect(cssRule(".terminal-header h1")).toContain("white-space: nowrap");

    expect(cssRule(".terminal-controls")).toContain("min-width: 0");
    expect(cssRule(".terminal-stage")).toContain("overflow: hidden");
  });

  it("refits the terminal after the resolved title changes header height", async () => {
    window.history.replaceState(null, "", "/?sessionId=session-1");

    const resizeSession = vi.fn().mockResolvedValue(undefined);
    window.terminalManager = {
      attachSession: vi.fn().mockResolvedValue(createSnapshot()),
      sendInput: vi.fn().mockResolvedValue(undefined),
      resizeSession,
      updateAutoContinueConfig: vi.fn().mockResolvedValue(undefined),
      closeSession: vi.fn().mockResolvedValue(undefined),
      readClipboardText: vi.fn().mockResolvedValue(""),
      writeClipboardText: vi.fn().mockResolvedValue(undefined),
      onOutput: vi.fn(() => vi.fn()),
      onStatus: vi.fn(() => vi.fn()),
    };
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    const { default: TerminalApp } = await import("../../../TerminalApp.js");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<TerminalApp />);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(fitMock.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(resizeSession.mock.calls.length).toBeGreaterThanOrEqual(2);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
