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
  apiKeyEnv: string;
  targetModel: string;
  wireApi?: string;
  skipGitRepoCheck?: boolean;
  content?: string;
}

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

export function buildCodexSiteApiKeyEnv(profileId: string): string {
  return `CODEX_SITE_API_KEY_${codexProfileHash(profileId).toUpperCase()}`;
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
      `env_key = ${JSON.stringify(options.apiKeyEnv.trim())}`,
      `wire_api = ${JSON.stringify(wireApi)}`,
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
