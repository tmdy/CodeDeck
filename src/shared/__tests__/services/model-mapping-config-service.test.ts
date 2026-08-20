import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModelMappingsState } from "../../model-mapping/config-types.js";
import type { Profile } from "../../profile/types.js";
import {
  buildCodexProfileDirectoryName,
  buildCodexSiteProfileName,
  buildCodexSiteProviderId,
  CODEDECK_PROVIDER_REGISTRY_BEGIN,
  CODEDECK_PROVIDER_REGISTRY_END,
  findCodexSiteProfileByProviderId,
  ModelMappingConfigService,
  resolveCodexSiteProviderToken,
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
    codexHome: path.join(root, ".codex"),
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

  it("should write standalone Codex profile configs without changing the user base config", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const configPath = path.join(service.getCodexRuntimeHome(), "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const baseConfig = [
      'profile = "personal"',
      "",
      "[profiles.personal]",
      'model = "gpt-user"',
      "",
      "[model_providers.personal]",
      'name = "Personal"',
      "",
      "[mcp_servers.playwright]",
      'command = "cmd"',
      "",
      '[projects."C:/repo"]',
      'trust_level = "trusted"',
      "",
    ].join("\n");
    await writeFile(configPath, baseConfig, "utf8");

    const firstPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Demo Site",
      baseUrl: "https://open.bigmodel.cn/api/paas/v4",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "glm-4.5",
      content: [
        `[profiles.${JSON.stringify(buildCodexSiteProfileName("codex::demo"))}]`,
        'model = "glm-4.5"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Demo Site"',
        'base_url = "https://open.bigmodel.cn/api/paas/v4"',
        'wire_api = "responses"',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}.auth]`,
        'command = "C:/CodeDeck/codedeck-agent.cmd"',
        `args = ["auth-token", "--provider", ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}]`,
        "",
      ].join("\n"),
    });

    const secondProfileName = buildCodexSiteProfileName("codex::other");
    const secondPath = await service.writeCodexProfile({
      profileId: "codex::other",
      providerId: buildCodexSiteProviderId("codex::other"),
      providerName: "Other Site",
      baseUrl: "https://api.moonshot.cn/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "kimi-k2-0711-preview",
      content: [
        `[profiles.${JSON.stringify(buildCodexSiteProfileName("codex::other"))}]`,
        'model = "kimi-k2-0711-preview"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::other"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::other")}]`,
        'name = "Other Site"',
        'base_url = "https://api.moonshot.cn/v1"',
        'wire_api = "responses"',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::other")}.auth]`,
        'command = "C:/CodeDeck/codedeck-agent.cmd"',
        `args = ["auth-token", "--provider", ${JSON.stringify(buildCodexSiteProviderId("codex::other"))}]`,
        "",
      ].join("\n"),
    });
    const baseContent = await readFile(configPath, "utf8");
    const firstContent = await readFile(firstPath, "utf8");
    const secondContent = await readFile(secondPath, "utf8");

    expect(firstPath).toBe(path.join(service.getCodexRuntimeHome(), `${buildCodexSiteProfileName("codex::demo")}.config.toml`));
    expect(secondPath).toBe(path.join(service.getCodexRuntimeHome(), `${secondProfileName}.config.toml`));
    expect(baseContent).toBe(baseConfig);
    expect(firstContent).toContain('model = "glm-4.5"');
    expect(firstContent).toContain(`model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`);
    expect(firstContent).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect(firstContent).toContain('base_url = "https://open.bigmodel.cn/api/paas/v4"');
    expect(firstContent).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}.auth]`);
    expect(firstContent).not.toContain("env_key");
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
    expect(service.getCodexHome()).toBe(path.join(root, ".codex"));
    expect(buildCodexSiteProfileName("codex::999Code")).toBe("site-dc74f0e0abf0f9c2");
    expect(buildCodexSiteProviderId("codex::999Code")).toBe("site_provider_dc74f0e0abf0f9c2");
    expect(buildCodexSiteProfileName("codex::999Code")).not.toContain("999Code");
    expect(buildCodexSiteProviderId("codex::999Code")).not.toContain("999Code");
  });

  it("should only create the canonical Codex home without migrating legacy profile history", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const legacyRoot = service.getLegacyCodexProfileRoot("codex::999Code");
    const sharedHome = service.getCodexRuntimeHome();
    await mkdir(path.join(legacyRoot, "sessions", "2026", "05", "06"), { recursive: true });
    await writeFile(path.join(legacyRoot, "config.toml"), 'model = "old"\n', "utf8");
    await writeFile(path.join(legacyRoot, "history.jsonl"), "{\"text\":\"old\"}\n", "utf8");
    await writeFile(
      path.join(legacyRoot, "session_index.jsonl"),
      `${JSON.stringify({ id: "session-a", thread_name: "旧标题", updated_at: "2026-05-06T10:00:00.000Z" })}\n`,
      "utf8",
    );
    await writeFile(
      path.join(legacyRoot, "sessions", "2026", "05", "06", "session-a.jsonl"),
      "{\"type\":\"session_meta\",\"payload\":{\"id\":\"session-a\"}}\n",
      "utf8",
    );
    await expect(service.ensureCodexRuntimeHome()).resolves.toBe(sharedHome);

    await expect(readFile(path.join(sharedHome, "history.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(sharedHome, "session_index.jsonl"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(sharedHome, "sessions", "2026", "05", "06", "session-a.jsonl"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(path.join(legacyRoot, "history.jsonl"), "utf8")).toBe("{\"text\":\"old\"}\n");
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
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "",
    });

    const content = await readFile(configPath, "utf8");
    expect(content).not.toContain("model =");
    expect(content).not.toContain("model_provider =");
    expect(content).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}]`);
    expect(content).toContain('base_url = "https://api.openai.com/v1"');
    expect(content).toContain(`[model_providers.${buildCodexSiteProviderId("codex::demo")}.auth]`);
    expect(content).toContain('command = "C:/CodeDeck/codedeck-agent.cmd"');
    expect(content).not.toContain("env_key");
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
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
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
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
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
    const originalBaseConfig = [
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
      ].join("\n");
    await writeFile(baseConfigPath, originalBaseConfig, "utf8");

    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
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
        'wire_api = "responses"',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}.auth]`,
        'command = "C:/CodeDeck/codedeck-agent.cmd"',
        `args = ["auth-token", "--provider", ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}]`,
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
    expect(baseContent).toBe(originalBaseConfig);
    expect((await readdir(path.dirname(configPath))).some((name) => /^config\.toml\.bak\./.test(name))).toBe(false);
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
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-5.4",
    });

    const baseContent = await readFile(baseConfigPath, "utf8");
    const profileContent = await readFile(configPath, "utf8");

    expect(baseContent).toContain("[windows]\nsandbox = \"unelevated\"");
    expect(baseContent).toContain('[projects."C:/repo"]');
    expect(profileContent).toContain("[windows]\nsandbox = \"elevated\"");
  });

  it("should not merge inherited Codex plugin config into the user base config", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const profileName = buildCodexSiteProfileName("codex::demo");

    const baseConfigPath = path.join(service.getCodexHome(), "config.toml");
    const originalBaseConfig = '[plugins."user-plugin@personal"]\nenabled = true\n';
    await mkdir(path.dirname(baseConfigPath), { recursive: true });
    await writeFile(baseConfigPath, originalBaseConfig, "utf8");
    const configPath = await service.writeCodexProfile({
      profileId: "codex::demo",
      profileName,
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-5.4",
      content: [
        'model = "gpt-5.4"',
        `model_provider = ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}`,
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}]`,
        'name = "Current Site"',
        'base_url = "https://api.openai.com/v1"',
        'wire_api = "responses"',
        "",
        `[model_providers.${buildCodexSiteProviderId("codex::demo")}.auth]`,
        'command = "C:/CodeDeck/codedeck-agent.cmd"',
        `args = ["auth-token", "--provider", ${JSON.stringify(buildCodexSiteProviderId("codex::demo"))}]`,
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

    const baseContent = await readFile(baseConfigPath, "utf8");
    const profileContent = await readFile(configPath, "utf8");

    expect(baseContent).toBe(originalBaseConfig);
    expect(profileContent).not.toContain("[marketplaces.openai-bundled]");
    expect(profileContent).not.toContain('[plugins."computer-use@openai-bundled"]');
  });

  it("should leave existing global Codex permission rules unchanged", async () => {
    const root = await makeTempDir();
    const service = createService(root);

    const rulesPath = path.join(service.getCodexHome(), "rules", "managed-permissions.rules");
    await mkdir(path.dirname(rulesPath), { recursive: true });
    await writeFile(rulesPath, "# user-owned rules\n", "utf8");
    await service.writeCodexProfile({
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-5.4",
    });

    expect(await readFile(rulesPath, "utf8")).toBe("# user-owned rules\n");
  });

  it("should leave an existing global Codex worker agent unchanged", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const options = {
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-5.6",
    };

    const workerPath = path.join(service.getCodexHome(), "agents", "codedeck-worker.toml");
    await mkdir(path.dirname(workerPath), { recursive: true });
    await writeFile(workerPath, 'model = "user-model"\n', "utf8");
    await service.writeCodexProfile(options);
    expect(await readFile(workerPath, "utf8")).toBe('model = "user-model"\n');
  });

  it("should avoid backup churn when Codex config content is unchanged", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const options = {
      profileId: "codex::demo",
      providerId: buildCodexSiteProviderId("codex::demo"),
      providerName: "Current Site",
      baseUrl: "https://api.openai.com/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-5.4",
    };

    const configPath = await service.writeCodexProfile(options);
    await service.writeCodexProfile(options);

    expect((await readdir(path.dirname(configPath))).some((name) => /\.bak\./.test(name))).toBe(false);
  });

  it("should write a standalone site config into a dedicated health Codex home", async () => {
    const root = await makeTempDir();
    const healthHome = path.join(
      root,
      "Profile Workspace With Spaces",
      ".codedeck",
      "profile-health",
      "codex-home",
    );
    const service = new ModelMappingConfigService({
      appDataRoot: path.join(root, "app-data"),
      codexHome: healthHome,
    });

    const configPath = await service.writeCodexProfile({
      profileId: "codex::health",
      providerId: buildCodexSiteProviderId("codex::health"),
      providerName: "Health Site",
      baseUrl: "https://relay.example/v1",
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      targetModel: "gpt-health",
    });

    expect(path.dirname(configPath)).toBe(healthHome);
    expect(await readFile(configPath, "utf8")).toContain('model = "gpt-health"');
  });

  it("should resolve the native provider from top-level config with the official fallback", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const configPath = path.join(service.getCodexHome(), "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });

    await expect(service.resolveNativeCodexModelProvider()).resolves.toBe("openai");
    await writeFile(configPath, 'model_provider = "openai_http"\n\n[profiles.demo]\nmodel_provider = "ignored"\n', "utf8");
    await expect(service.resolveNativeCodexModelProvider()).resolves.toBe("openai_http");
  });

  it("should map only an exact stable provider id to one saved Codex site Profile", () => {
    const profiles: Profile[] = [{
      provider: "codex",
      name: "Demo",
      url: "https://example.com/v1",
      key: "secret-value",
    }];
    const providerId = buildCodexSiteProviderId("codex::Demo");

    expect(findCodexSiteProfileByProviderId(profiles, providerId)).toBe(profiles[0]);
    expect(findCodexSiteProfileByProviderId(profiles, providerId.toUpperCase())).toBeUndefined();
    expect(findCodexSiteProfileByProviderId(profiles, "codex::Demo")).toBeUndefined();
    expect(resolveCodexSiteProviderToken(undefined, providerId)).toEqual({
      ok: false,
      code: "store_locked",
    });
    expect(resolveCodexSiteProviderToken(profiles, providerId.toUpperCase())).toEqual({
      ok: false,
      code: "provider_not_found",
    });
    expect(resolveCodexSiteProviderToken(profiles, buildCodexSiteProviderId("codex::Missing"))).toEqual({
      ok: false,
      code: "profile_not_found",
    });
    expect(resolveCodexSiteProviderToken(profiles, providerId)).toEqual({
      ok: true,
      token: "secret-value",
    });
    expect(resolveCodexSiteProviderToken([{ ...profiles[0], key: "" }], providerId)).toEqual({
      ok: false,
      code: "profile_not_found",
    });
  });

  it("should atomically manage provider registry content without changing user bytes", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const configPath = path.join(service.getCodexHome(), "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const userContent = 'model_provider = "openai_http"\r\n\r\n[mcp_servers.demo]\r\ncommand = "demo"\r\n';
    await writeFile(configPath, userContent, "utf8");
    const providerId = buildCodexSiteProviderId("codex::demo");
    const options = {
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      providers: [{
        providerId,
        providerName: "Demo Site",
        baseUrl: "https://example.com/v1",
        wireApi: "responses",
      }],
    };

    await service.syncCodexProviderRegistry(options);
    const first = await readFile(configPath, "utf8");
    expect(first.startsWith(CODEDECK_PROVIDER_REGISTRY_BEGIN)).toBe(true);
    expect(first).toContain(`model_providers.${providerId} = {`);
    expect(first).toContain('auth = { command = "C:/CodeDeck/codedeck-agent.cmd"');
    expect(first).toContain(`args = ["auth-token", "--provider", "${providerId}"]`);
    expect(first).not.toContain("env_key");
    expect(first.slice(first.indexOf(CODEDECK_PROVIDER_REGISTRY_END) + CODEDECK_PROVIDER_REGISTRY_END.length + 2)).toBe(userContent);
    await expect(service.resolveNativeCodexModelProvider()).resolves.toBe("openai_http");

    await service.syncCodexProviderRegistry(options);
    expect(await readFile(configPath, "utf8")).toBe(first);

    await service.syncCodexProviderRegistry({ ...options, providers: [] });
    expect(await readFile(configPath, "utf8")).toBe(userContent);
  });

  it("should reject external provider conflicts and preserve the previous config on write failure", async () => {
    const root = await makeTempDir();
    const service = createService(root);
    const configPath = path.join(service.getCodexHome(), "config.toml");
    await mkdir(path.dirname(configPath), { recursive: true });
    const providerId = buildCodexSiteProviderId("codex::demo");
    const original = `[model_providers.${providerId}]\nname = "User Owned"\n`;
    await writeFile(configPath, original, "utf8");
    const options = {
      authCommand: "C:/CodeDeck/codedeck-agent.cmd",
      providers: [{ providerId, providerName: "Demo", baseUrl: "https://example.com/v1" }],
    };

    await expect(service.syncCodexProviderRegistry(options)).rejects.toThrow("provider_conflict");
    expect(await readFile(configPath, "utf8")).toBe(original);

    const quotedOriginal = `["model_providers" . "${providerId}"]\nname = "User Owned"\n`;
    await writeFile(configPath, quotedOriginal, "utf8");
    await expect(service.syncCodexProviderRegistry(options)).rejects.toThrow("provider_conflict");
    expect(await readFile(configPath, "utf8")).toBe(quotedOriginal);

    await writeFile(configPath, 'model_provider = "openai"\n', "utf8");
    const rename = vi.spyOn(fs, "rename").mockRejectedValueOnce(new Error("rename failed"));
    await expect(service.syncCodexProviderRegistry(options)).rejects.toThrow("rename failed");
    rename.mockRestore();
    expect(await readFile(configPath, "utf8")).toBe('model_provider = "openai"\n');
  });
});
