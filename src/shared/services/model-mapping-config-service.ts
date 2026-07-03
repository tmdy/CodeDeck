import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import {
  normalizeModelMappingsState,
  validateModelMappingsState,
  type MappingClient,
  type ModelMappingsState,
} from "../model-mapping/config-types.js";
import { ensureDirectory, pathExists, readJson, writeJson } from "../filesystem.js";

export interface ModelMappingConfigServiceOptions {
  appDataRoot: string;
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
  rulesContent?: string;
  globalConfigContent?: string;
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
  private readonly codexRuntimeHome: string;

  constructor(private readonly options: ModelMappingConfigServiceOptions) {
    this.filePath = path.join(options.appDataRoot, "model-mappings.json");
    this.codexProfilesRoot = path.join(options.appDataRoot, "codex-profiles");
    this.codexRuntimeHome = path.join(options.appDataRoot, "codex-runtime", "home");
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
    const runtimeHome = await this.ensureCodexRuntimeHome();
    const baseConfigPath = path.join(runtimeHome, "config.toml");
    const profileName = options.profileName ?? buildCodexSiteProfileName(options.profileId);
    const profileConfigPath = path.join(runtimeHome, `${profileName}.config.toml`);
    const rawProfileContent = options.content ?? this.buildCodexProfileContent(options);
    const profileContent = normalizeTomlContent(toStandaloneCodexProfileContent(rawProfileContent, profileName));

    const existingBaseConfig = await readTextIfExists(baseConfigPath);
    const cleanedBaseConfig = cleanCodexBaseConfig(existingBaseConfig, new Set([options.providerId]));
    const globalConfigContent = normalizeTomlContent([
      extractCodexGlobalConfigContent(rawProfileContent),
      options.globalConfigContent ?? "",
    ].filter((item) => item.trim()).join("\n"));
    const globalHeaders = collectTomlHeaders(globalConfigContent);
    const nextBaseConfig = globalHeaders.size > 0
      ? mergeTomlBlocks(cleanedBaseConfig, globalConfigContent, globalHeaders)
      : cleanedBaseConfig;

    await ensureDirectory(runtimeHome);
    if (existingBaseConfig || nextBaseConfig.trim()) {
      await writeTextWithBackupIfChanged(baseConfigPath, nextBaseConfig);
    }
    if (options.rulesContent !== undefined) {
      await writeTextWithBackupIfChanged(
        path.join(runtimeHome, "rules", "managed-permissions.rules"),
        normalizeTomlContent(options.rulesContent),
      );
    }
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
    return this.codexRuntimeHome;
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
    await ensureDirectory(this.codexRuntimeHome);
    await this.migrateCodexProfileHistories();
    return this.codexRuntimeHome;
  }

