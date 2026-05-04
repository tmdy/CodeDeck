import { app, BrowserWindow, dialog, ipcMain } from "electron";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { initializeWorkspace, resolveWorkspaceLayout } from "../src/shared/app-workspace.js";
import { resolveElectronRuntimePaths } from "../src/shared/electron-runtime-paths.js";
import {
  resolveDefaultPaths,
  type PreviewAction,
  SkillsManagerService,
} from "../src/shared/skills-service.js";
import type { ProjectBatchAction, SkillHost } from "../src/shared/types.js";

// ---- Profile 相关导入 ----
import { EncryptedConfigStore } from "../src/shared/crypto/store.js";
import { LocalStateStore } from "../src/shared/state/store.js";
import { ProfileService } from "../src/shared/services/profile-service.js";
import { LaunchService } from "../src/shared/services/launch-service.js";
import { ModelMappingService } from "../src/shared/services/model-mapping-service.js";
import {
  type LocalState,
} from "../src/shared/state/local-state.js";
import type { Profile, ProfileKey, RuntimeSettings, GlobalSettings } from "../src/shared/profile/types.js";
import { itemKey } from "../src/shared/profile/keys-internal.js";
import type { LaunchRequest, CommandPreview } from "../src/shared/launcher/types.js";
import type { ConnectivityTestState } from "../src/shared/connectivity/types.js";
import type { ModelMappingEntry } from "../src/shared/model-mapping/types.js";
import type { ParameterSettings } from "../src/shared/parameter/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- 应用路径常量 ----
const ENCRYPTED_DATA_FILE = "claude_profiles.encrypted.json";
const LEGACY_DATA_FILE = "profiles.json";
const LOCAL_STATE_FILE = "local_state.json";
const CONFIG_PASSWORD_ENV = "CLAUDE_PROFILE_LAUNCHER_PASSPHRASE";

const appRoot = process.cwd();
let projectRoot = process.cwd();
let skillsService: SkillsManagerService | null = null;

// ---- Profile 服务实例 ----
let profileService: ProfileService | null = null;
let launchService: LaunchService | null = null;
let modelMappingService: ModelMappingService | null = null;
let encryptedStore: EncryptedConfigStore | null = null;
let localStateStore: LocalStateStore | null = null;
let currentPassphrase: string = "";

// ---- Skills 服务 ----

async function initSkillsService(): Promise<void> {
  const layout = resolveWorkspaceLayout({
    cwd: process.cwd(),
    envProjectRoot: process.env.SKILLS_MANAGER_PROJECT_ROOT,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.isPackaged ? app.getPath("userData") : path.join(os.homedir(), ".skills-manager"),
  });
  await initializeWorkspace(layout);
  projectRoot = layout.workspaceRoot;
  skillsService = new SkillsManagerService(resolveDefaultPaths(projectRoot));
}

function getSkillsService(): SkillsManagerService {
  if (!skillsService) throw new Error("Skills 服务尚未初始化。");
  return skillsService;
}

function getProfileService(): ProfileService {
  if (!profileService) throw new Error("Profile 服务尚未初始化。");
  return profileService;
}

function getLaunchService(): LaunchService {
  if (!launchService) throw new Error("Launch 服务尚未初始化。");
  return launchService;
}

function getModelMappingService(): ModelMappingService {
  if (!modelMappingService) throw new Error("Model Mapping 服务尚未初始化。");
  return modelMappingService;
}

function getPassphrase(): string {
  return currentPassphrase || process.env[CONFIG_PASSWORD_ENV] || "";
}

// ---- 初始化 Profile 服务 ----

async function initProfileServices(): Promise<void> {
  const appDataDir = path.join(projectRoot, "app-data");

  // 加密配置存储
  const encryptedPath = path.join(appDataDir, ENCRYPTED_DATA_FILE);
  const legacyPaths = [
    path.join(projectRoot, LEGACY_DATA_FILE),
    path.join(projectRoot, ENCRYPTED_DATA_FILE),
  ];
  encryptedStore = new EncryptedConfigStore(encryptedPath, legacyPaths);

  // 本地状态存储
  const statePath = path.join(appDataDir, LOCAL_STATE_FILE);
  localStateStore = new LocalStateStore(statePath);
}

