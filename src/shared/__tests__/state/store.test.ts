import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStateStore } from "../../state/store.js";
import { defaultLocalState } from "../../state/local-state.js";

const tempDirs: string[] = [];

async function makeStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "skills-manager-state-"));
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
    state.parameter_settings.launch_timeout_ms = 12345;

    await store.save(state);
    const loaded = await store.load();

    expect(loaded.parameter_settings.launch_timeout_ms).toBe(12345);
    expect(loaded.selected_profile_key).toBe("");
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
        connectivity_tests_by_profile: {},
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
    expect(loaded.parameter_settings.cli_settings.claude.permission_mode).toBe("acceptEdits");
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
        connectivity_tests_by_profile: {},
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
        connectivity_tests_by_profile: {},
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
        connectivity_tests_by_profile: {},
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
