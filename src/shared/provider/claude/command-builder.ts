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
  settingsFiles?: string[];
  settingSources?: string;
  model?: string;
  permissionMode?: string;
  addDirs?: string[];
  pluginDirs?: string[];
  mcpConfigPaths?: string[];
}

function normalizeSessionId(value: string): string {
  const trimmed = value.trim();
  return trimmed;
}

export function buildClaudeArgs(options: ClaudeCommandOptions): string[] {
  const parts: string[] = [];
  const settingsFiles = [
    options.settingsFile,
    ...(options.settingsFiles ?? []),
  ]
    .map((value) => value?.trim() ?? "")
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
  if (options.excludeUserSettings) {
    parts.push("--setting-sources", (options.settingSources ?? SETTING_SOURCES_VALUE).trim() || SETTING_SOURCES_VALUE);
  }
  for (const settingsFile of settingsFiles) {
    parts.push("--settings", settingsFile);
  }

  for (const addDir of normalizeStringList(options.addDirs)) {
    parts.push("--add-dir", addDir);
  }
  for (const pluginDir of normalizeStringList(options.pluginDirs)) {
    parts.push("--plugin-dir", pluginDir);
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

  const permissionMode = options.permissionMode?.trim() ?? "";
  if (permissionMode) {
    parts.push("--permission-mode", permissionMode);
  }

  parts.push(...parseCliArgs(options.extraArgs));

  const mcpConfigPaths = normalizeStringList(options.mcpConfigPaths);
  if (mcpConfigPaths.length > 0) {
    parts.push("--mcp-config", ...mcpConfigPaths);
  }

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

function normalizeStringList(values?: string[]): string[] {
  return (values ?? [])
    .map((value) => value.trim())
    .filter((value, index, all) => value.length > 0 && all.indexOf(value) === index);
}