  private async migrateCodexProfileHistories(): Promise<void> {
    if (!(await pathExists(this.codexProfilesRoot))) {
      return;
    }
    const entries = await fs.readdir(this.codexProfilesRoot, { withFileTypes: true });
    const profileEntries = entries
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .sort((left, right) => {
        const leftHash = left.name.startsWith("codex-profile-") ? 1 : 0;
        const rightHash = right.name.startsWith("codex-profile-") ? 1 : 0;
        return leftHash - rightHash || left.name.localeCompare(right.name);
      });

    for (const entry of profileEntries) {
      const profileRoot = path.join(this.codexProfilesRoot, entry.name);
      this.assertProfilePathInRoot(profileRoot);
      await mergeJsonlByLine(
        path.join(profileRoot, "history.jsonl"),
        path.join(this.codexRuntimeHome, "history.jsonl"),
      );
      await mergeSessionIndex(
        path.join(profileRoot, "session_index.jsonl"),
        path.join(this.codexRuntimeHome, "session_index.jsonl"),
      );
      await copySessionFiles(
        path.join(profileRoot, "sessions"),
        path.join(this.codexRuntimeHome, "sessions"),
      );
    }
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
  await fs.writeFile(targetPath, content, "utf8");
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

function extractCodexGlobalConfigContent(content: string): string {
  return renderTomlBlocks(splitTomlBlocks(content).filter((block) => block.header && isCodexGlobalConfigHeader(block.header)));
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

function collectTomlHeaders(content: string): Set<string> {
  return new Set(splitTomlBlocks(content)
    .map((block) => block.header)
    .filter((header): header is string => Boolean(header)));
}

function cleanCodexBaseConfig(existing: string, providerIdsToRemove: Set<string>): string {
  const blocks = splitTomlBlocks(existing);
  const keptBlocks: TomlBlock[] = [];
  for (const block of blocks) {
    if (!block.header) {
      const lines = block.lines.filter((line) => !/^\s*profile\s*=/.test(line));
      if (lines.some((line) => line.trim())) {
        keptBlocks.push({ lines });
      }
      continue;
    }
    if (isLegacyCodexProfileHeader(block.header)) {
      continue;
    }
    if (isManagedProviderHeader(block.header, providerIdsToRemove)) {
      continue;
    }
    keptBlocks.push(block);
  }
  return renderTomlBlocks(keptBlocks);
}

function isLegacyCodexProfileHeader(header: string): boolean {
  return header === "profiles" || header.startsWith("profiles.");
}

function isManagedProviderHeader(header: string, providerIdsToRemove: Set<string>): boolean {
  for (const providerId of providerIdsToRemove) {
    if (header === `model_providers.${providerId}`) {
      return true;
    }
  }
  return false;
}

function mergeTomlBlocks(existing: string, incoming: string, replaceHeaders: Set<string>): string {
  const existingBlocks = splitTomlBlocks(existing);
  const incomingBlocks = splitTomlBlocks(incoming);
  const existingHeaders = new Set(existingBlocks.map((block) => block.header).filter((header): header is string => Boolean(header)));
  const keptBlocks = existingBlocks.filter((block) => !block.header || !replaceHeaders.has(block.header));
  const appendedBlocks = incomingBlocks.filter((block) => {
    if (!block.header) {
      return false;
    }
    return replaceHeaders.has(block.header) || !existingHeaders.has(block.header);
  });
  const blocks = [...keptBlocks, ...appendedBlocks];
  return renderTomlBlocks(blocks);
}

async function readJsonlLines(filePath: string): Promise<string[]> {
  if (!(await pathExists(filePath))) {
    return [];
  }
  const content = await fs.readFile(filePath, "utf8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function mergeJsonlByLine(sourcePath: string, targetPath: string): Promise<void> {
  const sourceLines = await readJsonlLines(sourcePath);
  if (sourceLines.length === 0) {
    return;
  }
  const targetLines = await readJsonlLines(targetPath);
  const seen = new Set(targetLines);
  const nextLines = [...targetLines];
  for (const line of sourceLines) {
    if (seen.has(line)) {
      continue;
    }
    seen.add(line);
    nextLines.push(line);
  }
  if (nextLines.length === targetLines.length) {
    return;
  }
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${nextLines.join("\n")}\n`, "utf8");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function indexRecordId(record: Record<string, unknown>): string {
  return firstString(record.id, record.session_id, record.sessionId);
}

function indexRecordUpdatedAt(record: Record<string, unknown>): number {
  const timestamp = Date.parse(firstString(record.updated_at, record.updatedAt));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function indexRecordCompleteness(record: Record<string, unknown>): number {
  return [
    firstString(record.cwd, record.project_path, record.projectPath),
    firstString(record.thread_name, record.title, record.name, record.preview),
    firstString(record.updated_at, record.updatedAt),
  ].filter(Boolean).length;
}

function shouldPreferIndexRecord(candidate: Record<string, unknown>, current: Record<string, unknown>): boolean {
  const candidateTime = indexRecordUpdatedAt(candidate);
  const currentTime = indexRecordUpdatedAt(current);
  if (candidateTime !== currentTime) {
    return candidateTime > currentTime;
  }
  return indexRecordCompleteness(candidate) > indexRecordCompleteness(current);
}

function mergeIndexRecord(primary: Record<string, unknown>, secondary: Record<string, unknown>): Record<string, unknown> {
  const merged = { ...primary };
  for (const [key, value] of Object.entries(secondary)) {
    if ((merged[key] === undefined || merged[key] === "") && value !== undefined && value !== "") {
      merged[key] = value;
    }
  }
  return merged;
}

async function readIndexRecords(filePath: string): Promise<Array<Record<string, unknown>>> {
  const lines = await readJsonlLines(filePath);
  const records: Array<Record<string, unknown>> = [];
  for (const line of lines) {
    try {
      const record = asRecord(JSON.parse(line));
      if (record && indexRecordId(record)) {
        records.push(record);
      }
    } catch {
      // 忽略单条损坏索引，避免阻断其他历史迁移。
    }
  }
  return records;
}

async function mergeSessionIndex(sourcePath: string, targetPath: string): Promise<void> {
  const sourceRecords = await readIndexRecords(sourcePath);
  if (sourceRecords.length === 0) {
    return;
  }
  const targetRecords = await readIndexRecords(targetPath);
  const byId = new Map<string, Record<string, unknown>>();

  for (const record of targetRecords) {
    byId.set(indexRecordId(record), record);
  }
  for (const record of sourceRecords) {
    const id = indexRecordId(record);
    const current = byId.get(id);
    if (!current) {
      byId.set(id, record);
      continue;
    }
    const primary = shouldPreferIndexRecord(record, current) ? record : current;
    const secondary = primary === record ? current : record;
    byId.set(id, mergeIndexRecord(primary, secondary));
  }

  const nextRecords = Array.from(byId.values()).sort(
    (left, right) => indexRecordUpdatedAt(right) - indexRecordUpdatedAt(left),
  );
  await ensureDirectory(path.dirname(targetPath));
  await fs.writeFile(targetPath, `${nextRecords.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
}

async function copySessionFiles(sourceRoot: string, targetRoot: string): Promise<void> {
  if (!(await pathExists(sourceRoot))) {
    return;
  }

  async function visit(currentRoot: string): Promise<void> {
    const entries = await fs.readdir(currentRoot, { withFileTypes: true });
    for (const entry of entries) {
      const sourcePath = path.join(currentRoot, entry.name);
      if (entry.isDirectory()) {
        await visit(sourcePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      const relativePath = path.relative(sourceRoot, sourcePath);
      const targetPath = path.join(targetRoot, relativePath);
      await copySessionFile(sourcePath, targetPath);
    }
  }

  await visit(sourceRoot);
}

async function copySessionFile(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  if (!(await pathExists(targetPath))) {
    await fs.copyFile(sourcePath, targetPath);
    return;
  }

  const [sourceContent, targetContent] = await Promise.all([
    fs.readFile(sourcePath),
    fs.readFile(targetPath),
  ]);
  if (sourceContent.equals(targetContent)) {
    return;
  }

  const hash = createHash("sha256").update(sourceContent).digest("hex").slice(0, 8);
  const extension = path.extname(targetPath);
  const basePath = extension ? targetPath.slice(0, -extension.length) : targetPath;
  const conflictPath = `${basePath}.conflict-${hash}${extension || ".jsonl"}`;
  if (await pathExists(conflictPath)) {
    const conflictContent = await fs.readFile(conflictPath);
    if (sourceContent.equals(conflictContent)) {
      return;
    }
  }
  await fs.copyFile(sourcePath, conflictPath);
}
