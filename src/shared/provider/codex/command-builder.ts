// Codex CLI 命令构建器 — 翻译自 Go internal/provider/codex/command_builder.go

import { normalizeCodexUrl } from "./url-normalizer.js";
import { formatPreviewToken, parseCliArgs } from "../cli-args.js";

export interface CodexCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  baseUrl: string;
  model?: string;
  modelOverride?: string;
  modelProviderOverride?: string;
  wireApi?: string;
  trustedProjectPath?: string;
  disableHooks?: boolean;
}

function buildTrustedProjectOverride(projectPath: string): string {
  const isWindowsPath = /^[A-Za-z]:[\\/]/.test(projectPath) || /^[\\/]{2}/.test(projectPath);
  const trustedProjectPath = isWindowsPath ? projectPath.replace(/\//g, "\\") : projectPath;
  return `projects.${trustedProjectPath}.trust_level=trusted`;
}

export function buildCodexArgs(options: CodexCommandOptions): string[] {
  if (options.baseUrl.trim()) {
    normalizeCodexUrl(options.baseUrl);
  }
  const parts: string[] = [];

  switch (options.launchMode.trim()) {
    case "continue_last":
      parts.push("resume", "--last");
      break;
    case "resume_picker":
      parts.push("resume");
      break;
    case "resume_picker_all":
      parts.push("resume", "--all");
      break;
    case "resume_selected": {
      parts.push("resume");
      const sessionId = (options.sessionId ?? "").trim();
      if (sessionId) {
        parts.push(sessionId);
      }
      break;
    }
  }

  const model = options.modelOverride?.trim() ?? "";
  if (model) {
    parts.push("--model", model);
  }
  parts.push(...parseCliArgs(options.extraArgs));
  const modelProvider = options.modelProviderOverride?.trim() ?? "";
  if (modelProvider) {
    parts.push("-c", `model_provider=${JSON.stringify(modelProvider)}`);
  }
  if (options.trustedProjectPath) {
    parts.push("-c", buildTrustedProjectOverride(options.trustedProjectPath));
  }
  if (options.disableHooks === true) {
    parts.push("--disable", "hooks");
  }

  return parts;
}

export function buildCodexCommand(options: CodexCommandOptions): string {
  const commandBase = options.commandBase.trim() || "codex";
  const args = buildCodexArgs(options);
  const parts: string[] = [formatPreviewToken(commandBase)];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    const previous = index > 0 ? args[index - 1] : "";
    const forceQuote = previous === "resume" && options.launchMode.trim() === "resume_selected";
    parts.push(formatPreviewToken(value, forceQuote));
  }

  return parts.join(" ");
}
