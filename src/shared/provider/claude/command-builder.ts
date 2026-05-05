// Claude CLI 命令构建器 — 翻译自 Go internal/provider/claude/command_builder.go

import { formatPreviewToken, parseCliArgs } from "../cli-args.js";

const SETTING_SOURCES_VALUE = "project,local";

export interface ClaudeCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  excludeUserSettings: boolean;
  settingsFile?: string;
  settingSources?: string;
  model?: string;
}

function normalizeSessionId(value: string): string {
  const trimmed = value.trim();
  return trimmed;
}

export function buildClaudeArgs(options: ClaudeCommandOptions): string[] {
  const parts: string[] = [];
  const settingsFile = (options.settingsFile ?? "").trim();
  if (options.excludeUserSettings) {
    parts.push("--setting-sources", (options.settingSources ?? SETTING_SOURCES_VALUE).trim() || SETTING_SOURCES_VALUE);
  }
  if (settingsFile) {
    parts.push("--settings", settingsFile);
  }

  switch (options.launchMode.trim()) {
    case "continue_last":
      parts.push("--continue");
      break;
    case "resume_picker":
    case "resume_picker_all":
      parts.push("--resume");
      break;
    case "resume_selected": {
      parts.push("--resume");
      const sessionId = normalizeSessionId(options.sessionId ?? "");
      if (sessionId) {
        parts.push(sessionId);
      }
      break;
    }
  }

  const model = options.model?.trim() ?? "";
  if (model) {
    parts.push("--model", model);
  }

  parts.push(...parseCliArgs(options.extraArgs));

  return parts;
}

export function buildClaudeCommand(options: ClaudeCommandOptions): string {
  const commandBase = options.commandBase.trim() || "claude";
  const args = buildClaudeArgs(options);
  const parts: string[] = [formatPreviewToken(commandBase)];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const previous = index > 0 ? args[index - 1] : "";
    const forceQuote = previous === "--resume" || previous === "--settings" || previous === "--setting-sources";
    parts.push(formatPreviewToken(value, forceQuote));
  }

  return parts.join(" ");
}