async function loadProfilesAndState(
  passphrase: string,
): Promise<{ profiles: Profile[]; state: LocalState }> {
  if (!encryptedStore || !localStateStore) {
    throw new Error("存储未初始化");
  }

  const profiles = await encryptedStore.load(passphrase);
  const state = await localStateStore.load();

  return { profiles, state };
}

class StateAccessor {
  constructor(private store: LocalStateStore, private currentState: LocalState) {}

  get(): LocalState {
    return this.currentState;
  }

  async save(state: LocalState): Promise<void> {
    this.currentState = state;
    await this.store.save(state);
    // 通知渲染进程
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("profile:state-changed", state);
    }
  }
}

class SyncStoreAdapter {
  constructor(
    private store: EncryptedConfigStore,
    private getPassphrase: () => string,
  ) {}

  async saveProfiles(profiles: Profile[]): Promise<void> {
    const pw = this.getPassphrase();
    if (pw && this.store) {
      await this.store.save(profiles, pw);
    }
  }
}

// ---- 窗口 ----

function resolveWindowIconPath(): string | undefined {
  const candidates = resolveElectronRuntimePaths({
    appRoot,
    workspaceRoot: projectRoot,
    isPackaged: app.isPackaged,
    mainDirname: __dirname,
    resourcesPath: process.resourcesPath,
  }).iconCandidates;
  return candidates[0];
}

function resolveDistIndexPath(): string {
  return resolveElectronRuntimePaths({
    appRoot,
    workspaceRoot: projectRoot,
    isPackaged: app.isPackaged,
    mainDirname: __dirname,
    resourcesPath: process.resourcesPath,
  }).distIndexPath;
}

function getPreloadPath(): string {
  return resolveElectronRuntimePaths({
    appRoot,
    workspaceRoot: projectRoot,
    isPackaged: app.isPackaged,
    mainDirname: __dirname,
    resourcesPath: process.resourcesPath,
  }).preloadPath;
}

async function createUnlockWindow(): Promise<string> {
  return new Promise((resolve) => {
    const unlockWin = new BrowserWindow({
      width: 480,
      height: 360,
      resizable: false,
      frame: false,
      backgroundColor: "#f2efe7",
      icon: resolveWindowIconPath(),
      webPreferences: {
        preload: getPreloadPath(),
        sandbox: false,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    // 处理解锁请求
    const unlockHandler = async (_event: Electron.IpcMainInvokeEvent, passphrase: string) => {
      try {
        if (!encryptedStore || !localStateStore) {
          await initProfileServices();
        }
        const { profiles, state } = await loadProfilesAndState(passphrase!);
        currentPassphrase = passphrase!;

        // 创建 Profile 服务
        const stateAccessor = new StateAccessor(localStateStore!, state);
        const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase());
        profileService = new ProfileService(profiles, stateAccessor, syncStore);
        launchService = new LaunchService(profileService);
        modelMappingService = new ModelMappingService(stateAccessor);

        unlockWin.close();
        resolve(passphrase!);
      } catch (err: any) {
        // 密码错误，通知渲染进程
        unlockWin.webContents.send("profile:unlock-error", err.message || "解锁失败");
      }
    };

    ipcMain.handle("profile:unlock", unlockHandler);

    // 没有加密配置时允许跳过
    ipcMain.handle("profile:check-encrypted-config", () => {
      return encryptedStore?.exists() ?? false;
    });

    ipcMain.handle("profile:skip-unlock", async () => {
      // 跳过加密，使用空配置
      if (!localStateStore) {
        await initProfileServices();
      }
      const state = await localStateStore!.load();
      const stateAccessor = new StateAccessor(localStateStore!, state);
      profileService = new ProfileService([], stateAccessor, null);
      launchService = new LaunchService(profileService);
      modelMappingService = new ModelMappingService(stateAccessor);

      unlockWin.close();
      resolve("");
    });

    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      unlockWin.loadURL(`${devServerUrl}#/unlock`);
    } else {
      unlockWin.loadFile(resolveDistIndexPath(), {
        hash: "/unlock",
      });
    }
  });
}

async function createMainWindow(): Promise<void> {
  const browserWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    backgroundColor: "#f2efe7",
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    await browserWindow.loadURL(devServerUrl);
    return;
  }

  await browserWindow.loadFile(resolveDistIndexPath());
}

