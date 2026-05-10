import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { copyDirectory, ensureDirectory, pathExists, writeJson } from "../filesystem.js";
import {
  buildCodexProfileDirectoryName,
  buildLegacyCodexProfileDirectoryName,
} from "./model-mapping-config-service.js";

export interface CapabilityOverlayServiceOptions {
  overlayRoot: string;
  claudeHome?: string;
  claudeGlobalStatePath?: string;
  codexHome?: string;
  agentsHome?: string;
}

export interface ClaudeCapabilityOverlay {
  settingsFile: string;
  mcpConfigPaths: string[];
  addDirs: string[];
  pluginDirs: string[];
}

export interface CodexSkillLinkPlan {
  skillName: string;
  sourcePath: string;
  targetPath: string;
}

export interface CodexCapabilityOverlay {
  globalMcpToml: string;
  skillLinks: CodexSkillLinkPlan[];
}

interface JsonObject {
  [key: string]: unknown;
}

const MCP_SERVERS_HEADER_PATTERN = /^\s*\[mcp_servers(?:\.[^\]]+)?\]\s*$/;
const TABLE_HEADER_PATTERN = /^\s*\[[^\]]+\]\s*$/;

export class CapabilityOverlayService {
  private readonly overlayRoot: string;
  private readonly claudeHome: string;
  private readonly claudeGlobalStatePath: string;
  private readonly codexHome: string;
  private readonly agentsHome: string;

  constructor(options: CapabilityOverlayServiceOptions) {
    const home = os.homedir();
    this.overlayRoot = path.resolve(options.overlayRoot);
    this.claudeHome = path.resolve(options.claudeHome ?? path.join(home, ".claude"));
    this.claudeGlobalStatePath = path.resolve(options.claudeGlobalStatePath ?? path.join(home, ".claude.json"));
    this.codexHome = path.resolve(options.codexHome ?? path.join(home, ".codex"));
    this.agentsHome = path.resolve(options.agentsHome ?? path.join(home, ".agents"));
  }

  async prepareClaudeOverlay(options: { profileId: string }): Promise<ClaudeCapabilityOverlay> {
    const profileOverlayRoot = this.profileOverlayRoot("claude", options.profileId);
    await this.clearManagedOverlay(profileOverlayRoot);
    await ensureDirectory(profileOverlayRoot);

    const settingsFile = path.join(profileOverlayRoot, "settings.global-capabilities.json");
    const mcpConfigPath = path.join(profileOverlayRoot, "mcp-config.json");
    const addDir = path.join(profileOverlayRoot, "add-dir");

    const globalState = await readJsonObjectIfExists(this.claudeGlobalStatePath);
    const settings = await readJsonObjectIfExists(path.join(this.claudeHome, "settings.json"));
    const mcpServers = asJsonObject(globalState?.mcpServers);
    const settingsOverlay = buildClaudeSettingsOverlay(settings);
    const standaloneSkillSources = await listSkillDirectories(path.join(this.claudeHome, "skills"));
    const pluginDirs = await this.resolveEnabledClaudePluginDirs(settings);

    await writeJson(mcpConfigPath, { mcpServers });
    await writeJson(settingsFile, settingsOverlay);
    await copySkillsToClaudeAddDir(standaloneSkillSources, addDir);

    return {
      settingsFile,
      mcpConfigPaths: Object.keys(mcpServers).length > 0 ? [mcpConfigPath] : [],
      addDirs: standaloneSkillSources.length > 0 ? [addDir] : [],
      pluginDirs,
    };
  }

  async prepareCodexOverlay(options: { profileId: string; profileHome: string }): Promise<CodexCapabilityOverlay> {
    const profileOverlayRoot = this.profileOverlayRoot("codex", options.profileId);
    await this.clearManagedOverlay(profileOverlayRoot);
    await ensureDirectory(profileOverlayRoot);

    const globalMcpToml = await extractCodexMcpToml(path.join(this.codexHome, "config.toml"));
    const skillSources = await this.resolveCodexSkillSources();
    const skillLinks = await copySkillsToCodexAgentsDir(skillSources, path.join(options.profileHome, ".agents", "skills"));
    await writeJson(path.join(profileOverlayRoot, "manifest.json"), {
      profileId: options.profileId,
      globalMcpToml,
      skillLinks,
    });

    return { globalMcpToml, skillLinks };
  }

