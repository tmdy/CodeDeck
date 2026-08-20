import { promises as fs } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import {
  normalizeModelMappingsState,
  validateModelMappingsState,
  type MappingClient,
  type ModelMappingsState,
} from "../model-mapping/config-types.js";
import { ensureDirectory, pathExists, readJson, writeJson } from "../filesystem.js";
import { resolveCanonicalCodexHome } from "./codex-home.js";
import { itemKey } from "../profile/keys-internal.js";
import {
  getProfileApiKey,
  isOfficialNativeProfile,
  type Profile,
} from "../profile/types.js";

export interface ModelMappingConfigServiceOptions {
  appDataRoot: string;
  codexHome?: string;
}

export interface WriteCodexProfileOptions {
  profileId: string;
  profileName?: string;
  providerId: string;
  providerName: string;
  baseUrl: string;
  authCommand: string;
  targetModel: string;
  wireApi?: string;
  skipGitRepoCheck?: boolean;
  content?: string;
}

export interface CodexSiteProviderDefinition {
  providerId: string;
  providerName: string;
  baseUrl: string;
  wireApi?: string;
}

export interface SyncCodexProviderRegistryOptions {
  providers: CodexSiteProviderDefinition[];
  authCommand: string;
}

export type CodexSiteProviderTokenResolution =
  | { ok: true; token: string }
  | {
      ok: false;
      code: "store_locked" | "provider_not_found" | "profile_not_found";
    };

export const CODEDECK_PROVIDER_REGISTRY_BEGIN = "# BEGIN CODEDECK MANAGED SITE PROVIDERS";
export const CODEDECK_PROVIDER_REGISTRY_END = "# END CODEDECK MANAGED SITE PROVIDERS";

export function sanitizeCodexProfileId(profileId: string): string {
  return buildLegacyCodexProfileDirectoryName(profileId);
}

function codexProfileHash(profileId: string): string {
  return createHash("sha256").update(profileId.trim(), "utf8").digest("hex").slice(0, 16);
}

export function buildCodexProfileDirectoryName(profileId: string): string {
  return `codex-profile-${codexProfileHash(profileId)}`;
}

export function buildCodexSiteProfileName(profileId: string): string {
  return `site-${codexProfileHash(profileId)}`;
}

export function buildCodexSiteProviderId(profileId: string): string {
  return `site_provider_${codexProfileHash(profileId)}`;
}

export function findCodexSiteProfileByProviderId(
  profiles: Profile[],
  providerId: string,
): Profile | undefined {
  const normalizedProviderId = providerId.trim();
  if (!/^site_provider_[a-f0-9]{16}$/.test(normalizedProviderId)) {
    return undefined;
  }
  return profiles.find((profile) => (
    profile.provider === "codex"
    && !isOfficialNativeProfile(profile)
    && buildCodexSiteProviderId(itemKey(profile)) === normalizedProviderId
  ));
}

export function resolveCodexSiteProviderToken(
  profiles: Profile[] | undefined,
  providerId: string,
): CodexSiteProviderTokenResolution {
  if (!profiles) {
    return { ok: false, code: "store_locked" };
  }
  const normalizedProviderId = providerId.trim();
  if (!/^site_provider_[a-f0-9]{16}$/.test(normalizedProviderId)) {
    return { ok: false, code: "provider_not_found" };
  }
  const profile = findCodexSiteProfileByProviderId(profiles, normalizedProviderId);
  if (!profile) {
    return { ok: false, code: "profile_not_found" };
  }
  const token = getProfileApiKey(profile).trim();
  return token
    ? { ok: true, token }
    : { ok: false, code: "profile_not_found" };
}

export function buildLegacyCodexProfileDirectoryName(profileId: string): string {
  return profileId.replaceAll("::", "__").replace(/[^a-zA-Z0-9_-]+/g, "_");
}

