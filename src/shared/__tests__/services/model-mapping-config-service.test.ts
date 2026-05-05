import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelMappingsState } from "../../model-mapping/config-types.js";
import { ModelMappingConfigService } from "../../services/model-mapping-config-service.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skills-manager-model-mapping-"));
  tempDirs.push(dir);
  return dir;
}

function createService(root: string): ModelMappingConfigService {
  return new ModelMappingConfigService({
    appDataRoot: path.join(root, "app-data"),
  });
}

function findMapping(state: ModelMappingsState, client: "claude" | "codex", alias: string) {
  return state.mappings.find((item) => item.client === client && item.alias === alias);
}

describe("ModelMappingConfigService", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("should initialize without DeepSeek preset providers", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const state = await service.load();

    expect(state.providers).toEqual([]);
    expect(state.selectedClient).toBe("claude");
    expect(findMapping(state, "claude", "default")?.targetModel).toBe("");
  });

  it("should allow saving blank mappings because site official models may not need remapping", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const state = await service.load();

    await expect(service.save(state)).resolves.toEqual(state);
  });

  it("should create a backup when saving over an existing file", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const state = await service.load();
    await service.save(state);

    state.selectedClaudeAlias = "sonnet";
    await service.save(state);

    const appDataRoot = path.join(root, "app-data");
    const saved = await readFile(path.join(appDataRoot, "model-mappings.json"), "utf8");
    expect(saved).toContain("\"selectedClaudeAlias\": \"sonnet\"");
    expect((await readdir(appDataRoot)).some((name) => /^model-mappings\.json\.bak\./.test(name))).toBe(true);
  });

  it("should keep loading legacy local_state model_mappings without re-saving them into the new file", async () => {
    const root = await makeTempDir();
    const appDataRoot = path.join(root, "app-data");
    await mkdir(appDataRoot, { recursive: true });
    await writeFile(
      path.join(appDataRoot, "local_state.json"),
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        connectivity_tests_by_profile: {},
        global_settings: {},
        parameter_settings: {},
        model_mappings: [{ id: "legacy-rule" }],
      }),
      "utf8",
    );

    const service = createService(root);
    const state = await service.load();
    await service.save(state);

    const saved = JSON.parse(await readFile(path.join(appDataRoot, "model-mappings.json"), "utf8")) as {
      model_mappings?: unknown;
    };
    expect(saved.model_mappings).toBeUndefined();
  });

  it("should write isolated Codex config from the current profile site and create a backup on overwrite", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const firstPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: "current_site",
      providerName: "Current Site",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: "CODEX_SITE_API_KEY",
      targetModel: "glm-4.5",
    });
    expect(await readFile(firstPath, "utf8")).toContain('model = "glm-4.5"');

    const secondPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: "current_site",
      providerName: "Current Site",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKeyEnv: "CODEX_SITE_API_KEY",
      targetModel: "kimi-k2-0711-preview",
    });
    expect(secondPath).toBe(firstPath);
    expect((await readdir(path.dirname(firstPath))).some((name) => /^config\.toml\.bak\./.test(name))).toBe(true);
  });

  it("should omit Codex model fields when target model is blank", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: "current_site",
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: "CODEX_SITE_API_KEY",
      targetModel: "",
    });

    const content = await readFile(configPath, "utf8");
    expect(content).not.toContain("model =");
    expect(content).not.toContain("model_provider =");
    expect(content).toContain("[model_providers.current_site]");
    expect(content).toContain('base_url = "https://api.openai.com/v1"');
  });
});