  async clearManagedOverlay(targetPath: string): Promise<void> {
    const resolvedTarget = path.resolve(targetPath);
    const relative = path.relative(this.overlayRoot, resolvedTarget);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("拒绝清理 overlay 根目录之外的路径");
    }
    await fs.rm(resolvedTarget, { recursive: true, force: true });
  }

  private profileOverlayRoot(provider: "claude" | "codex", profileId: string): string {
    const directoryName = provider === "codex"
      ? buildCodexProfileDirectoryName(profileId)
      : buildLegacyCodexProfileDirectoryName(profileId);
    return path.join(this.overlayRoot, provider, directoryName);
  }

  private async resolveEnabledClaudePluginDirs(settings: JsonObject | undefined): Promise<string[]> {
    const enabledPlugins = asBooleanRecord(settings?.enabledPlugins);
    if (Object.keys(enabledPlugins).length === 0) {
      return [];
    }

    const installed = await readJsonObjectIfExists(path.join(this.claudeHome, "plugins", "installed_plugins.json"));
    const plugins = asJsonObject(installed?.plugins);
    const result: string[] = [];
    for (const [pluginId, enabled] of Object.entries(enabledPlugins)) {
      if (!enabled) {
        continue;
      }
      const installs = Array.isArray(plugins[pluginId]) ? plugins[pluginId] : [];
      for (const install of installs) {
        const installPath = asJsonObject(install).installPath;
        if (typeof installPath !== "string" || !installPath.trim()) {
          continue;
        }
        const normalized = path.resolve(installPath);
        if (await pathExists(normalized)) {
          result.push(normalized);
        }
      }
    }
    return uniqueStrings(result);
  }

  private async resolveCodexSkillSources(): Promise<Map<string, string>> {
    const roots = [
      path.join(this.agentsHome, "skills"),
      path.join(this.codexHome, "skills"),
      path.join(this.codexHome, "research-writing-skill", "skills"),
      path.join(this.codexHome, "superpowers", "skills"),
    ];
    const skills = new Map<string, string>();
    for (const root of roots) {
      const entries = await listSkillDirectories(root);
      for (const entry of entries) {
        if (!skills.has(entry.name)) {
          skills.set(entry.name, entry.path);
        }
      }
    }
    return skills;
  }
}

async function readJsonObjectIfExists(targetPath: string): Promise<JsonObject | undefined> {
  if (!(await pathExists(targetPath))) {
    return undefined;
  }
  const content = await fs.readFile(targetPath, "utf8");
  return asJsonObject(JSON.parse(content));
}

function asJsonObject(value: unknown): JsonObject {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return {};
}

function asBooleanRecord(value: unknown): Record<string, boolean> {
  const object = asJsonObject(value);
  return Object.fromEntries(
    Object.entries(object).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
  );
}

function buildClaudeSettingsOverlay(settings: JsonObject | undefined): JsonObject {
  const overlay: JsonObject = {};
  const permissions = asJsonObject(settings?.permissions);
  const allow = Array.isArray(permissions.allow)
    ? permissions.allow.filter((item): item is string => typeof item === "string" && item.startsWith("mcp__"))
    : [];
  if (allow.length > 0) {
    overlay.permissions = { allow: uniqueStrings(allow) };
  }
  const enabledPlugins = asBooleanRecord(settings?.enabledPlugins);
  if (Object.keys(enabledPlugins).length > 0) {
    overlay.enabledPlugins = enabledPlugins;
  }
  return overlay;
}

async function listSkillDirectories(root: string): Promise<Array<{ name: string; path: string }>> {
  if (!(await pathExists(root))) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const candidates = entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => ({ name: entry.name, path: path.join(root, entry.name) }));
  const result: Array<{ name: string; path: string }> = [];
  for (const candidate of candidates) {
    if (await pathExists(path.join(candidate.path, "SKILL.md"))) {
      result.push(candidate);
    }
  }
  return result.sort((left, right) => left.name.localeCompare(right.name));
}

async function copySkillsToClaudeAddDir(sources: Array<{ name: string; path: string }>, addDir: string): Promise<void> {
  const targetRoot = path.join(addDir, ".claude", "skills");
  for (const source of sources) {
    await linkOrCopyDirectory(source.path, path.join(targetRoot, source.name));
  }
}

async function copySkillsToCodexAgentsDir(sources: Map<string, string>, targetRoot: string): Promise<CodexSkillLinkPlan[]> {
  const result: CodexSkillLinkPlan[] = [];
  for (const [skillName, sourcePath] of Array.from(sources.entries()).sort(([left], [right]) => left.localeCompare(right))) {
    const targetPath = path.join(targetRoot, skillName);
    if (await pathExists(targetPath)) {
      continue;
    }
    const resolvedSourcePath = await fs.realpath(sourcePath);
    await linkOrCopyDirectory(resolvedSourcePath, targetPath);
    result.push({ skillName, sourcePath, targetPath });
  }
  return result;
}

async function linkOrCopyDirectory(sourcePath: string, targetPath: string): Promise<void> {
  await ensureDirectory(path.dirname(targetPath));
  try {
    await fs.symlink(sourcePath, targetPath, "junction");
  } catch {
    await copyDirectory(sourcePath, targetPath);
  }
}

async function extractCodexMcpToml(configPath: string): Promise<string> {
  if (!(await pathExists(configPath))) {
    return "";
  }
  const lines = (await fs.readFile(configPath, "utf8")).split(/\r?\n/);
  const selected: string[] = [];
  let inMcpTable = false;
  for (const line of lines) {
    if (TABLE_HEADER_PATTERN.test(line)) {
      inMcpTable = MCP_SERVERS_HEADER_PATTERN.test(line);
    }
    if (inMcpTable) {
      selected.push(line);
    }
  }
  return trimTomlBlock(selected.join("\n"));
}

function trimTomlBlock(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `${trimmed}\n` : "";
}

function uniqueStrings(values: string[]): string[] {
  return values.filter((value, index, all) => all.indexOf(value) === index);
}
