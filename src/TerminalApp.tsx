import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import type { TerminalSessionSnapshot } from "./shared/electron/terminal-session-manager.js";
import type { TerminalAutoContinueConfigPatch } from "./shared/electron/terminal-auto-continue.js";
import {
  shouldHandleTerminalTextPasteData,
  shouldCopyTerminalSelection,
  shouldReadTerminalClipboardFromShortcut,
  toTerminalPasteInput,
} from "./shared/electron/terminal-input.js";
import { buildTerminalHeaderTitle } from "./shared/electron/terminal-session-title.js";

function readSessionId(): string {
  return new URLSearchParams(window.location.search).get("sessionId")?.trim() ?? "";
}

function formatIntervalSeconds(intervalMs: number): string {
  const seconds = Math.max(0, intervalMs) / 1000;
  return Number.isInteger(seconds)
    ? String(seconds)
    : String(Number(seconds.toFixed(3)));
}

function parseAutoContinueLimit(value: string): number {
  const parsed = Math.floor(Number(value) || 1);
  return parsed === -1 ? -1 : Math.max(1, parsed);
}

function parseIntervalMs(value: string): number {
  return Math.max(0, Math.round((Number(value) || 0) * 1000));
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
  const intervalSuffix = snapshot.autoContinue.intervalMs > 0
    ? `，间隔 ${formatIntervalSeconds(snapshot.autoContinue.intervalMs)} 秒`
    : "";
  const autoContinue = snapshot.autoContinue.enabled
    ? snapshot.autoContinue.remaining === -1
      ? `自动继续${snapshot.autoContinue.paused ? "已暂停" : "已启用"}，已触发 ${snapshot.autoContinue.matchCount} 次${intervalSuffix}`
      : `自动继续${snapshot.autoContinue.paused ? "已暂停" : "已启用"}，已触发 ${snapshot.autoContinue.matchCount} 次，剩余 ${snapshot.autoContinue.remaining} 次${intervalSuffix}`
    : "自动继续关闭";
  const activity = snapshot.activity === "busy" ? "任务运行中" : "等待输入";
  return `${snapshot.commandExecutable} 运行中，PID ${snapshot.pid}；${activity}；${autoContinue}`;
}

export default function TerminalApp() {
  const sessionId = useMemo(readSessionId, []);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [snapshot, setSnapshot] = useState<TerminalSessionSnapshot | null>(null);
  const [status, setStatus] = useState("正在连接终端...");
  const [error, setError] = useState<string | null>(null);
  const [controlError, setControlError] = useState<string | null>(null);
  const [draftSessionId, setDraftSessionId] = useState("");
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftLimit, setDraftLimit] = useState("1");
  const [draftIntervalSeconds, setDraftIntervalSeconds] = useState("0");

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
      setSnapshot(snapshot);
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
        setSnapshot(snapshot);
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

  useEffect(() => {
    if (!snapshot) {
      return;
    }
    if (draftSessionId === snapshot.sessionId && draftDirty) {
      return;
    }
    setDraftSessionId(snapshot.sessionId);
    setDraftLimit(String(snapshot.autoContinue.limit));
    setDraftIntervalSeconds(formatIntervalSeconds(snapshot.autoContinue.intervalMs));
    setDraftDirty(false);
  }, [snapshot, draftDirty, draftSessionId]);

  const updateAutoContinueConfig = async (patch: TerminalAutoContinueConfigPatch) => {
    if (!snapshot || snapshot.status !== "running") {
      return;
    }
    try {
      setControlError(null);
      await window.terminalManager?.updateAutoContinueConfig(sessionId, patch);
    } catch (updateError) {
      setControlError(updateError instanceof Error ? updateError.message : "更新监控设置失败");
    }
  };

  const applyAutoContinueSettings = async () => {
    await updateAutoContinueConfig({
      limit: parseAutoContinueLimit(draftLimit),
      intervalMs: parseIntervalMs(draftIntervalSeconds),
    });
    setDraftDirty(false);
  };

  const toggleAutoContinuePaused = async () => {
    if (!snapshot) {
      return;
    }
    await updateAutoContinueConfig({
      paused: !snapshot.autoContinue.paused,
    });
  };

  const headerTitle = snapshot
    ? buildTerminalHeaderTitle(snapshot.provider, snapshot.displayTitle)
    : "受监控终端";
  const controlsDisabled = !snapshot || snapshot.status !== "running";
  const pauseDisabled = controlsDisabled || !snapshot.autoContinue.enabled;

  useLayoutEffect(() => {
    if (!sessionId || !snapshot || snapshot.status !== "running") {
      return;
    }
    const animationFrame = window.requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const fitAddon = fitAddonRef.current;
      if (!terminal || !fitAddon) {
        return;
      }
      fitAddon.fit();
      void window.terminalManager?.resizeSession(sessionId, terminal.cols, terminal.rows);
    });
    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, [sessionId, snapshot, headerTitle, status, controlError, error]);

  return (
    <div className="terminal-shell">
      <header className="terminal-header">
        <div className="terminal-header-main">
          <h1>{headerTitle}</h1>
          <p className="terminal-status">{status}</p>
          {controlError && <p className="terminal-error">{controlError}</p>}
        </div>
        <form
          className="terminal-controls"
          onSubmit={(event) => {
            event.preventDefault();
            void applyAutoContinueSettings();
          }}
        >
          <button
            type="button"
            className="secondary-button"
            onClick={() => void toggleAutoContinuePaused()}
            disabled={pauseDisabled}
          >
            {snapshot?.autoContinue.paused ? "恢复" : "暂停"}
          </button>
          <label className="terminal-control-field">
            <span>次数</span>
            <input
              type="number"
              min={-1}
              value={draftLimit}
              onChange={(event) => {
                setDraftLimit(event.target.value);
                setDraftDirty(true);
              }}
              disabled={controlsDisabled}
            />
          </label>
          <label className="terminal-control-field">
            <span>间隔(s)</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={draftIntervalSeconds}
              onChange={(event) => {
                setDraftIntervalSeconds(event.target.value);
                setDraftDirty(true);
              }}
              disabled={controlsDisabled}
            />
          </label>
          <button
            type="submit"
            className="primary-button"
            disabled={controlsDisabled}
          >
            应用
          </button>
        </form>
        {error && <p className="terminal-error">{error}</p>}
      </header>
      <div ref={containerRef} className="terminal-stage" />
    </div>
  );
}
