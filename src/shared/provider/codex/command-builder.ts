// Codex CLI 命令构建器 — 翻译自 Go internal/provider/codex/command_builder.go

import { normalizeCodexUrl } from "./url-normalizer.js";

const TEMP_PROVIDER_ID = "launcher_temp";
const TEMP_ENV_KEY = "CODEX_PROFILE_LAUNCHER_API_KEY";
const DEFAULT_MODEL = "gpt-5.4";

export interface CodexCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  baseUrl: string;
  model?: string;
}

function formatOverride(key: string, value: string): string {
  const serialized = JSON.stringify(value);
  return `'${key}=${serialized}'`;
}

function buildConfigArgs(baseUrl: string): string[] {
  const pairs: [string, string][] = [
    ["model_provider", TEMP_PROVIDER_ID],
    [`model_providers.${TEMP_PROVIDER_ID}.name`, "Launcher Temporary"],
    [`model_providers.${TEMP_PROVIDER_ID}.base_url`, baseUrl],
    [`model_providers.${TEMP_PROVIDER_ID}.wire_api`, "responses"],
    [`model_providers.${TEMP_PROVIDER_ID}.env_key`, TEMP_ENV_KEY],
  ];

  return pairs.flatMap(([k, v]) => ["-c", formatOverride(k, v)]);
}

export function buildCodexCommand(options: CodexCommandOptions): string {
  const commandBase = options.commandBase.trim() || "codex";
  const baseUrl = normalizeCodexUrl(options.baseUrl);
  const model = options.model?.trim() || DEFAULT_MODEL;

  const parts: string[] = [commandBase];
  parts.push(...buildConfigArgs(baseUrl));

  if (model) {
    parts.push("-m", model);
  }

  switch (options.launchMode.trim()) {
    case "continue":
      parts.push("resume", "--last");
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

  const extraArgs = options.extraArgs.trim();
  if (extraArgs) {
    parts.push(extraArgs);
  }

  return parts.join(" ");
}