async function backupIfExists(targetPath: string): Promise<void> {
  if (!(await pathExists(targetPath))) {
    return;
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  await fs.copyFile(targetPath, `${targetPath}.bak.${timestamp}`);
}

export class ModelMappingConfigService {
  private readonly filePath: string;
  private readonly codexProfilesRoot: string;
  private readonly codexHome: string;

  constructor(private readonly options: ModelMappingConfigServiceOptions) {
    this.filePath = path.join(options.appDataRoot, "model-mappings.json");
    this.codexProfilesRoot = path.join(options.appDataRoot, "codex-profiles");
    this.codexHome = options.codexHome?.trim() || resolveCanonicalCodexHome();
  }

  async load(): Promise<ModelMappingsState> {
    const raw = await readJson<ModelMappingsState>(this.filePath);
    return normalizeModelMappingsState(raw);
  }

  async save(state: ModelMappingsState): Promise<ModelMappingsState> {
    const normalized = normalizeModelMappingsState(state);
    const errors = validateModelMappingsState(normalized);
    if (errors.length > 0) {
      throw new Error(errors.join("；"));
    }
    await ensureDirectory(this.options.appDataRoot);
    await backupIfExists(this.filePath);
    await writeJson(this.filePath, normalized);
    return normalized;
  }

  updateFetchedModels(
    state: ModelMappingsState,
    client: MappingClient,
    models: string[],
    fetchedAt = new Date().toLocaleString(),
  ): ModelMappingsState {
    return normalizeModelMappingsState({
      ...state,
      fetchedModelsByClient: {
        ...state.fetchedModelsByClient,
        [client]: models,
      },
      lastFetchedAtByClient: {
        ...state.lastFetchedAtByClient,
        [client]: fetchedAt,
      },
    });
  }

  async writeCodexProfile(options: WriteCodexProfileOptions): Promise<string> {
    const codexHome = await this.ensureCodexHome();
    const profileName = options.profileName ?? buildCodexSiteProfileName(options.profileId);
    const profileConfigPath = path.join(codexHome, `${profileName}.config.toml`);
    const rawProfileContent = options.content ?? this.buildCodexProfileContent(options);
    const profileContent = normalizeTomlContent(toStandaloneCodexProfileContent(rawProfileContent, profileName));

    await writeTextWithBackupIfChanged(profileConfigPath, profileContent);
    return profileConfigPath;
  }

  async resolveNativeCodexModelProvider(): Promise<string> {
    const configContent = await readTextIfExists(path.join(this.codexHome, "config.toml"));
    return readTopLevelTomlString(configContent, "model_provider") || "openai";
  }

  async syncCodexProviderRegistry(options: SyncCodexProviderRegistryOptions): Promise<string> {
    const codexHome = await this.ensureCodexHome();
    const configPath = path.join(codexHome, "config.toml");
    const existing = await readTextIfExists(configPath);
    const { externalContent } = splitManagedProviderRegistry(existing);
    const providers = normalizeProviderDefinitions(options.providers);
    for (const provider of providers) {
      if (hasProviderTable(externalContent, provider.providerId)) {
        throw new Error(`provider_conflict: ${provider.providerId}`);
      }
    }
    const eol = existing.includes("\r\n") ? "\r\n" : "\n";
    const managedBlock = providers.length > 0
      ? renderProviderRegistry(providers, options.authCommand, eol)
      : "";
    await writeTextWithBackupIfChanged(configPath, managedBlock + externalContent);
    return configPath;
  }

  buildCodexProfileContent(options: WriteCodexProfileOptions): string {
    const targetModel = options.targetModel.trim();
    const wireApi = options.wireApi?.trim() || "responses";
    const skipGitRepoCheckLines = options.skipGitRepoCheck
      ? ["skip_git_repo_check = true"]
      : [];
    const profileLines = targetModel
      ? [
          `model = ${JSON.stringify(targetModel)}`,
          `model_provider = ${JSON.stringify(options.providerId)}`,
          ...skipGitRepoCheckLines,
          "",
        ]
      : [...skipGitRepoCheckLines, ...(skipGitRepoCheckLines.length > 0 ? [""] : [])];
    return [
      ...profileLines,
      `[model_providers.${options.providerId}]`,
      `name = ${JSON.stringify(options.providerName.trim())}`,
      `base_url = ${JSON.stringify(options.baseUrl.trim())}`,
      `wire_api = ${JSON.stringify(wireApi)}`,
      "",
      `[model_providers.${options.providerId}.auth]`,
      `command = ${JSON.stringify(options.authCommand.trim())}`,
      `args = ["auth-token", "--provider", ${JSON.stringify(options.providerId.trim())}]`,
      "",
      "[windows]",
      'sandbox = "elevated"',
      "",
    ].join("\n");
  }

  getCodexProfilesRoot(): string {
    return this.codexProfilesRoot;
  }

  getCodexRuntimeHome(): string {
    return this.codexHome;
  }

  getCodexHome(): string {
    return this.codexHome;
  }

  getCodexProfileRoot(profileId: string): string {
    return path.join(this.codexProfilesRoot, buildCodexProfileDirectoryName(profileId));
  }

  getLegacyCodexProfileRoot(profileId: string): string {
    return path.join(this.codexProfilesRoot, buildLegacyCodexProfileDirectoryName(profileId));
  }

  async ensureCodexProfileRoot(profileId: string): Promise<string> {
    const profileRoot = this.getCodexProfileRoot(profileId);
    this.assertProfilePathInRoot(profileRoot);
    await ensureDirectory(profileRoot);
    return profileRoot;
  }

  async ensureCodexRuntimeHome(): Promise<string> {
    return this.ensureCodexHome();
  }

  async ensureCodexHome(): Promise<string> {
    await ensureDirectory(this.codexHome);
    return this.codexHome;
  }

  private assertProfilePathInRoot(targetPath: string): void {
    const resolvedRoot = path.resolve(this.codexProfilesRoot);
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(resolvedRoot, resolvedTarget);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("拒绝访问 Codex profiles 根目录之外的路径");
    }
  }
}

