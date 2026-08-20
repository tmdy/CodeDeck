import type { LaunchMode } from "../profile/launch-mode.js";

export const CODEX_DESKTOP_HANDOFF_MARKER = "Opened this session in the Desktop app.";

export function validateCodexDesktopHandoffLaunch(
  launchMode: LaunchMode,
  sessionId?: string,
): string | undefined {
  const normalizedSessionId = sessionId?.trim() ?? "";
  if (launchMode === "new") {
    return undefined;
  }
  if (launchMode !== "resume_selected" || !normalizedSessionId) {
    throw new Error(
      "Desktop 交接仅支持“直接启动”或“恢复选中”。",
    );
  }
  return normalizedSessionId;
}

export function buildCodexAppServerArgs(
  commandArgs: string[],
  modelProvider?: string,
): string[] {
  const supportedArgs: string[] = [];
  for (let index = 0; index < commandArgs.length; index += 1) {
    const arg = commandArgs[index];
    if (["-c", "--config", "--enable", "--disable"].includes(arg)) {
      const value = commandArgs[index + 1];
      if (value !== undefined) {
        supportedArgs.push(arg, value);
        index += 1;
      }
    }
  }
  const normalizedProvider = modelProvider?.trim() ?? "";
  if (normalizedProvider) {
    supportedArgs.push("-c", `model_provider=${JSON.stringify(normalizedProvider)}`);
  }
  return [...supportedArgs, "app-server", "--stdio"];
}

export interface CodexDesktopThreadStartParams {
  cwd: string;
  serviceName: string;
  model?: string;
  modelProvider?: string;
}

export function buildCodexDesktopThreadStartParams(options: {
  cwd: string;
  model?: string;
  modelProvider?: string;
}): CodexDesktopThreadStartParams {
  const model = options.model?.trim() ?? "";
  const modelProvider = options.modelProvider?.trim() ?? "";
  return {
    cwd: options.cwd,
    serviceName: "codedeck_desktop_handoff",
    ...(model ? { model } : {}),
    ...(modelProvider ? { modelProvider } : {}),
  };
}

export function buildCodexDesktopThreadStartRequest(
  id: number,
  options: Parameters<typeof buildCodexDesktopThreadStartParams>[0],
): {
  method: "thread/start";
  id: number;
  params: CodexDesktopThreadStartParams;
} {
  return {
    method: "thread/start",
    id,
    params: buildCodexDesktopThreadStartParams(options),
  };
}

export function validateCodexDesktopThreadProvider(
  expectedProvider: string | undefined,
  actualProvider: string | undefined,
): void {
  const expected = expectedProvider?.trim() ?? "";
  const actual = actualProvider?.trim() ?? "";
  if (expected && actual !== expected) {
    throw new Error(
      `Desktop 交接失败：新会话 Provider 不匹配（expected ${expected}, got ${actual || "unknown"}）。`,
    );
  }
}

export function hasCodexDesktopHandoffMarker(output: string): boolean {
  return output.includes(CODEX_DESKTOP_HANDOFF_MARKER);
}

export function buildCodexDesktopNewThreadUrl(cwd: string): string {
  const url = new URL("codex://threads/new");
  url.searchParams.set("path", cwd);
  return url.toString();
}

export function buildCodexDesktopThreadUrl(sessionId: string): string {
  const normalizedSessionId = sessionId.trim();
  if (!normalizedSessionId) {
    throw new Error("Desktop 交接缺少 Codex session ID。");
  }
  return `codex://threads/${encodeURIComponent(normalizedSessionId)}`;
}