// ---- 注册所有 IPC 处理器 ----

function registerAllIpcHandlers(): void {
  // ============ Skills Manager IPC（保持不变） ============
  ipcMain.handle("skills-manager:scan", async () => getSkillsService().scanEnvironment());
  ipcMain.handle(
    "skills-manager:update-skill-user-tags",
    async (_event, skillId: string, tags: string[]) =>
      getSkillsService().updateSkillUserTags(skillId, tags),
  );
  ipcMain.handle("skills-manager:pick-project-directory", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    const result = browserWindow
      ? await dialog.showOpenDialog(browserWindow, {
          title: "选择项目文件夹",
          properties: ["openDirectory", "createDirectory"],
        })
      : await dialog.showOpenDialog({
          title: "选择项目文件夹",
          properties: ["openDirectory", "createDirectory"],
        });
    return result.canceled ? undefined : result.filePaths[0];
  });
  ipcMain.handle("skills-manager:select-project", async (_event, projectPath: string) =>
    getSkillsService().selectProject(projectPath),
  );
  ipcMain.handle("skills-manager:clear-current-project-selection", async () =>
    getSkillsService().clearCurrentProjectSelection(),
  );
  ipcMain.handle(
    "skills-manager:scan-project",
    async (_event, projectPath?: string) =>
      getSkillsService().scanProjectSkills(projectPath),
  );
  ipcMain.handle(
    "skills-manager:preview",
    async (_event, action: PreviewAction, skillIds: string[]) =>
      getSkillsService().createPreview(action, skillIds),
  );
  ipcMain.handle(
    "skills-manager:execute",
    async (_event, action: PreviewAction, skillIds: string[]) =>
      getSkillsService().executeBatch(action, skillIds),
  );
  ipcMain.handle(
    "skills-manager:project-preview",
    async (_event, host: SkillHost, skillIds: string[], action: ProjectBatchAction) =>
      getSkillsService().createProjectPreview(host, skillIds, action),
  );
  ipcMain.handle(
    "skills-manager:project-execute",
    async (_event, host: SkillHost, skillIds: string[], action: ProjectBatchAction) =>
      getSkillsService().executeProjectBatch(host, skillIds, action),
  );
  ipcMain.handle("skills-manager:rollback-last-batch", async () =>
    getSkillsService().rollbackLastSuccessfulBatch(),
  );

  // ============ Profile IPC ============

  // 加密 & 认证
  ipcMain.handle("profile:check-encrypted-config", () => {
    return encryptedStore?.exists() ?? false;
  });

  ipcMain.handle(
    "profile:initialize-encryption",
    async (_event, passphrase: string) => {
      if (!encryptedStore || !localStateStore) {
        await initProfileServices();
      }
      currentPassphrase = passphrase;
      const state = await localStateStore!.load();
      const stateAccessor = new StateAccessor(localStateStore!, state);
      const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase());
      profileService = new ProfileService([], stateAccessor, syncStore);
      launchService = new LaunchService(profileService);
      modelMappingService = new ModelMappingService(stateAccessor);
      return { success: true };
    },
  );

  // Profile CRUD
  ipcMain.handle("profile:list", () => {
    const svc = getProfileService();
    return {
      profiles: svc.getProfiles(),
      state: svc.getState(),
    };
  });

  ipcMain.handle(
    "profile:save",
    async (
      _event,
      targetKey: ProfileKey,
      draft: Profile,
      runtime: RuntimeSettings,
    ) => {
      return getProfileService().saveProfile(targetKey, draft, runtime);
    },
  );

  ipcMain.handle("profile:delete", async (_event, key: ProfileKey) => {
    await getProfileService().deleteProfile(key);
  });

  ipcMain.handle(
    "profile:clone",
    async (_event, sourceKey: ProfileKey, targetProvider: string) => {
      return getProfileService().cloneProfileToProvider(sourceKey, targetProvider);
    },
  );

  ipcMain.handle(
    "profile:select",
    async (_event, provider: string, key: ProfileKey) => {
      await getProfileService().selectProfile(provider, key);
    },
  );

  ipcMain.handle(
    "profile:reorder",
    async (_event, provider: string, orderedKeys: ProfileKey[]) => {
      await getProfileService().reorderProfiles(provider, orderedKeys);
    },
  );

  ipcMain.handle(
    "profile:activate-provider",
    async (_event, provider: string) => {
      await getProfileService().activateProvider(provider);
    },
  );

  // Launcher
  ipcMain.handle(
    "launcher:preview-for-draft",
    (_event, draft: Profile, runtime: RuntimeSettings): CommandPreview => {
      const svc = getLaunchService();
      return svc.buildPreview(draft, runtime);
    },
  );

  ipcMain.handle(
    "launcher:preview-for-profile",
    (_event, profileKey: ProfileKey): CommandPreview => {
      const svc = getLaunchService();
      const profiles = getProfileService().getProfiles();
      const profile = profiles.find((p) => itemKey(p) === profileKey);
      if (!profile) return { command: "", valid: false };

      const state = getProfileService().getState();
      const runtime = state.runtime_by_profile[profileKey] ?? {
        proxy: "",
        cwd: "",
        command_base: "",
        model: "",
        launch_mode: "direct",
        extra_args: "",
        exclude_user_settings: false,
      };
      return svc.buildPreview(profile, runtime);
    },
  );

  ipcMain.handle("launcher:launch", async (_event, request: LaunchRequest) => {
    // 启动终端
    const { spawn } = await import("node:child_process");

    const preview = getLaunchService().previewForRequest(request);
    if (!preview.valid) {
      throw new Error("无法生成启动命令");
    }

    // Windows: 使用 start cmd 启动
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "cmd", "/k", preview.command], {
        detached: true,
        stdio: "ignore",
      });
    } else {
      // macOS/Linux
      spawn("sh", ["-c", preview.command], {
        detached: true,
        stdio: "ignore",
      });
    }
  });

  // Sessions
  ipcMain.handle(
    "session:list",
    async (_event, _provider: string, _cwd: string) => {
      // 基础实现：返回空列表，完整实现在第5层
      return [];
    },
  );

  ipcMain.handle("session:refresh", async (_event, _provider: string) => {
    // 异步刷新会话索引
  });

  // Connectivity
  ipcMain.handle(
    "connectivity:test",
    async (_event, profileKey: ProfileKey) => {
      // 异步连接测试
      const profile = getProfileService()
        .getProfiles()
        .find((p) => itemKey(p) === profileKey);
      if (!profile) throw new Error("Profile 不存在");

      // 通知渲染进程测试开始
      const progress: ConnectivityTestState = {
        provider: profile.provider,
        profile_name: profile.name,
        base_url: profile.url,
        running: true,
        success: false,
        message: "正在测试连接...",
        command_used: "",
        finished_at_display: "",
      };
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send("connectivity:test-progress", profileKey, progress);
      });

      // TODO: 实际连接测试实现
      // 这里先做一个简单的模拟
      setTimeout(() => {
        const final: ConnectivityTestState = {
          ...progress,
          running: false,
          success: true,
          message: "连接测试功能开发中",
          finished_at_display: new Date().toLocaleString(),
        };
        BrowserWindow.getAllWindows().forEach((win) => {
          win.webContents.send("connectivity:test-progress", profileKey, final);
        });
      }, 1000);
    },
  );

  ipcMain.handle(
    "connectivity:get-state",
    (_event, profileKey: ProfileKey): ConnectivityTestState => {
      const state = getProfileService().getState();
      return (
        state.connectivity_tests_by_profile[profileKey] ?? {
          provider: "",
          profile_name: "",
          base_url: "",
          running: false,
          success: false,
          message: "",
          command_used: "",
          finished_at_display: "",
        }
      );
    },
  );

  // Model Mapping
  ipcMain.handle("model-mapping:list", () => getModelMappingService().list());

  ipcMain.handle(
    "model-mapping:add",
    async (_event, entry: Omit<ModelMappingEntry, "id">) =>
      getModelMappingService().add(entry),
  );

  ipcMain.handle(
    "model-mapping:update",
    async (_event, id: string, update: Partial<ModelMappingEntry>) =>
      getModelMappingService().update(id, update),
  );

  ipcMain.handle(
    "model-mapping:delete",
    async (_event, id: string) => getModelMappingService().delete(id),
  );

  ipcMain.handle(
    "model-mapping:resolve",
    (_event, provider: string, model: string) =>
      getModelMappingService().resolve(provider, model),
  );

  // Parameter Settings
  ipcMain.handle("parameter:get", (): ParameterSettings => {
    return getProfileService().getState().parameter_settings;
  });

  ipcMain.handle(
    "parameter:update",
    async (_event, settings: Partial<ParameterSettings>) => {
      const svc = getProfileService();
      const st = svc.getState();
      st.parameter_settings = { ...st.parameter_settings, ...settings };
      await svc.saveProfile(
        st.selected_profile_key,
        svc.getProfiles().find((p) => itemKey(p) === st.selected_profile_key)!,
        st.runtime_by_profile[st.selected_profile_key] ?? {
          proxy: "",
          cwd: "",
          command_base: "",
          model: "",
          launch_mode: "direct",
          extra_args: "",
          exclude_user_settings: false,
        },
      );
      return st.parameter_settings;
    },
  );

  // Global Settings
  ipcMain.handle("settings:get-global", (): GlobalSettings => {
    return getProfileService().getState().global_settings;
  });

  ipcMain.handle(
    "settings:update-global",
    async (_event, settings: Partial<GlobalSettings>) => {
      const svc = getProfileService();
      const st = svc.getState();
      st.global_settings = { ...st.global_settings, ...settings };
      const profiles = svc.getProfiles();
      const currentProfile = profiles.find(
        (p) => itemKey(p) === st.selected_profile_key,
      );
      if (currentProfile) {
        await svc.saveProfile(
          st.selected_profile_key,
          currentProfile,
          st.runtime_by_profile[st.selected_profile_key] ?? {
            proxy: "",
            cwd: "",
            command_base: "",
            model: "",
            launch_mode: "direct",
            extra_args: "",
            exclude_user_settings: false,
          },
        );
      }
      return st.global_settings;
    },
  );
}

// ---- 应用生命周期 ----

app.setAppUserModelId("com.local.skillsmanager");

app.whenReady().then(async () => {
  // 1. 初始化 Skills 工作区
  await initSkillsService();

  // 2. 初始化 Profile 存储
  await initProfileServices();

  // 3. 检查加密配置
  const hasEncryptedConfig = encryptedStore?.exists() ?? false;

  if (hasEncryptedConfig) {
    // 显示解锁窗口
    await createUnlockWindow();
  } else {
    // 无加密配置，直接初始化
    const state = await localStateStore!.load();
    const stateAccessor = new StateAccessor(localStateStore!, state);
    profileService = new ProfileService([], stateAccessor, null);
    launchService = new LaunchService(profileService);
    modelMappingService = new ModelMappingService(stateAccessor);
  }

  // 4. 注册所有 IPC 处理器
  registerAllIpcHandlers();

  // 5. 创建主窗口
  await createMainWindow();

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
