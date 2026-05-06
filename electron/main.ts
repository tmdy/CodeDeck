import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
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
import { SettingsStateService, type SessionsTabStatePatch } from "../src/shared/services/settings-state-service.js";
import { ModelMappingConfigService } from "../src/shared/services/model-mapping-config-service.js";
import { ModelCatalogService } from "../src/shared/services/model-catalog-service.js";
import { BalanceService, normalizeBalanceBaseUrl } from "../src/shared/services/balance-service.js";
import {
  resolveBalanceAuth,
  type SiteBalanceSessionDraft,
  type SiteBalanceSessionsByBaseUrl,
} from "../src/shared/balance/site-balance-sessions.js";
import { pickDirectoryPath } from "../src/shared/electron/dialog-helpers.js";
import { executeLaunchPlan, type ExternalTerminalLaunchSpec } from "../src/shared/electron/launch-runtime.js";
import { resolveBaseUrlExternalTarget } from "../src/shared/electron/open-url.js";
import { listSessionsForProvider, type ListSessionsRequest } from "../src/shared/services/session-service.js";
import {
  type LocalState,
} from "../src/shared/state/local-state.js";
import {
  defaultRuntimeSettings,
  type Profile,
  type ProfileKey,
  type RuntimeSettings,
  type GlobalSettings,
} from "../src/shared/profile/types.js";
import { itemKey } from "../src/shared/profile/keys-internal.js";
import type { LaunchRequest, CommandPreview } from "../src/shared/launcher/types.js";
import type { ConnectivityTestState } from "../src/shared/connectivity/types.js";
import {
  defaultBalanceCheckState,
  type BalanceCheckState,
} from "../src/shared/balance/types.js";
import type { ParameterSettings } from "../src/shared/parameter/types.js";
import type { ModelMappingsState } from "../src/shared/model-mapping/config-types.js";

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
let settingsStateService: SettingsStateService | null = null;
let modelMappingConfigService: ModelMappingConfigService | null = null;
let modelCatalogService: ModelCatalogService | null = null;
let balanceService: BalanceService | null = null;
let modelMappingsStateCache: ModelMappingsState | null = null;
let encryptedStore: EncryptedConfigStore | null = null;
let localStateStore: LocalStateStore | null = null;
let profileStateAccessor: StateAccessor | null = null;
let currentPassphrase: string = "";
let mainWindow: BrowserWindow | null = null;
let isTransitioningFromUnlock = false;