function readTopLevelTomlString(content: string, key: string): string {
  for (const line of content.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*\[/.test(line)) {
      break;
    }
    const match = line.match(new RegExp(`^\\s*${key}\\s*=\\s*("(?:[^"\\\\]|\\\\.)*"|'[^']*')\\s*(?:#.*)?$`));
    if (!match) continue;
    if (match[1].startsWith("\"")) {
      try {
        const parsed = JSON.parse(match[1]);
        return typeof parsed === "string" ? parsed.trim() : "";
      } catch {
        return "";
      }
    }
    return match[1].slice(1, -1).trim();
  }
  return "";
}

function splitManagedProviderRegistry(content: string): { externalContent: string } {
  const begin = content.indexOf(CODEDECK_PROVIDER_REGISTRY_BEGIN);
  const end = content.indexOf(CODEDECK_PROVIDER_REGISTRY_END);
  if (begin === -1 && end === -1) {
    return { externalContent: content };
  }
  if (begin !== 0 || end < begin) {
    throw new Error("provider_registry_invalid: CodeDeck managed provider markers are malformed");
  }
  const afterMarker = end + CODEDECK_PROVIDER_REGISTRY_END.length;
  const blockEnd = content.startsWith("\r\n", afterMarker)
    ? afterMarker + 2
    : content.startsWith("\n", afterMarker)
      ? afterMarker + 1
      : afterMarker;
  return { externalContent: content.slice(blockEnd) };
}

function normalizeProviderDefinitions(
  providers: CodexSiteProviderDefinition[],
): CodexSiteProviderDefinition[] {
  const byId = new Map<string, CodexSiteProviderDefinition>();
  for (const provider of providers) {
    const providerId = provider.providerId.trim();
    if (!/^site_provider_[a-f0-9]{16}$/.test(providerId)) {
      throw new Error(`provider_not_found: ${providerId || "empty"}`);
    }
    if (byId.has(providerId)) {
      throw new Error(`provider_conflict: ${providerId}`);
    }
    byId.set(providerId, {
      providerId,
      providerName: provider.providerName.trim(),
      baseUrl: provider.baseUrl.trim(),
      wireApi: provider.wireApi?.trim() || "responses",
    });
  }
  return Array.from(byId.values()).sort((left, right) => left.providerId.localeCompare(right.providerId));
}

function hasProviderTable(content: string, providerId: string): boolean {
  const escaped = providerId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const root = `(?:model_providers|"model_providers"|'model_providers')`;
  const segment = `(?:${escaped}|"${escaped}"|'${escaped}')`;
  return new RegExp(`^\\s*\\[\\s*${root}\\s*\\.\\s*${segment}(?:\\s*\\.|\\s*\\])`, "m").test(content)
    || new RegExp(`^\\s*${root}\\s*\\.\\s*${segment}\\s*=`, "m").test(content);
}

function renderProviderRegistry(
  providers: CodexSiteProviderDefinition[],
  authCommand: string,
  eol: string,
): string {
  const lines = [CODEDECK_PROVIDER_REGISTRY_BEGIN];
  for (const provider of providers) {
    lines.push(
      `model_providers.${provider.providerId} = { `
        + `name = ${JSON.stringify(provider.providerName)}, `
        + `base_url = ${JSON.stringify(provider.baseUrl)}, `
        + `wire_api = ${JSON.stringify(provider.wireApi || "responses")}, `
        + `auth = { command = ${JSON.stringify(authCommand.trim())}, `
        + `args = ["auth-token", "--provider", ${JSON.stringify(provider.providerId)}] } }`,
    );
  }
  lines.push(CODEDECK_PROVIDER_REGISTRY_END);
  return lines.join(eol) + eol;
}

