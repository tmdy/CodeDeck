import { promises as fs } from "node:fs";
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
  providerId: string;
  providerName: string;
  baseUrl: string;
  apiKeyEnv: string;
  targetModel: string;
}

function sanitizeProfileId(profileId: string): string {
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

  constructor(private readonly options: ModelMappingConfigServiceOptions) {
    this.filePath = path.join(options.appDataRoot, "model-mappings.json");
    this.codexProfilesRoot = path.join(options.appDataRoot, "codex-profiles");
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
    const profileDir = path.join(this.codexProfilesRoot, sanitizeProfileId(options.profileId));
    const targetPath = path.join(profileDir, "config.toml");
    const content = this.buildCodexProfileContent(options);
    await ensureDirectory(profileDir);
    await backupIfExists(targetPath);
    await fs.writeFile(targetPath, content, "utf8");
    return targetPath;
  }

  buildCodexProfileContent(options: WriteCodexProfileOptions): string {
    const targetModel = options.targetModel.trim();
    const topLevelLines = targetModel
      ? [
          `model = ${JSON.stringify(targetModel)}`,
          `model_provider = ${JSON.stringify(options.providerId)}`,
          "",
        ]
      : [];
    return [
      ...topLevelLines,
      `[model_providers.${options.providerId}]`,
      `name = ${JSON.stringify(options.providerName.trim())}`,
      `base_url = ${JSON.stringify(options.baseUrl.trim())}`,
      `env_key = ${JSON.stringify(options.apiKeyEnv.trim())}`,
      'wire_api = "responses"',
      "",
    ].join("\n");
  }

  getCodexProfilesRoot(): string {
    return this.codexProfilesRoot;
  }
}
