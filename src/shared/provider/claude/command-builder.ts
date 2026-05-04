// Claude CLI 命令构建器 — 翻译自 Go internal/provider/claude/command_builder.go

const SETTING_SOURCES_VALUE = "'project,local'";

export interface ClaudeCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  excludeUserSettings: boolean;
  settingsFile?: string;
}

function quoteIfNeeded(value: string): string {
  if (value.includes(" ")) {
    return `"${value}"`;
  }
  return value;
}

export function buildClaudeCommand(options: ClaudeCommandOptions): string {
  const commandBase = options.commandBase.trim() || "claude";
  const parts: string[] = [commandBase];

  const settingsFile = (options.settingsFile ?? "").trim();
  if (settingsFile) {
    parts.push("--settings", quoteIfNeeded(settingsFile));
  } else if (options.excludeUserSettings) {
    parts.push("--setting-sources", SETTING_SOURCES_VALUE);
  }

  switch (options.launchMode.trim()) {
    case "continue":
      parts.push("--continue");
      break;
    case "resume_selected": {
      parts.push("--resume");
      const sessionId = (options.sessionId ?? "").trim();
      if (sessionId) {
        parts.push(sessionId);
      }
      break;
    }
  }

  const extraArgs = options.extraArgs.trim();
  if (extraArgs) {
    parts.push(extraArgs);
  }

  return parts.join(" ");
}