interface TomlBlock {
  header?: string;
  lines: string[];
}

async function readTextIfExists(targetPath: string): Promise<string> {
  if (!(await pathExists(targetPath))) {
    return "";
  }
  return fs.readFile(targetPath, "utf8");
}

async function writeTextWithBackupIfChanged(targetPath: string, content: string): Promise<void> {
  const existing = await readTextIfExists(targetPath);
  if (existing === content) {
    return;
  }
  await ensureDirectory(path.dirname(targetPath));
  if (existing) {
    await backupIfExists(targetPath);
  }
  const temporaryPath = `${targetPath}.tmp-${process.pid}-${randomUUID()}`;
  await fs.writeFile(temporaryPath, content, "utf8");
  try {
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

function normalizeTomlContent(content: string): string {
  const normalized = content.replace(/\r\n/g, "\n").trim();
  return normalized ? `${normalized}\n` : "";
}

function toStandaloneCodexProfileContent(content: string, profileName: string): string {
  const blocks = splitTomlBlocks(content);
  const standaloneBlocks: TomlBlock[] = [];
  const topLevelLines: string[] = [];
  for (const block of blocks) {
    if (!block.header) {
      topLevelLines.push(...block.lines);
      continue;
    }
    if (isTargetProfileHeader(block.header, profileName)) {
      topLevelLines.push(...block.lines.slice(1), "");
      continue;
    }
    if (isTargetProfileWorkspaceHeader(block.header, profileName)) {
      standaloneBlocks.push({
        header: "sandbox_workspace_write",
        lines: ["[sandbox_workspace_write]", ...block.lines.slice(1)],
      });
      continue;
    }
    if (isLegacyCodexProfileHeader(block.header) || isCodexGlobalConfigHeader(block.header)) {
      continue;
    }
    standaloneBlocks.push(block);
  }
  const normalizedTopLevelLines = topLevelLines.filter((line, index, lines) => {
    if (line.trim()) {
      return true;
    }
    return index > 0 && lines[index - 1]?.trim();
  });
  return renderTomlBlocks([
    ...(normalizedTopLevelLines.some((line) => line.trim()) ? [{ lines: normalizedTopLevelLines }] : []),
    ...standaloneBlocks,
  ]);
}

function isTargetProfileHeader(header: string, profileName: string): boolean {
  return profileHeaderCandidates(profileName).some((candidate) => header === candidate);
}

function isTargetProfileWorkspaceHeader(header: string, profileName: string): boolean {
  return profileHeaderCandidates(profileName).some((candidate) => header === `${candidate}.sandbox_workspace_write`);
}

function profileHeaderCandidates(profileName: string): string[] {
  return [`profiles.${JSON.stringify(profileName)}`, `profiles.${profileName}`];
}

function isCodexGlobalConfigHeader(header: string): boolean {
  return header === "mcp_servers"
    || header.startsWith("mcp_servers.")
    || header === "marketplaces"
    || header.startsWith("marketplaces.")
    || header === "plugins"
    || header.startsWith("plugins.")
    || header === "projects"
    || header.startsWith("projects.");
}

function splitTomlBlocks(content: string): TomlBlock[] {
  const blocks: TomlBlock[] = [];
  let current: TomlBlock = { lines: [] };
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    const match = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (match) {
      if (current.header || current.lines.some((item) => item.trim())) {
        blocks.push(current);
      }
      current = { header: match[1].trim(), lines: [line] };
      continue;
    }
    current.lines.push(line);
  }
  if (current.header || current.lines.some((item) => item.trim())) {
    blocks.push(current);
  }
  return blocks;
}

function renderTomlBlocks(blocks: TomlBlock[]): string {
  const rendered = blocks
    .map((block) => block.lines.join("\n").trimEnd())
    .filter(Boolean)
    .join("\n\n");
  return rendered ? `${rendered}\n` : "";
}

function isLegacyCodexProfileHeader(header: string): boolean {
  return header === "profiles" || header.startsWith("profiles.");
}