function writeDebugLog(message: string): void {
  try {
    const dir = path.join(projectRoot || process.cwd(), "app-data");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "unlock-debug.log");
    const line = `[${new Date().toISOString()}] ${message}\n`;
    appendFileSync(file, line, "utf-8");
  } catch {
    // ignore logging failures
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

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

function getSettingsStateService(): SettingsStateService {
  if (!settingsStateService) throw new Error("Settings 服务尚未初始化。");
  return settingsStateService;
}

function getModelMappingConfigService(): ModelMappingConfigService {
  if (!modelMappingConfigService) throw new Error("Model Mapping Config 服务尚未初始化。");
  return modelMappingConfigService;
}

function getModelCatalogService(): ModelCatalogService {
  if (!modelCatalogService) throw new Error("Model Catalog 服务尚未初始化。");
  return modelCatalogService;
}

function getBalanceService(): BalanceService {
  if (!balanceService) throw new Error("Balance 服务尚未初始化。");
  return balanceService;
}

function getProfileStateAccessor(): StateAccessor {
  if (!profileStateAccessor) throw new Error("Profile 状态访问器尚未初始化。");
  return profileStateAccessor;
}

function getPassphrase(): string {
  return currentPassphrase || process.env[CONFIG_PASSWORD_ENV] || "";
}

function currentModelMappingsState(): ModelMappingsState {
  if (!modelMappingsStateCache) {
    throw new Error("Model mappings state 尚未初始化。");
  }
  return modelMappingsStateCache;
}

async function directoryExists(targetPath: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  try {
    const stat = await fs.stat(targetPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function commandExists(commandBase: string): Promise<boolean> {
  const fs = await import("node:fs/promises");
  const candidate = commandBase.trim();
  if (!candidate) {
    return false;
  }
  if (candidate.includes("/") || candidate.includes("\\") || /^[a-zA-Z]:/.test(candidate)) {
    try {
      await fs.access(candidate);
      return true;
    } catch {
      return false;
    }
  }

  return new Promise<boolean>((resolve) => {
    const whereProcess = spawn("where.exe", [candidate], {
      windowsHide: true,
      stdio: "ignore",
    });
    whereProcess.on("error", () => resolve(false));
    whereProcess.on("close", (code) => resolve(code === 0));
  });
}

async function spawnExternalTerminal(spec: ExternalTerminalLaunchSpec): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(spec.filePath, spec.args, {
      cwd: spec.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`spawn 失败：${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(
        stderr.trim() || stdout.trim() || "外部终端启动失败。",
      ));
    });
  });
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
  modelMappingConfigService = new ModelMappingConfigService({ appDataRoot: appDataDir });
  modelCatalogService = new ModelCatalogService();
  balanceService = new BalanceService();
  modelMappingsStateCache = await modelMappingConfigService.load();
}

async function loadProfilesAndState(
  passphrase: string,
): Promise<{
  profiles: Profile[];
  state: LocalState;
  siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
}> {
  if (!encryptedStore || !localStateStore) {
    throw new Error("存储未初始化");
  }

  const config = await encryptedStore.load(passphrase);
  const state = await localStateStore.load();

  return {
    profiles: config.profiles,
    state,
    siteBalanceSessionsByBaseUrl: config.site_balance_sessions_by_base_url,
  };
}

async function persistBalanceState(profileKey: ProfileKey, nextState: BalanceCheckState): Promise<void> {
  const state = getProfileService().getState();
  state.balance_checks_by_profile[profileKey] = {
    ...nextState,
    items: nextState.items.map((item) => ({ ...item })),
  };
  await getProfileStateAccessor().save(state);
}

function emitBalanceProgress(profileKey: ProfileKey, nextState: BalanceCheckState): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("balance:test-progress", profileKey, nextState);
  });
}

async function saveAndEmitBalanceState(profileKey: ProfileKey, nextState: BalanceCheckState): Promise<void> {
  await persistBalanceState(profileKey, nextState);
  emitBalanceProgress(profileKey, nextState);
}

async function runBalanceCheck(profileKey: ProfileKey): Promise<void> {
  const profile = getProfileService()
    .getProfiles()
    .find((item) => itemKey(item) === profileKey);
  if (!profile) {
    throw new Error("Profile 不存在");
  }

  const runningState: BalanceCheckState = {
    ...defaultBalanceCheckState(),
    provider: profile.provider,
    profile_name: profile.name,
    base_url: normalizeBalanceBaseUrl(profile.url),
    running: true,
    supported: true,
    message: "正在检测余额...",
  };

  await saveAndEmitBalanceState(profileKey, runningState);

  try {
    const timeoutMs = getSettingsStateService().getParameterSettings().connectivity_test_timeout_ms;
    const resolvedAuth = resolveBalanceAuth(
      profile,
      getProfileService().getSiteBalanceSessionsByBaseUrl(),
    );
    let finalState: BalanceCheckState;

    if (resolvedAuth.kind === "ambiguous_multiple_sessions") {
      finalState = {
        ...defaultBalanceCheckState(),
        provider: profile.provider,
        profile_name: profile.name,
        base_url: normalizeBalanceBaseUrl(profile.url),
        supported: true,
        success: false,
        message: "同站点存在多套后台会话，请先选择要使用的会话",
        endpoint: `${resolvedAuth.base_url}/api/user/self`,
      };
    } else if (resolvedAuth.kind === "none" && resolvedAuth.reason === "missing_bound_session") {
      finalState = {
        ...defaultBalanceCheckState(),
        provider: profile.provider,
        profile_name: profile.name,
        base_url: normalizeBalanceBaseUrl(profile.url),
        supported: true,
        success: false,
        message: "所绑定的后台会话已被删除，请重新选择",
        endpoint: `${resolvedAuth.base_url}/api/user/self`,
      };
    } else {
      finalState = await getBalanceService().query(
        profile,
        timeoutMs,
        resolvedAuth.kind === "explicit_session" || resolvedAuth.kind === "implicit_single_session"
          ? resolvedAuth.session
          : null,
      );
    }
    await saveAndEmitBalanceState(profileKey, {
      ...finalState,
      running: false,
      finished_at_display: new Date().toLocaleString(),
    });
  } catch (error) {
    await saveAndEmitBalanceState(profileKey, {
      ...defaultBalanceCheckState(),
      provider: profile.provider,
      profile_name: profile.name,
      base_url: normalizeBalanceBaseUrl(profile.url),
      supported: true,
      success: false,
      message: error instanceof Error ? error.message : "网络错误 / 超时",
      finished_at_display: new Date().toLocaleString(),
    });
  }
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

  async saveConfig(config: {
    profiles: Profile[];
    site_balance_sessions_by_base_url: SiteBalanceSessionsByBaseUrl;
  }): Promise<void> {
    const pw = this.getPassphrase();
    if (pw && this.store) {
      await this.store.save(config, pw);
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
    writeDebugLog("createUnlockWindow: open");
    const unlockWin = new BrowserWindow({
      width: 760,
      height: 560,
      minWidth: 640,
      minHeight: 480,
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
      writeDebugLog(`profile:unlock invoked, passphrase_length=${passphrase?.length ?? 0}`);
      try {
        if (!encryptedStore || !localStateStore) {
          await initProfileServices();
          writeDebugLog("profile:unlock initProfileServices completed");
        }
        const { profiles, state, siteBalanceSessionsByBaseUrl } = await loadProfilesAndState(passphrase!);
        writeDebugLog(`profile:unlock loaded profiles=${profiles.length}`);
        currentPassphrase = passphrase!;

        // 创建 Profile 服务
        const stateAccessor = new StateAccessor(localStateStore!, state);
        profileStateAccessor = stateAccessor;
        const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase());
        profileService = new ProfileService(
          profiles,
          stateAccessor,
          syncStore,
          siteBalanceSessionsByBaseUrl,
        );
        launchService = new LaunchService(profileService, {
          getModelMappingsState: () => currentModelMappingsState(),
          codexProfilesRoot: getModelMappingConfigService().getCodexProfilesRoot(),
        });
        settingsStateService = new SettingsStateService(stateAccessor);

        isTransitioningFromUnlock = true;
        writeDebugLog("profile:unlock success, closing unlock window");
        unlockWin.close();
        resolve(passphrase!);
      } catch (err: any) {
        writeDebugLog(`profile:unlock failed: ${err?.stack || err?.message || String(err)}`);
        // 密码错误，通知渲染进程
        unlockWin.webContents.send("profile:unlock-error", err.message || "解锁失败");
      }
    };

    ipcMain.handle("profile:unlock", unlockHandler);

    ipcMain.handle("profile:check-encrypted-config", () => {
      return encryptedStore?.exists() ?? false;
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
  writeDebugLog("createMainWindow: start");
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
  mainWindow = browserWindow;
  isTransitioningFromUnlock = false;
  browserWindow.webContents.on("did-finish-load", () => {
    writeDebugLog("createMainWindow: did-finish-load");
  });
  browserWindow.on("ready-to-show", () => {
    writeDebugLog("createMainWindow: ready-to-show");
  });

  browserWindow.on("closed", () => {
    if (mainWindow === browserWindow) {
      mainWindow = null;
    }
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
  ipcMain.handle("skills-manager:load-cached-snapshot", async () =>
    getSkillsService().loadCachedSnapshot(),
  );
  ipcMain.handle("skills-manager:refresh-snapshot", async () =>
    getSkillsService().refreshSnapshot(),
  );
  ipcMain.handle(
    "skills-manager:update-skill-user-tags",
    async (_event, skillId: string, tags: string[]) =>
      getSkillsService().updateSkillUserTags(skillId, tags),
  );
  ipcMain.handle("skills-manager:pick-project-directory", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    return browserWindow
      ? pickDirectoryPath(
          (options) => dialog.showOpenDialog(browserWindow, options),
          "选择项目文件夹",
        )
      : pickDirectoryPath(
          (options) => dialog.showOpenDialog(options),
          "选择项目文件夹",
        );
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

  ipcMain.handle(
    "profile:initialize-encryption",
    async (_event, passphrase: string) => {
      if (!encryptedStore || !localStateStore) {
        await initProfileServices();
      }
      currentPassphrase = passphrase;
      const state = await localStateStore!.load();
      const stateAccessor = new StateAccessor(localStateStore!, state);
      profileStateAccessor = stateAccessor;
      const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase());
      profileService = new ProfileService([], stateAccessor, syncStore, {});
      launchService = new LaunchService(profileService, {
        getModelMappingsState: () => currentModelMappingsState(),
        codexProfilesRoot: getModelMappingConfigService().getCodexProfilesRoot(),
      });
      settingsStateService = new SettingsStateService(stateAccessor);
      return { success: true };
    },
  );

  ipcMain.handle(
    "profile:change-passphrase",
    async (_event, currentPassword: string, nextPassword: string) => {
      if (!encryptedStore || !localStateStore) {
        await initProfileServices();
      }
      if (!currentPassword) {
        throw new Error("当前密码不能为空");
      }
      if (!nextPassword) {
        throw new Error("新密码不能为空");
      }
      if (currentPassword === nextPassword) {
        throw new Error("新密码不能与当前密码相同");
      }

      await encryptedStore!.changePassphrase(currentPassword, nextPassword);
      currentPassphrase = nextPassword;
      return { success: true };
    },
  );

  // Profile CRUD
  ipcMain.handle("profile:list", () => {
    const svc = getProfileService();
    return {
      profiles: svc.getProfiles(),
      state: svc.getState(),
      siteBalanceSessionsByBaseUrl: svc.getSiteBalanceSessionsByBaseUrl(),
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
  ipcMain.handle(
    "profile:save-site-balance-session",
    async (_event, baseUrl: string, draft: SiteBalanceSessionDraft) => {
      return getProfileService().saveSiteBalanceSession(baseUrl, draft);
    },
  );
  ipcMain.handle(
    "profile:delete-site-balance-session",
    async (_event, baseUrl: string, sessionId: string) => {
      await getProfileService().deleteSiteBalanceSession(baseUrl, sessionId);
    },
  );
  ipcMain.handle("profile:pick-working-directory", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    return browserWindow
      ? pickDirectoryPath(
          (options) => dialog.showOpenDialog(browserWindow, options),
          "选择工作目录",
        )
      : pickDirectoryPath(
          (options) => dialog.showOpenDialog(options),
          "选择工作目录",
        );
  });
  ipcMain.handle("profile:open-base-url", async (_event, baseUrl: string) => {
    await shell.openExternal(resolveBaseUrlExternalTarget(baseUrl));
  });

  // Launcher
  ipcMain.handle(
    "launcher:preview-for-draft",
    (
      _event,
      draft: Profile,
      runtime: RuntimeSettings,
      mappingsState?: ModelMappingsState,
      sessionId?: string,
    ): CommandPreview => {
      const svc = getLaunchService();
      return svc.buildPreview(draft, runtime, mappingsState, sessionId);
    },
  );

  ipcMain.handle(
    "launcher:preview-for-profile",
    (_event, profileKey: ProfileKey): CommandPreview => {
      const svc = getLaunchService();
      const profiles = getProfileService().getProfiles();
      const profile = profiles.find((p) => itemKey(p) === profileKey);
      if (!profile) {
        return {
          command: "",
          cwd: "",
          env: [],
          valid: false,
          error: "Profile 不存在。",
        };
      }

      const state = getProfileService().getState();
      const runtime = state.runtime_by_profile[profileKey] ?? defaultRuntimeSettings(profile.provider);
      return svc.buildPreview(profile, runtime);
    },
  );

  ipcMain.handle("launcher:launch", async (_event, request: LaunchRequest) => {
    const plan = getLaunchService().buildExecutionPlan(request);
    if (!plan.valid) {
      throw new Error(plan.error || "无法生成启动命令");
    }
    if (plan.codexConfig) {
      await getModelMappingConfigService().writeCodexProfile({
        profileId: request.profile_key,
        providerId: plan.codexConfig.providerId,
        providerName: plan.codexConfig.providerName,
        baseUrl: plan.codexConfig.baseUrl,
        apiKeyEnv: plan.codexConfig.apiKeyEnv,
        targetModel: plan.codexConfig.targetModel,
      });
    }

    await executeLaunchPlan(plan, {
      directoryExists,
      commandExists,
      spawnExternalTerminal,
    });
  });

  // Sessions
  ipcMain.handle(
    "session:list",
    async (_event, request: ListSessionsRequest) => {
      return listSessionsForProvider(request);
    },
  );

  ipcMain.handle("session:refresh", async (_event, _provider: string) => {
    // 异步刷新会话索引
  });

  ipcMain.handle(
    "session:update-tab-state",
    async (_event, provider: string, patch: SessionsTabStatePatch) => {
      await getSettingsStateService().updateSessionsTabState(provider, patch);
    },
  );

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

  ipcMain.handle("balance:test", async (_event, profileKey: ProfileKey) => {
    void runBalanceCheck(profileKey);
  });

  ipcMain.handle(
    "balance:get-state",
    (_event, profileKey: ProfileKey): BalanceCheckState => {
      const state = getProfileService().getState();
      return state.balance_checks_by_profile[profileKey] ?? defaultBalanceCheckState();
    },
  );

  ipcMain.handle("model-mapping-config:get", async () => currentModelMappingsState());
  ipcMain.handle("model-mapping-config:save", async (_event, state: ModelMappingsState) => {
    const saved = await getModelMappingConfigService().save(state);
    modelMappingsStateCache = saved;
    return saved;
  });
  ipcMain.handle("model-mapping-config:fetch-site-models", async (_event, draft: Pick<Profile, "url" | "key">) => {
    return getModelCatalogService().fetch({
      baseUrl: draft.url,
      apiKey: draft.key,
    });
  });

  // Parameter Settings
  ipcMain.handle("parameter:get", (): ParameterSettings => {
    return getSettingsStateService().getParameterSettings();
  });

  ipcMain.handle(
    "parameter:update",
    async (_event, settings: Partial<ParameterSettings>) => {
      return getSettingsStateService().updateParameterSettings(settings);
    },
  );

  // Global Settings
  ipcMain.handle("settings:get-global", (): GlobalSettings => {
    return getSettingsStateService().getGlobalSettings();
  });

  ipcMain.handle(
    "settings:update-global",
    async (_event, settings: Partial<GlobalSettings>) => {
      return getSettingsStateService().updateGlobalSettings(settings);
    },
  );

  ipcMain.handle("dialog:unsaved-profile-action", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    const result = browserWindow
      ? await dialog.showMessageBox(browserWindow, {
          type: "warning",
          buttons: ["保存当前配置", "放弃修改", "取消"],
          defaultId: 0,
          cancelId: 2,
          title: "未保存修改",
          message: "当前配置有未保存修改。",
          detail: "切换配置、切换 Provider 或新建配置前，请先决定如何处理当前草稿。",
        })
      : await dialog.showMessageBox({
          type: "warning",
          buttons: ["保存当前配置", "放弃修改", "取消"],
          defaultId: 0,
          cancelId: 2,
          title: "未保存修改",
          message: "当前配置有未保存修改。",
          detail: "切换配置、切换 Provider 或新建配置前，请先决定如何处理当前草稿。",
        });

    return ["save", "discard", "cancel"][result.response] as "save" | "discard" | "cancel";
  });

  ipcMain.handle("dialog:launch-unsaved-profile", async () => {
    const browserWindow = BrowserWindow.getFocusedWindow();
    const result = browserWindow
      ? await dialog.showMessageBox(browserWindow, {
          type: "warning",
          buttons: ["保存并启动", "启动已保存配置", "取消"],
          defaultId: 0,
          cancelId: 2,
          title: "启动前发现未保存修改",
          message: "当前配置有未保存修改。",
          detail: "你可以先保存草稿再启动，也可以丢弃草稿并启动已保存配置。",
        })
      : await dialog.showMessageBox({
          type: "warning",
          buttons: ["保存并启动", "启动已保存配置", "取消"],
          defaultId: 0,
          cancelId: 2,
          title: "启动前发现未保存修改",
          message: "当前配置有未保存修改。",
          detail: "你可以先保存草稿再启动，也可以丢弃草稿并启动已保存配置。",
        });

    return ["save_and_launch", "launch_saved", "cancel"][result.response] as
      | "save_and_launch"
      | "launch_saved"
      | "cancel";
  });
}

// ---- 应用生命周期 ----

app.setAppUserModelId("com.local.skillsmanager");

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    const visibleWindow = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
    if (!visibleWindow) {
      return;
    }
    if (visibleWindow.isMinimized()) {
      visibleWindow.restore();
    }
    visibleWindow.focus();
  });
}

app.whenReady().then(async () => {
  writeDebugLog("app.whenReady: start");
  // 1. 初始化 Skills 工作区
  await initSkillsService();
  writeDebugLog("app.whenReady: initSkillsService done");

  // 2. 初始化 Profile 存储
  await initProfileServices();
  writeDebugLog("app.whenReady: initProfileServices done");

  // 3. 始终先经过解锁/设口令窗口
  await createUnlockWindow();
  writeDebugLog("app.whenReady: createUnlockWindow resolved");

  // 4. 注册所有 IPC 处理器
  registerAllIpcHandlers();
  writeDebugLog("app.whenReady: registerAllIpcHandlers done");

  // 5. 创建主窗口
  await createMainWindow();
  writeDebugLog("app.whenReady: createMainWindow done");

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  writeDebugLog(`window-all-closed: transitioning=${isTransitioningFromUnlock}`);
  if (isTransitioningFromUnlock) {
    return;
  }
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  writeDebugLog(`uncaughtException: ${error?.stack || error?.message || String(error)}`);
});

process.on("unhandledRejection", (reason) => {
  writeDebugLog(`unhandledRejection: ${String(reason)}`);
});
