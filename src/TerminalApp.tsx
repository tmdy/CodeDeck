import { useEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSessionSnapshot } from "./shared/electron/terminal-session-manager.js";
import {
  shouldHandleTerminalTextPasteData,
  shouldCopyTerminalSelection,
  shouldReadTerminalClipboardFromShortcut,
  toTerminalPasteInput,
} from "./shared/electron/terminal-input.js";

function readSessionId(): string {
  return new URLSearchParams(window.location.search).get("sessionId")?.trim() ?? "";
}

function describeStatus(snapshot: TerminalSessionSnapshot | null): string {
  if (!snapshot) {
    return "正在连接终端...";
  }
  if (snapshot.status === "exited") {
    return `进程已退出（exit code ${snapshot.exitCode ?? 0}）`;
  }
  if (snapshot.status === "closed") {
    return "终端会话已关闭";
  }
  const autoContinue = snapshot.autoContinue.enabled
    ? snapshot.autoContinue.remaining === -1
      ? `自动继续已启用，已触发 ${snapshot.autoContinue.matchCount} 次`
      : `自动继续已启用，已触发 ${snapshot.autoContinue.matchCount} 次，剩余 ${snapshot.autoContinue.remaining} 次`
    : "自动继续关闭";
  return `${snapshot.commandExecutable} 运行中，PID ${snapshot.pid}；${autoContinue}`;
}

export default function TerminalApp() {
  const sessionId = useMemo(readSessionId, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [status, setStatus] = useState("正在连接终端...");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setError("缺少终端会话 ID。");
      return;
    }
    if (!window.terminalManager || !containerRef.current) {
      setError("当前环境未注入终端 API。");
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "Cascadia Mono, Consolas, 'Courier New', monospace",
      fontSize: 14,
      lineHeight: 1.3,
      theme: {
        background: "#10161f",
        foreground: "#dce6f2",
        cursor: "#f4b860",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const terminalContainer = containerRef.current;

    const sendInput = (data: string) => {
      if (!data) {
        return;
      }
      void window.terminalManager?.sendInput(sessionId, data);
    };

    const pasteText = (text: string) => {
      const normalized = toTerminalPasteInput(text);
      if (normalized) {
        sendInput(normalized);
      }
    };

    const pasteClipboardText = async () => {
      const text = await window.terminalManager?.readClipboardText().catch(() => "");
      pasteText(text ?? "");
    };

    const copySelection = async () => {
      const selectedText = terminal.getSelection();
      if (!selectedText) {
        return;
      }
      await window.terminalManager?.writeClipboardText(selectedText);
      terminal.clearSelection();
    };

    terminal.attachCustomKeyEventHandler((event) => {
      if (shouldCopyTerminalSelection(event, terminal.hasSelection())) {
        void copySelection();
        return false;
      }
      if (event.type !== "keydown") {
        return true;
      }
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "v") {
        return false;
      }
      if (shouldReadTerminalClipboardFromShortcut(event)) {
        void pasteClipboardText();
        return false;
      }
      return true;
    });

    const sendResize = () => {
      fitAddon.fit();
      void window.terminalManager?.resizeSession(sessionId, terminal.cols, terminal.rows);
    };

    const unsubscribeOutput = window.terminalManager.onOutput((incomingSessionId, chunk) => {
      if (incomingSessionId !== sessionId) {
        return;
      }
      terminal.write(chunk);
    });
    const unsubscribeStatus = window.terminalManager.onStatus((snapshot) => {
      if (snapshot.sessionId !== sessionId) {
        return;
      }
      setStatus(describeStatus(snapshot));
    });
    const disposeInput = terminal.onData((data) => {
      if (shouldHandleTerminalTextPasteData(data)) {
        void pasteClipboardText();
        return;
      }
      sendInput(data);
    });
    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      pasteText(event.clipboardData?.getData("text/plain") ?? "");
    };
    terminalContainer.addEventListener("paste", handlePaste, true);
    window.addEventListener("resize", sendResize);

    void window.terminalManager.attachSession(sessionId)
      .then((snapshot) => {
        setStatus(describeStatus(snapshot));
        sendResize();
      })
      .catch((attachError) => {
        setError(attachError instanceof Error ? attachError.message : "终端连接失败");
      });

    return () => {
      unsubscribeOutput();
      unsubscribeStatus();
      disposeInput.dispose();
      terminalContainer.removeEventListener("paste", handlePaste, true);
      window.removeEventListener("resize", sendResize);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div>
          <h1>Codex 终端</h1>
          <p className="terminal-status">{status}</p>
        </div>
        {error && <p className="terminal-error">{error}</p>}
      </header>
      <div ref={containerRef} className="terminal-stage" />
    </div>
  );
}
