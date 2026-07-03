import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ModelMappingsState } from "../../model-mapping/config-types.js";
import {
  buildCodexProfileDirectoryName,
  buildCodexSiteApiKeyEnv,
  buildCodexSiteProfileName,
  buildCodexSiteProviderId,
  ModelMappingConfigService,
} from "../../services/model-mapping-config-service.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codedeck-model-mapping-"));
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

  it("should write standalone Codex profile configs while keeping base config global-only", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const configPath = path.join(service.getCodexRuntimeHome(), "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    await writeFile(
      configPath,
      '[mcp_servers.playwright]\ncommand = "cmd"\n\n[projects."C:/repo"]\ntrust_level = "trusted"\n',
      "utf8",
    );

    const firstPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Demo Site",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "glm-4.5",
      content: [
        `[profiles.${JSON.stringify(buildCodexSiteProfileName("codex::demo"))}]`,
        'model = "glm-4.5"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Demo Site"',
        'base_url = "https://open.bigmodel.cn/api/paas/v4"',
        `env_key = ${JSON.stringify(buildCodexSiteApiKeyEnv("codex::demo"))}`,
        'wire_api = "responses"',
        "",
      ].join("\n"),
    });

    const secondProfileName = buildCodexSiteProfileName("codex::other");
    const secondPath = await service.writeCodexProfile({
      profileId: "codex::other",
      providerId: buildCodexSiteProviderId("codex::other"),
      providerName: "Other Site",
      baseUrl: "https://api.moonshot.cn/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::other"),
      targetModel: "kimi-k2-0711-preview",
      content: [
        `[profiles.${JSON.stringify(buildCodexSiteProfileName("codex::other"))}]`,
        'model = "kimi-k2-0711-preview"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::other"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::other")}]`,
        'name = "Other Site"',
        'base_url = "https://api.moonshot.cn/v1"',
        `env_key = ${JSON.stringify(buildCodexSiteApiKeyEnv("codex::other"))}`,
        'wire_api = "responses"',
        "",
      ].join("\n"),
    });
    const baseContent = await readFile(configPath, "utf8");
    const firstContent = await readFile(firstPath, "utf8");
    const secondContent = await readFile(secondPath, "utf8");

    expect(firstPath).toBe(path.join(service.getCodexRuntimeHome(), `${buildCodexSiteProfileName("codex::demo")}.config.toml`));
    expect(secondPath).toBe(path.join(service.getCodexRuntimeHome(), `${secondProfileName}.config.toml`));
    expect(baseContent).toContain('[mcp_servers.playwright]');
    expect(baseContent).toContain('[projects."C:/repo"]');
    expect(baseContent).not.toContain("[profiles.");
    expect(baseContent).not.toContain("profile =");
    expect(firstContent).toContain('model = "glm-4.5"');
    expect(firstContent).toContain(`model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`);
    expect(firstContent).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect(firstContent).toContain('base_url = "https://open.bigmodel.cn/api/paas/v4"');
    expect(firstContent).toContain(`env_key = ${JSON.stringify(buildCodexSiteApiKeyEnv("codex::demo"))}`);
    expect(firstContent).toContain('wire_api = "responses"');
    expect(firstContent).not.toContain("[profiles.");
    expect(secondContent).toContain('model = "kimi-k2-0711-preview"');
    expect(secondContent).toContain(`[model_providers.${buildCodexSiteProviderId("codex::other")}]`);
    expect(secondContent).not.toContain("[profiles.");
    expect((await readdir(path.dirname(firstPath))).some((name) => /^config\.toml\.bak\./.test(name))).toBe(false);
  });

  it("should resolve a generic hash-based Codex profile directory without display names", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const directoryName = buildCodexProfileDirectoryName("codex::999Code");
    const profileRoot = service.getCodexProfileRoot("codex::999Code");

    expect(directoryName).toBe("codex-profile-dc74f0e0abf0f9c2");
    expect(directoryName).not.toContain("999Code");
    expect(profileRoot).toBe(path.join(root, "app-data", "codex-profiles", directoryName));
    expect(service.getCodexRuntimeHome()).toBe(path.join(root, "app-data", "codex-runtime", "home"));
    expect(buildCodexSiteProfileName("codex::999Code")).toBe("site-dc74f0e0abf0f9c2");
    expect(buildCodexSiteProviderId("codex::999Code")).toBe("site_provider_dc74f0e0abf0f9c2");
    expect(buildCodexSiteApiKeyEnv("codex::999Code")).toBe("CODEX_SITE_API_KEY_DC74F0E0ABF0F9C2");
    expect(buildCodexSiteProfileName("codex::999Code")).not.toContain("999Code");
    expect(buildCodexSiteProviderId("codex::999Code")).not.toContain("999Code");
  });

  it("should copy legacy Codex profile history into the shared runtime home without removing old directories", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const legacyRoot = service.getLegacyCodexProfileRoot("codex::999Code");
    const hashRoot = service.getCodexProfileRoot("codex::999Code");
    const sharedHome = service.getCodexRuntimeHome();
    await mkdir(path.join(legacyRoot, "sessions", "2026", "05", "06"), { recursive: true });
    await mkdir(path.join(hashRoot, "sessions", "2026", "05", "07"), { recursive: true });
    await writeFile(path.join(legacyRoot, "config.toml"), 'model = "old"\n', "utf8");
    await writeFile(path.join(legacyRoot, "history.jsonl"), "{\"text\":\"old\"}\n", "utf8");
    await writeFile(path.join(hashRoot, "history.jsonl"), "{\"text\":\"new\"}\n{\"text\":\"old\"}\n", "utf8");
    await writeFile(
      path.join(legacyRoot, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-a", thread_name: "旧标题", updated_at: "2026-05-06T10:00:00.000Z" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(hashRoot, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-b", thread_name: "新标题", cwd: "C:/repo", updated_at: "2026-05-07T10:00:00.000Z" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(legacyRoot, "sessions", "2026", "05", "06", "session-a.jsonl"),
      "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-a\"}}\n",
      "utf8",
    );
    await writeFile(
      path.join(hashRoot, "sessions", "2026", "05", "07", "session-b.jsonl"),
      "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-b\"}}\n",
      "utf8",
    );

    await expect(service.ensureCodexRuntimeHome()).resolves.toBe(sharedHome);

    expect(await readFile(path.join(sharedHome, "history.jsonl"), "utf8")).toBe("{\"text\":\"old\"}\n{\"text\":\"new\"}\n");
    expect(await readFile(path.join(sharedHome, "sessions", "2026", "05", "06", "session-a.jsonl"), "utf8"))
      .toContain("session-a");
    expect(await readFile(path.join(sharedHome, "sessions", "2026", "05", "07", "session-b.jsonl"), "utf8"))
      .toContain("session-b");
    const indexContent = await readFile(path.join(sharedHome, "session_index.jsonl"), "utf8");
    expect(indexContent).toContain("session-a");
    expect(indexContent).toContain("session-b");
    expect(await readFile(path.join(legacyRoot, "config.toml"), "utf8")).toBe('model = "old"\n');
  });

  it("should omit Codex model fields when target model is blank", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "",
    });

    const content = await readFile(configPath, "utf8");
    expect(content).not.toContain("model =");
    expect(content).not.toContain("model_provider =");
    expect(content).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect(content).toContain('base_url = "https://api.openai.com/v1"');
    expect(content).not.toContain("[profiles.");
  });

  it("should use the configured Codex wire API and skip git repo check", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
      wireApi: "chat",
      skipGitRepoCheck: true,
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('wire_api = "chat"');
    expect(content).toContain("skip_git_repo_check = true");
  });

  it("should default Codex profile config to responses wire API without skip git repo check", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
    });

    const content = await readFile(configPath, "utf8");
    expect(content).toContain('wire_api = "responses"');
    expect(content).not.toContain("skip_git_repo_check");
  });

  it("should migrate provided legacy Codex profile content into standalone profile config", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const profileName = buildCodexSiteProfileName("codex::demo");
    const baseConfigPath = path.join(service.getCodexRuntimeHome(), "config.toml");
    await mkdir(path.dirname(baseConfigPath), { recursive: true });
    await writeFile(
      baseConfigPath,
      [
        `profile = ${JSON.stringify(profileName)}`,
        "",
        `[profiles.${JSON.stringify(profileName)}]`,
        'model = "old"',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Old Site"',
        "",
        '[projects."C:/repo"]',
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
      content: [
        `profile = ${JSON.stringify(profileName)}`,
        "",
        `[profiles.${JSON.stringify(profileName)}]`,
        'model = "gpt-5.4"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`,
        'sandbox_mode = "workspace-write"',
        'approval_policy = "on-request"',
        'web_search = "live"',
        "",
        `[profiles.${JSON.stringify(profileName)}.sandbox_workspace_write]`,
        "network_access = true",
        'writable_roots = ["C:/repo"]',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Current Site"',
        'base_url = "https://api.openai.com/v1"',
        `env_key = ${JSON.stringify(buildCodexSiteApiKeyEnv("codex::demo"))}`,
        'wire_api = "responses"',
        "",
        "[mcp_servers.playwright]",
        'command = "cmd"',
        "",
      ].join("\n"),
    });

    const profileContent = await readFile(configPath, "utf8");
    const baseContent = await readFile(path.join(service.getCodexRuntimeHome(), "config.toml"), "utf8");

    expect(configPath).toBe(path.join(service.getCodexRuntimeHome(), `${profileName}.config.toml`));
    expect(profileContent).toContain('model = "gpt-5.4"');
    expect(profileContent).toContain(`model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`);
    expect(profileContent).toContain('sandbox_mode = "workspace-write"');
    expect(profileContent).toContain('approval_policy = "on-request"');
    expect(profileContent).toContain('web_search = "live"');
    expect(profileContent).toContain("[sandbox_workspace_write]");
    expect(profileContent).toContain("network_access = true");
    expect(profileContent).toContain('writable_roots = ["C:/repo"]');
    expect(profileContent).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect(profileContent).not.toContain("[profiles.");
    expect(baseContent).toContain("[mcp_servers.playwright]\ncommand = \"cmd\"");
    expect(baseContent).toContain('[projects."C:/repo"]');
    expect(baseContent).not.toContain("[profiles.");
    expect(baseContent).not.toContain("profile =");
    expect(baseContent).not.toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect((await readdir(path.dirname(configPath))).some((name) => /^config\.toml\.bak\./.test(name))).toBe(true);
  });

  it("should preserve Windows sandbox config when rewriting Codex profile configs", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const baseConfigPath = path.join(service.getCodexRuntimeHome(), "config.toml");
    await mkdir(path.dirname(baseConfigPath), { recursive: true });
    await writeFile(
      baseConfigPath,
      [
        '[windows]',
        'sandbox = "unelevated"',
        "",
        '[projects."C:/repo"]',
        'trust_level = "trusted"',
        "",
      ].join("\n"),
      "utf8",
    );

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
    });

    const baseContent = await readFile(baseConfigPath, "utf8");
    const profileContent = await readFile(configPath, "utf8");

    expect(baseContent).toContain("[windows]\nsandbox = \"unelevated\"");
    expect(baseContent).toContain('[projects."C:/repo"]');
    expect(profileContent).toContain("[windows]\nsandbox = \"elevated\"");
  });

  it("should write inherited Codex plugin config into the shared runtime config", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const profileName = buildCodexSiteProfileName("codex::demo");

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      profileName,
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
      content: [
        'model = "gpt-5.4"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Current Site"',
        'base_url = "https://api.openai.com/v1"',
        `env_key = ${JSON.stringify(buildCodexSiteApiKeyEnv("codex::demo"))}`,
        'wire_api = "responses"',
        "",
        "[marketplaces.openai-bundled]",
        'source_type = "local"',
        'source = "C:/Users/me/.codex/.tmp/bundled-marketplaces/openai-bundled"',
        "",
        '[plugins."computer-use@openai-bundled"]',
        "enabled = true",
        "",
      ].join("\n"),
    });

    const baseContent = await readFile(path.join(service.getCodexRuntimeHome(), "config.toml"), "utf8");
    const profileContent = await readFile(configPath, "utf8");

    expect(baseContent).toContain("[marketplaces.openai-bundled]");
    expect(baseContent).toContain('[plugins."computer-use@openai-bundled"]');
    expect(profileContent).not.toContain("[marketplaces.openai-bundled]");
    expect(profileContent).not.toContain('[plugins."computer-use@openai-bundled"]');
  });

  it("should write managed Codex permission rules into the runtime rules directory", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
      rulesContent: [
        "# Managed by CodeDeck.",
        "prefix_rule(",
        '    pattern = ["git", "push"],',
        '    decision = "forbidden",',
        '    justification = "git push is disabled by profile permissions.",',
        ")",
        "",
      ].join("\n"),
    });

    const rulesPath = path.join(service.getCodexRuntimeHome(), "rules", "managed-permissions.rules");
    const rulesContent = await readFile(rulesPath, "utf8").catch(() => "");

    expect(rulesContent).toContain('pattern = ["git", "push"]');
    expect(rulesContent).toContain('decision = "forbidden"');
  });

  it("should avoid backup churn when Codex config content is unchanged", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const options = {
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      apiKeyEnv: buildCodexSiteApiKeyEnv("codex::demo"),
      targetModel: "gpt-5.4",
    };

    const configPath = await service.writeCodexProfile(options);
    await service.writeCodexProfile(options);

    expect((await readdir(path.dirname(configPath))).some((name) => /\.bak\./.test(name))).toBe(false);
  });
});
