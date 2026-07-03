import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStateStore } from "../../state/store.js";
import { defaultLocalState } from "../../state/local-state.js";

const tempDirs: string[] = [];

async function makeStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codedeck-state-"));
  tempDirs.push(dir);
  return new LocalStateStore(path.join(dir, "local_state.json"));
}

describe("LocalStateStore", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("should persist parameter settings independently", async () => {
    const store = await makeStore();
    const state = defaultLocalState();
    state.parameter_settings.inherit_global_capabilities = false;
    state.parameter_settings.connectivity_test_timeout_ms = 12345;

    await store.save(state);
    const loaded = await store.load();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));

    expect(loaded.parameter_settings.inherit_global_capabilities).toBe(false);
    expect(loaded.parameter_settings.connectivity_test_timeout_ms).toBe(12345);
    expect("launch_timeout_ms" in loaded.parameter_settings).toBe(false);
    expect(loaded.selected_profile_key).toBe("");
    expect("connectivity_tests_by_profile" in persisted).toBe(false);
  });

  it("should persist global theme mode", async () => {
    const store = await makeStore();
    const state = defaultLocalState();
    state.global_settings.theme_mode = "dark";

    await store.save(state);
    const loaded = await store.load();

    expect(loaded.global_settings.theme_mode).toBe("dark");
  });

  it("should enable inherited global capabilities by default for legacy state", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        global_settings: defaultLocalState().global_settings,
        parameter_settings: {
          launch_timeout_ms: 30000,
        },
      }),
      "utf-8",
    );

    const loaded = await store.load();

    expect(loaded.parameter_settings.inherit_global_capabilities).toBe(true);
    expect("launch_timeout_ms" in loaded.parameter_settings).toBe(false);
  });

  it("should normalize global working directory favorites", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        global_settings: defaultLocalState().global_settings,
        working_directory_favorites: [
          " C:/workspace/alpha ",
          "",
          "C:/workspace/beta",
          "C:/workspace/alpha",
          123,
        ],
      }),
      "utf-8",
    );

    const loaded = await store.load();
    await store.save(loaded);
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));

    expect(loaded.working_directory_favorites).toEqual([
      "C:/workspace/alpha",
      "C:/workspace/beta",
    ]);
    expect(persisted.working_directory_favorites).toEqual([
      "C:/workspace/alpha",
      "C:/workspace/beta",
    ]);
  });

  it("should normalize saved session favorites and de-duplicate by source", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "codex",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        global_settings: defaultLocalState().global_settings,
        session_favorites: [
          {
            provider: "codex",
            session_id: " codex-fav-1 ",
            cwd: " C:/repo-codex ",
            updated_at: "2026-06-13T08:00:00.000Z",
            preview: " Important Codex session ",
            source_kind: "global_codex",
            source_home: " C:/Users/99395/.codex ",
            favorited_at: "2026-06-13T09:00:00.000Z",
            user_prompts: [" first prompt ", "", 42],
            conversation_excerpts: [
              { role: "user", text: " first prompt " },
              { role: "assistant", text: " first answer " },
              { role: "tool", text: "ignored" },
            ],
          },
          {
            provider: "codex",
            session_id: "codex-fav-1",
            cwd: "C:/repo-codex-duplicate",
            updated_at: "2026-06-13T08:30:00.000Z",
            preview: "Duplicate",
            source_kind: "global_codex",
            source_home: "C:/Users/99395/.codex",
            favorited_at: "2026-06-13T09:30:00.000Z",
          },
          {
            provider: "unknown",
            session_id: "bad-provider",
            cwd: "C:/repo",
            updated_at: "2026-06-13T08:00:00.000Z",
            preview: "Bad provider",
            favorited_at: "2026-06-13T09:00:00.000Z",
          },
        ],
      }),
      "utf-8",
    );

    const loaded = await store.load();
    await store.save(loaded);
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));

    expect((loaded as unknown as { session_favorites: unknown[] }).session_favorites).toEqual([
      {
        favorite_key: "codex|global_codex|C:/Users/99395/.codex|codex-fav-1",
        provider: "codex",
        session_id: "codex-fav-1",
        cwd: "C:/repo-codex",
        updated_at: "2026-06-13T08:00:00.000Z",
        preview: "Important Codex session",
        source_kind: "global_codex",
        source_home: "C:/Users/99395/.codex",
        favorited_at: "2026-06-13T09:00:00.000Z",
        user_prompts: ["first prompt"],
        conversation_excerpts: [
          { role: "user", text: "first prompt" },
          { role: "assistant", text: "first answer" },
        ],
      },
    ]);
    expect(persisted.session_favorites).toEqual(
      (loaded as unknown as { session_favorites: unknown[] }).session_favorites,
    );
  });

  it("should persist balance check snapshots by profile", async () => {
    const store = await makeStore();
    const state = defaultLocalState();
    state.balance_checks_by_profile["codex::Relay"] = {
      provider: "codex",
      profile_name: "Relay",
      base_url: "https://relay.example.com",
      running: false,
      supported: true,
      success: true,
      message: "",
      items: [
        {
          label: "USD",
          remaining: 12.34,
          total: 20,
          used: 7.66,
          unit: "$",
        },
      ],
      endpoint: "https://relay.example.com/api/user/self",
      finished_at_display: "2026/05/05 12:00:00",
    };

    await store.save(state);
    const loaded = await store.load();

    expect(loaded.balance_checks_by_profile["codex::Relay"]).toEqual(
      state.balance_checks_by_profile["codex::Relay"],
    );
  });

  it("should ignore legacy connectivity test snapshots and stop writing them", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "codex",
        selected_profile_key: "codex::Relay",
        selected_profile_key_by_provider: { codex: "codex::Relay" },
        profile_order_by_provider: { codex: ["codex::Relay"] },
        runtime_by_profile: {},
        connectivity_tests_by_profile: {
          "codex::Relay": {
            provider: "codex",
            profile_name: "Relay",
            base_url: "https://relay.example.com",
            running: false,
            success: true,
            message: "ok",
            command_used: "codex",
            finished_at_display: "2026/05/05 12:00:00",
          },
        },
        global_settings: defaultLocalState().global_settings,
      }),
      "utf-8",
    );

    const loaded = await store.load();
    await store.save(loaded);
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));

    expect("connectivity_tests_by_profile" in loaded).toBe(false);
    expect("connectivity_tests_by_profile" in persisted).toBe(false);
  });

  it("should persist sessions tab scope and restore profile selections by provider", async () => {
    const store = await makeStore();
    const state = defaultLocalState();
    state.sessions_tab_scope_by_provider = {
      claude: "global_recent",
      codex: "project",
    };
    state.sessions_tab_restore_profile_key_by_provider = {
      claude: "claude::Official",
      codex: "codex::OpenAI",
    };

    await store.save(state);
    const loaded = await store.load();

    expect(loaded.sessions_tab_scope_by_provider).toEqual({
      claude: "global_recent",
      codex: "global_recent",
    });
    expect(loaded.sessions_tab_restore_profile_key_by_provider).toEqual({
      claude: "claude::Official",
      codex: "codex::OpenAI",
    });

    const rawPath = (store as unknown as { filePath: string }).filePath;
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));
    expect(persisted.sessions_tab_scope_by_provider).toEqual({
      claude: "global_recent",
      codex: "global_recent",
    });
  });

  it("should normalize legacy project sessions tab scope on load", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "codex",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        global_settings: defaultLocalState().global_settings,
        sessions_tab_scope_by_provider: {
          codex: "project",
          claude: "global_recent",
        },
        sessions_tab_restore_profile_key_by_provider: {},
      }),
      "utf-8",
    );

    const loaded = await store.load();

    expect(loaded.sessions_tab_scope_by_provider).toEqual({
      codex: "global_recent",
      claude: "global_recent",
    });
  });

  it("should normalize legacy quoted parameter settings strings", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "",
        selected_profile_key_by_provider: {},
        profile_order_by_provider: {},
        runtime_by_profile: {},
        global_settings: defaultLocalState().global_settings,
        parameter_settings: {
          ...defaultLocalState().parameter_settings,
          cli_settings: {
            claude: {
              setting_sources: "'project,local'",
              permission_mode: "'acceptEdits'",
            },
            codex: {
              wire_api: "'responses'",
              skip_git_repo_check: false,
            },
          },
        },
      }),
      "utf-8",
    );

    const loaded = await store.load();

    expect(loaded.parameter_settings.cli_settings.claude.setting_sources).toBe("project,local");
    expect("permission_mode" in loaded.parameter_settings.cli_settings.claude).toBe(false);
    expect(loaded.parameter_settings.cli_settings.codex.wire_api).toBe("responses");
  });

  it("should keep loading old runtime entries without requiring runtime proxy", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "claude::Official",
        selected_profile_key_by_provider: { claude: "claude::Official" },
        profile_order_by_provider: { claude: ["claude::Official"] },
        runtime_by_profile: {
          "claude::Official": {
            proxy: "http://127.0.0.1:7890",
            cwd: "C:/repo",
            command_base: "claude",
            model: "",
            launch_mode: "new",
            extra_args: "",
            exclude_user_settings: true,
          },
        },
        global_settings: defaultLocalState().global_settings,
      }),
      "utf-8",
    );

    const loaded = await store.load();

    expect(loaded.runtime_by_profile["claude::Official"]).toEqual({
      cwd: "C:/repo",
      command_base: "claude",
      model: "",
      settings_file: "",
      launch_mode: "new",
      extra_args: "",
      extra_env: {},
      exclude_user_settings: true,
    });
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));
    expect(persisted.runtime_by_profile["claude::Official"].proxy).toBe("http://127.0.0.1:7890");
  });

  it("should keep loading legacy global model mappings but stop writing them on save", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "claude",
        selected_profile_key: "claude::Official",
        selected_profile_key_by_provider: { claude: "claude::Official" },
        profile_order_by_provider: { claude: ["claude::Official"] },
        runtime_by_profile: {
          "claude::Official": {
            cwd: "C:/repo",
            command_base: "claude",
            model: "claude-sonnet-4.6",
            launch_mode: "new",
            extra_args: "",
            exclude_user_settings: true,
          },
        },
        global_settings: defaultLocalState().global_settings,
        model_mappings: [
          {
            id: "legacy-1",
            provider: "claude",
            pattern: "sonnet",
            target_model: "legacy-target",
            display_name: "Legacy",
            enabled: true,
            priority: 1,
          },
        ],
      }),
      "utf-8",
    );

    const loaded = await store.load();
    expect(loaded.model_mappings).toHaveLength(1);

    await store.save(loaded);
    const persisted = JSON.parse(await readFile(rawPath, "utf-8"));

    expect("model_mappings" in persisted).toBe(false);
  });

  it("should drop cross-provider selected keys when loading invalid remembered selections", async () => {
    const store = await makeStore();
    const rawPath = (store as unknown as { filePath: string }).filePath;
    await writeFile(
      rawPath,
      JSON.stringify({
        selected_provider: "codex",
        selected_profile_key: "claude::Official",
        selected_profile_key_by_provider: {
          codex: "claude::Official",
          claude: "claude::Official",
        },
        profile_order_by_provider: {
          codex: [],
          claude: ["claude::Official"],
        },
        runtime_by_profile: {
          "claude::Official": {
            cwd: "C:/repo",
            command_base: "claude",
            model: "",
            launch_mode: "new",
            extra_args: "",
            exclude_user_settings: true,
          },
        },
        global_settings: defaultLocalState().global_settings,
      }),
      "utf-8",
    );

    const loaded = await store.load();

    expect(loaded.selected_provider).toBe("codex");
    expect(loaded.selected_profile_key).toBe("");
    expect(loaded.selected_profile_key_by_provider.codex).toBeUndefined();
    expect(loaded.selected_profile_key_by_provider.claude).toBe("claude::Official");
  });
});
