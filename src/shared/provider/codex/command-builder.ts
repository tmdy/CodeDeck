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
  wireApi?: string;
}

export function buildCodexArgs(options: CodexCommandOptions): string[] {
  normalizeCodexUrl(options.baseUrl);
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

  parts.push(...parseCliArgs(options.extraArgs));

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
