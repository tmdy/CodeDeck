// Provider 注册表 — 用于管理和查找 provider 适配器

import { getProviderMetadata, type ProviderMetadata } from "./types.js";
import { normalizeProvider, type ProviderID } from "../profile/types.js";
import type { Profile } from "../profile/types.js";
import { buildClaudeCommand } from "./claude/command-builder.js";
import { buildCodexCommand } from "./codex/command-builder.js";
import { normalizeCodexUrl, buildCodexBrowserUrl } from "./codex/url-normalizer.js";

export interface ProviderAdapter {
  metadata: ProviderMetadata;
  /** 构建 CLI 命令 */
  buildCommand(opts: ProviderCommandOptions): string;
  /** 规范化 Profile（provider-specific） */
  normalizeProfile(profile: Profile): Profile;
  /** 获取浏览器 URL */
  getBrowserUrl?(url: string): string;
}

export interface ProviderCommandOptions {
  commandBase: string;
  launchMode: string;
  extraArgs: string;
  sessionId?: string;
  excludeUserSettings?: boolean;
  settingsFile?: string;
  baseUrl?: string;
  model?: string;
  settingSources?: string;
  wireApi?: string;
}

function createClaudeAdapter(): ProviderAdapter {
  return {
    metadata: getProviderMetadata("claude"),
    buildCommand(opts: ProviderCommandOptions): string {
      return buildClaudeCommand({
        commandBase: opts.commandBase,
        launchMode: opts.launchMode,
        extraArgs: opts.extraArgs,
        sessionId: opts.sessionId,
        excludeUserSettings: opts.excludeUserSettings ?? false,
        settingsFile: opts.settingsFile,
        settingSources: opts.settingSources,
        model: opts.model,
      });
    },
    normalizeProfile(profile: Profile): Profile {
      return { ...profile, provider: "claude" };
    },
    getBrowserUrl(url: string): string {
      return url;
    },
  };
}

function createCodexAdapter(): ProviderAdapter {
  return {
    metadata: getProviderMetadata("codex"),
    buildCommand(opts: ProviderCommandOptions): string {
      return buildCodexCommand({
        commandBase: opts.commandBase,
        launchMode: opts.launchMode,
        extraArgs: opts.extraArgs,
        sessionId: opts.sessionId,
        baseUrl: opts.baseUrl ?? "",
        model: opts.model,
        wireApi: opts.wireApi,
      });
    },
    normalizeProfile(profile: Profile): Profile {
      const url = normalizeCodexUrl(profile.url ?? "");
      return { ...profile, provider: "codex", url };
    },
    getBrowserUrl(url: string): string {
      return buildCodexBrowserUrl(url);
    },
  };
}

const adapters: Record<string, ProviderAdapter> = {
  claude: createClaudeAdapter(),
  codex: createCodexAdapter(),
};

export function getAdapter(providerID: string): ProviderAdapter {
  const normalized = normalizeProvider(providerID);
  const adapter = adapters[normalized];
  if (!adapter) {
    return adapters.claude;
  }
  return adapter;
}

export function getAvailableProviders(): ProviderID[] {
  return ["claude", "codex"];
}
