import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeTheme, shell } from "electron";
import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import * as nodePty from "node-pty";
import { initializeWorkspace, resolveWorkspaceLayout, type WorkspaceLayout } from "../src/shared/app-workspace.js";
import { resolveElectronRuntimePaths } from "../src/shared/electron-runtime-paths.js";
import {
  resolveDefaultPaths,
  type PreviewAction,
  CodeDeckSkillsService,
} from "../src/shared/skills-service.js";
import type { ProjectBatchAction, SkillHost } from "../src/shared/types.js";
import { CODEDECK_SKILLS_IPC_CHANNELS } from "../src/shared/code-deck-ipc.js";

// ---- Profile 相关导入 ----
import { EncryptedConfigStore } from "../src/shared/crypto/store.js";
import { LocalStateStore } from "../src/shared/state/store.js";
import { ProfileService } from "../src/shared/services/profile-service.js";
import { LaunchService } from "../src/shared/services/launch-service.js";
import { CapabilityOverlayService } from "../src/shared/services/capability-overlay-service.js";
import { SettingsStateService, type SessionsTabStatePatch } from "../src/shared/services/settings-state-service.js";
import { ModelMappingConfigService } from "../src/shared/services/model-mapping-config-service.js";
import { ModelCatalogService } from "../src/shared/services/model-catalog-service.js";
import { BalanceService, normalizeBalanceBaseUrl } from "../src/shared/services/balance-service.js";
import {
  buildProfileBalanceCheckState,
  resolveBalanceAuth,
  resolveSharedBalanceProfileKeys,
  type SiteBalanceSessionDraft,
  type SiteBalanceSessionsByBaseUrl,
} from "../src/shared/balance/site-balance-sessions.js";
import { pickDirectoryPath } from "../src/shared/electron/dialog-helpers.js";
import { createAppLogger, createIpcHandlerLogger } from "../src/shared/electron/debug-log.js";
import { createSessionListCache } from "../src/shared/electron/session-list-cache.js";
import {
  buildWindowsPtyLaunchSpec,
  executeLaunchPlan,
  type ExternalTerminalLaunchSpec,
} from "../src/shared/electron/launch-runtime.js";
import { resolveBaseUrlExternalTarget } from "../src/shared/electron/open-url.js";
import {
  TerminalSessionManager,
  type CreatePtyProcessOptions,
  type TerminalSessionAutoContinueEvent,
  type TerminalSessionSnapshot,
} from "../src/shared/electron/terminal-session-manager.js";
import {
  importCodexSessionToRuntimeHome,
  invalidateCodexSessionCache,
  listClaudeSessions,
  listCodexSessions,
  listCodexSessionsFromHomes,
  listSessionsForProvider,
  type CodexSessionHome,
  type ListSessionsRequest,
} from "../src/shared/services/session-service.js";
import {
  type BootstrapResult,
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
import type { LaunchRequest, LaunchResult, CommandPreview } from "../src/shared/launcher/types.js";
import {
  defaultBalanceCheckState,
  type BalanceCheckState,
} from "../src/shared/balance/types.js";
import type { ParameterSettings } from "../src/shared/parameter/types.js";
import type { ModelMappingsState } from "../src/shared/model-mapping/config-types.js";
import { normalizeThemeMode } from "../src/shared/theme.js";
import { createStartupTheme, serializeStartupTheme } from "../src/shared/startup-theme.js";
import {
  APP_DEV_USER_DATA_DIR,
  APP_ID,
  APP_NAME,
  CODEDECK_PROJECT_ROOT_ENV,
  STARTUP_THEME_ARG_PREFIX,
} from "../src/shared/branding.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- 应用路径常量 ----
const ENCRYPTED_DATA_FILE = "claude_profiles.encrypted.json";
const LEGACY_DATA_FILE = "profiles.json";
const LOCAL_STATE_FILE = "local_state.json";
const CONFIG_PASSWORD_ENV = "CLAUDE_PROFILE_LAUNCHER_PASSPHRASE";

const appRoot = process.cwd();
let projectRoot = process.cwd();
let skillsService: CodeDeckSkillsService | null = null;

// ---- Profile 服务实例 ----
let profileService: ProfileService | null = null;
let launchService: LaunchService | null = null;
let capabilityOverlayService: CapabilityOverlayService | null = null;
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
let skillsInitPromise: Promise<void> | null = null;
let profileStoresInitPromise: Promise<void> | null = null;
const sessionListCache = createSessionListCache({ ttlMs: 5_000 });
const terminalSessionManager = new TerminalSessionManager({
  createPtyProcess: createNodePtyProcess,
  onAutoContinueEvent: logTerminalAutoContinueEvent,
});
const terminalAttachmentDisposers = new Map<string, () => void>();
const terminalWindows = new Map<string, BrowserWindow>();
const appLogger = createAppLogger({
  getDirectory: () => path.join(projectRoot || process.cwd(), "app-data", "logs"),
});
const handleIpc = createIpcHandlerLogger(appLogger, (channel, handler) => {
  ipcMain.handle(channel, (event, ...args) => handler(event, ...args));
});

function logTerminalAutoContinueEvent(event: TerminalSessionAutoContinueEvent): void {
  const context = {
    sessionId: event.sessionId,
    phase: event.phase,
    reason: event.reason,
    keyword: event.keyword,
    matchCount: event.matchCount,
    remaining: event.remaining,
    prompt: event.prompt,
    subscriberCount: event.subscriberCount,
    visibleExcerpt: event.visibleExcerpt,
  };
  if (event.phase === "matched") {
    appLogger.info("terminal_auto_continue", "auto_continue_matched", "收到终端输出并命中自动继续关键词", {
      context,
    });
    return;
  }
  if (event.phase === "queued") {
    appLogger.info("terminal_auto_continue", "auto_continue_queued", "自动继续输入已排队", {
      context,
    });
    return;
  }
  if (event.phase === "flushed") {
    appLogger.info("terminal_auto_continue", "auto_continue_flushed", "自动继续输入已写入 PTY", {
      context,
    });
    return;
  }
  appLogger.debug("terminal_auto_continue", "auto_continue_skipped", "自动继续输入已跳过", {
    context,
  });
}

function getDefaultWorkingDirectory(): string {
  return app.getPath("downloads").replace(/\\/g, "/");
}

function applyNativeThemeMode(mode: unknown): void {
  nativeTheme.themeSource = normalizeThemeMode(mode);
}

function getLocalStatePath(): string {
  return path.join(projectRoot, "app-data", LOCAL_STATE_FILE);
}

function profileStoresReady(): boolean {
  return Boolean(
    encryptedStore
    && localStateStore
    && modelMappingConfigService
    && capabilityOverlayService
    && modelCatalogService
    && balanceService
    && modelMappingsStateCache,
  );
}

async function ensureProfileStoresReady(): Promise<void> {
  if (profileStoresReady()) {
    return;
  }
  if (!profileStoresInitPromise) {
    profileStoresInitPromise = initProfileServices().catch((error: unknown) => {
      profileStoresInitPromise = null;
      throw error;
    });
  }
  await profileStoresInitPromise;
}

function warmProfileStoresInBackground(): void {
  void ensureProfileStoresReady()
    .then(async () => {
      appLogger.info("app", "profile_services_ready", "Profile storage services initialized");
      await syncNativeThemeFromLocalState();
    })
    .catch((error: unknown) => {
      appLogger.error("app", "profile_services_ready_error", "Profile storage warmup failed", { error });
    });
}

async function fileExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function writeManagedLaunchTextFile(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function hasEncryptedConfigFile(): Promise<boolean> {
  if (encryptedStore) {
    return encryptedStore.exists();
  }
  return fileExists(path.join(projectRoot, "app-data", ENCRYPTED_DATA_FILE));
}

function resolveWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111827" : "#f2efe7";
}

async function syncNativeThemeFromLocalState(): Promise<void> {
  const stateStore = localStateStore ?? new LocalStateStore(getLocalStatePath());
  const state = await stateStore.load();
  applyNativeThemeMode(state.global_settings.theme_mode);
}

function getStartupThemeArgument(): string {
  return `${STARTUP_THEME_ARG_PREFIX}${serializeStartupTheme(
    createStartupTheme(nativeTheme.themeSource, nativeTheme.shouldUseDarkColors),
  )}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function createStartupShellHtml(
  message = "正在准备解锁界面...",
  options: { progress?: boolean } = {},
): string {
  const showProgress = options.progress ?? true;
  const startupTheme = createStartupTheme(nativeTheme.themeSource, nativeTheme.shouldUseDarkColors);
  const isDark = startupTheme.effectiveTheme === "dark";
  const background = isDark ? "#111827" : "#f2efe7";
  const text = isDark ? "#e5edf7" : "#1d2733";
  const muted = isDark ? "#9aa8ba" : "#607084";
  const surface = isDark ? "rgba(23, 31, 43, 0.9)" : "rgba(255, 255, 255, 0.88)";
  const border = isDark ? "rgba(190, 205, 225, 0.12)" : "rgba(29, 39, 51, 0.08)";
  const shadow = isDark ? "rgba(0, 0, 0, 0.28)" : "rgba(50, 68, 92, 0.1)";
  const progressTrack = isDark ? "rgba(74, 144, 226, 0.18)" : "rgba(23, 64, 109, 0.12)";
  const progressBar = isDark ? "#3b82c4" : "#17406d";
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="zh-CN" data-theme="${startupTheme.effectiveTheme}" data-theme-mode="${startupTheme.themeMode}">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${APP_NAME}</title>
    <style>
      :root {
        font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
        color: ${text};
        background: ${background};
      }

      * {
        box-sizing: border-box;
      }

      html,
      body,
      #root {
        min-height: 100%;
        margin: 0;
      }

      body.unlock-route {
        overflow: hidden;
      }

      .startup-screen {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        width: 100vw;
        overflow: hidden;
        padding: 16px;
        background: ${background};
      }

      .unlock-card {
        border: 1px solid ${border};
        background: ${surface};
        box-shadow: 0 24px 80px ${shadow};
        border-radius: 22px;
        padding: 24px;
        width: min(420px, calc(100vw - 48px));
        max-width: 100%;
        display: grid;
        gap: 12px;
        text-align: center;
      }

      .unlock-card h1 {
        margin: 0;
        font-size: 1.42rem;
      }

      .unlock-card p {
        margin: 0;
        color: ${muted};
      }

      .startup-progress {
        height: 4px;
        width: 100%;
        overflow: hidden;
        border-radius: 999px;
        background: ${progressTrack};
      }

      .startup-progress-bar {
        display: block;
        width: 44%;
        height: 100%;
        border-radius: inherit;
        background: ${progressBar};
        animation: startup-progress-slide 1.1s ease-in-out infinite;
      }

      @keyframes startup-progress-slide {
        0% {
          transform: translateX(-120%);
        }

        100% {
          transform: translateX(260%);
        }
      }
    </style>
  </head>
  <body class="unlock-route">
    <div id="root">
      <div class="startup-screen">
        <div class="unlock-card">
          <h1>${APP_NAME}</h1>
          <p>${safeMessage}</p>
          ${showProgress ? `
          <div class="startup-progress" role="progressbar" aria-label="${safeMessage}">
            <span class="startup-progress-bar"></span>
          </div>` : ""}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function createStartupShellUrl(message?: string, options?: { progress?: boolean }): string {
  return `data:text/html;charset=UTF-8,${encodeURIComponent(createStartupShellHtml(message, options))}`;
}

async function showStartupShell(browserWindow: BrowserWindow): Promise<void> {
  await browserWindow.loadURL(createStartupShellUrl());
  if (!browserWindow.isDestroyed() && !browserWindow.isVisible()) {
    browserWindow.show();
  }
}

function errorToStartupMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "未知错误";
}

async function showStartupLoadError(browserWindow: BrowserWindow, error: unknown): Promise<void> {
  if (browserWindow.isDestroyed()) {
    return;
  }
  await browserWindow.loadURL(createStartupShellUrl(
    `界面启动失败：${errorToStartupMessage(error)}。请打开 DevTools 查看控制台错误（Ctrl+Shift+I）`,
    { progress: false },
  ));
  if (!browserWindow.isDestroyed() && !browserWindow.isVisible()) {
    browserWindow.show();
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
}

// ---- Skills 服务 ----

function getConfiguredProjectRootEnv(): string | undefined {
  return process.env[CODEDECK_PROJECT_ROOT_ENV];
}

function resolveCurrentWorkspaceLayout(): WorkspaceLayout {
  const envProjectRoot = getConfiguredProjectRootEnv();
  return resolveWorkspaceLayout({
    cwd: process.cwd(),
    envProjectRoot,
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    userDataPath: app.isPackaged ? app.getPath("userData") : path.join(os.homedir(), APP_DEV_USER_DATA_DIR),
  });
}

function resolveProjectRoot(): WorkspaceLayout {
  const layout = resolveCurrentWorkspaceLayout();
  projectRoot = layout.workspaceRoot;
  return layout;
}

async function initSkillsService(layout = resolveProjectRoot()): Promise<void> {
  if (skillsService) {
    return;
  }
  appLogger.info("app", "skills_first_init_start", "Initializing skills workspace", {
    context: {
      isPackaged: app.isPackaged,
      hasEnvProjectRoot: Boolean(getConfiguredProjectRootEnv()?.trim()),
    },
  });
  projectRoot = layout.workspaceRoot;
  await initializeWorkspace(layout);
  projectRoot = layout.workspaceRoot;
  skillsService = new CodeDeckSkillsService(resolveDefaultPaths(projectRoot));
  appLogger.info("app", "skills_first_init_ready", "Skills workspace initialized", {
    context: {
      workspaceRoot: projectRoot,
      hasSeedRoot: !!layout.seedRoot,
    },
  });
}

function ensureSkillsServiceReady(): Promise<void> {
  if (skillsService) {
    return Promise.resolve();
  }
  if (!skillsInitPromise) {
    skillsInitPromise = initSkillsService().catch((error: unknown) => {
      skillsInitPromise = null;
      throw error;
    });
  }
  return skillsInitPromise;
}

async function getReadySkillsService(): Promise<CodeDeckSkillsService> {
  await ensureSkillsServiceReady();
  return getSkillsService();
}

function getSkillsService(): CodeDeckSkillsService {
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

function getCapabilityOverlayService(): CapabilityOverlayService {
  if (!capabilityOverlayService) throw new Error("Capability Overlay 服务尚未初始化。");
  return capabilityOverlayService;
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

async function resolveCodexSessionHome(request: ListSessionsRequest): Promise<string | undefined> {
  if (request.provider.trim().toLowerCase() !== "codex") {
    return undefined;
  }
  return getModelMappingConfigService().ensureCodexRuntimeHome();
}

async function resolveCodexSessionHomes(request: ListSessionsRequest): Promise<CodexSessionHome[]> {
  const appRuntimeHome = await resolveCodexSessionHome(request);
  if (!appRuntimeHome) {
    return [];
  }
  const globalHome = path.join(os.homedir(), ".codex");
  const homes: CodexSessionHome[] = [
    { kind: "app_runtime", home: appRuntimeHome },
  ];
  if (path.resolve(globalHome) !== path.resolve(appRuntimeHome)) {
    homes.push({ kind: "global_codex", home: globalHome });
  }
  return homes;
}

async function importExternalCodexSessionIfNeeded(request: LaunchRequest): Promise<void> {
  if (request.provider.trim().toLowerCase() !== "codex") {
    return;
  }
  if (request.session_source?.source_kind !== "global_codex") {
    return;
  }
  const sessionId = request.session_id?.trim() ?? "";
  if (!sessionId) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }
  const runtimeHome = await getModelMappingConfigService().ensureCodexRuntimeHome();
  const sourceHome = request.session_source.source_home?.trim() || path.join(os.homedir(), ".codex");
  if (path.resolve(sourceHome) === path.resolve(runtimeHome)) {
    return;
  }
  await importCodexSessionToRuntimeHome({
    sessionId,
    sourceHome,
    runtimeHome,
  });
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

function safeUrlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.trim();
  }
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

async function validateLaunchPlan(plan: Parameters<typeof executeLaunchPlan>[0]): Promise<void> {
  if (!plan.valid) {
    throw new Error(plan.error || "无法生成启动命令。");
  }
  if (!plan.cwd.trim() || !(await directoryExists(plan.cwd))) {
    throw new Error("工作目录不存在，请先设置有效的工作目录。");
  }
  if (plan.launchMode === "resume_selected" && !(plan.sessionId ?? "").trim()) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }
  for (const envKey of plan.requiredEnvKeys) {
    if (!(plan.env[envKey] ?? "").trim()) {
      throw new Error(`Provider 配置缺少必需环境变量：${envKey}`);
    }
  }
  if (!plan.commandExecutable.trim() || !(await commandExists(plan.commandExecutable))) {
    throw new Error(`命令不可执行或不在 PATH 中：${plan.commandExecutable}`);
  }
}

async function launchMonitoredTerminalSession(plan: Parameters<typeof executeLaunchPlan>[0]): Promise<TerminalSessionSnapshot> {
  await validateLaunchPlan(plan);
  const spec = buildWindowsPtyLaunchSpec(plan);
  const mergedEnv = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...plan.env,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (mergedEnv.PATH && !mergedEnv.Path) {
    mergedEnv.Path = mergedEnv.PATH;
  }
  const snapshot = await terminalSessionManager.createSession({
    provider: plan.provider,
    cwd: plan.cwd,
    commandExecutable: plan.commandExecutable,
    commandArgs: plan.commandArgs,
    spawnFilePath: spec.filePath,
    spawnArgs: spec.args,
    env: mergedEnv,
    autoContinue: plan.codexAutoContinue ?? {
      enabled: false,
      limit: 1,
      prompt: "继续",
      keywords: [],
    },
  });
  try {
    await createTerminalWindow(snapshot.sessionId);
  } catch (windowError) {
    await terminalSessionManager.closeSession(snapshot.sessionId, "window_create_failed");
    throw windowError;
  }
  return snapshot;
}

async function prepareCapabilityOverlay(request: LaunchRequest): Promise<LaunchRequest["capability_overlay"]> {
  if (!getSettingsStateService().getParameterSettings().inherit_global_capabilities) {
    return undefined;
  }
  const provider = request.provider.trim().toLowerCase();
  if (provider === "claude") {
    return {
      claude: await getCapabilityOverlayService().prepareClaudeOverlay({
        profileId: request.profile_key,
      }),
    };
  }
  if (provider === "codex") {
    const profileHome = await getModelMappingConfigService().ensureCodexRuntimeHome();
    return {
      codex: await getCapabilityOverlayService().prepareCodexOverlay({
        profileId: request.profile_key,
        profileHome,
      }),
    };
  }
  return undefined;
}

// ---- 初始化 Profile 服务 ----

async function initProfileServices(): Promise<void> {
  if (profileStoresReady()) {
    return;
  }
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
  capabilityOverlayService = new CapabilityOverlayService({
    overlayRoot: path.join(appDataDir, "runtime-overlays"),
    onDirectoryLinkFallback: ({ sourcePath, targetPath, reason }) => {
      appLogger.warn("capabilities", "directory_link_fallback", "Directory junction creation failed; copied directory instead", {
        context: { sourcePath, targetPath, reason },
      });
    },
  });
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
  applyNativeThemeMode(state.global_settings.theme_mode);

  return {
    profiles: config.profiles,
    state,
    siteBalanceSessionsByBaseUrl: config.site_balance_sessions_by_base_url,
  };
}

function buildProfileBootstrapPayload(): BootstrapResult {
  const svc = getProfileService();
  const state = svc.getState();
  return {
    profiles: svc.getProfiles(),
    state: {
      selected_provider: state.selected_provider,
      selected_profile_key: state.selected_profile_key,
      selected_profile_key_by_provider: state.selected_profile_key_by_provider,
      profile_order_by_provider: state.profile_order_by_provider,
      runtime_by_profile: state.runtime_by_profile,
      balance_checks_by_profile: state.balance_checks_by_profile,
      global_settings: state.global_settings,
      working_directory_favorites: state.working_directory_favorites,
      session_favorites: state.session_favorites,
    },
    siteBalanceSessionsByBaseUrl: svc.getSiteBalanceSessionsByBaseUrl(),
    defaultWorkingDirectory: getDefaultWorkingDirectory(),
  };
}

async function persistBalanceState(
  profileKeys: ProfileKey[],
  nextState: BalanceCheckState,
): Promise<Array<[ProfileKey, BalanceCheckState]>> {
  const profiles = getProfileService().getProfiles();
  const profileByKey = new Map(profiles.map((profile) => [itemKey(profile), profile]));
  const state = getProfileService().getState();
  const savedStates: Array<[ProfileKey, BalanceCheckState]> = [];

  for (const profileKey of profileKeys) {
    const profile = profileByKey.get(profileKey);
    if (!profile) {
      continue;
    }

    const targetState = buildProfileBalanceCheckState(profile, nextState);
    state.balance_checks_by_profile[profileKey] = targetState;
    savedStates.push([profileKey, targetState]);
  }

  await getProfileStateAccessor().save(state);
  return savedStates;
}

function emitBalanceProgress(profileKey: ProfileKey, nextState: BalanceCheckState): void {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send("balance:test-progress", profileKey, nextState);
  });
}

async function saveAndEmitBalanceState(profileKeys: ProfileKey[], nextState: BalanceCheckState): Promise<void> {
  const savedStates = await persistBalanceState(profileKeys, nextState);
  for (const [profileKey, state] of savedStates) {
    emitBalanceProgress(profileKey, state);
  }
}

async function runBalanceCheck(profileKey: ProfileKey): Promise<void> {
  const startedAt = Date.now();
  const profiles = getProfileService().getProfiles();
  const profile = profiles.find((item) => itemKey(item) === profileKey);
  if (!profile) {
    throw new Error("Profile 不存在");
  }
  const siteBalanceSessionsByBaseUrl = getProfileService().getSiteBalanceSessionsByBaseUrl();
  const sharedProfileKeys = resolveSharedBalanceProfileKeys(
    profiles,
    profileKey,
    siteBalanceSessionsByBaseUrl,
  );
  const resolvedAuth = resolveBalanceAuth(
    profile,
    siteBalanceSessionsByBaseUrl,
  );
  appLogger.info("balance", "balance_check_start", "Balance check started", {
    context: {
      profileKey,
      provider: profile.provider,
      baseUrlHost: safeUrlHost(normalizeBalanceBaseUrl(profile.url)),
      authKind: resolvedAuth.kind,
      sharedProfileCount: sharedProfileKeys.length,
    },
  });

  const runningState: BalanceCheckState = {
    ...defaultBalanceCheckState(),
    provider: profile.provider,
    profile_name: profile.name,
    base_url: normalizeBalanceBaseUrl(profile.url),
    running: true,
    supported: true,
    message: "正在检测余额...",
  };

  await saveAndEmitBalanceState(sharedProfileKeys, runningState);

  try {
    const timeoutMs = getSettingsStateService().getParameterSettings().connectivity_test_timeout_ms;
    let finalState: BalanceCheckState;

    if (resolvedAuth.kind === "none" && resolvedAuth.reason === "missing_bound_session") {
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
        resolvedAuth.kind === "explicit_session"
          ? resolvedAuth.session
          : null,
      );
    }
    await saveAndEmitBalanceState(sharedProfileKeys, {
      ...finalState,
      running: false,
      finished_at_display: new Date().toLocaleString(),
    });
    appLogger.info("balance", "balance_check_finished", "Balance check finished", {
      durationMs: Date.now() - startedAt,
      context: {
        profileKey,
        provider: profile.provider,
        baseUrlHost: safeUrlHost(normalizeBalanceBaseUrl(profile.url)),
        authKind: resolvedAuth.kind,
        sharedProfileCount: sharedProfileKeys.length,
        supported: finalState.supported,
        success: finalState.success,
        message: finalState.message,
      },
    });
  } catch (error) {
    await saveAndEmitBalanceState(sharedProfileKeys, {
      ...defaultBalanceCheckState(),
      provider: profile.provider,
      profile_name: profile.name,
      base_url: normalizeBalanceBaseUrl(profile.url),
      supported: true,
      success: false,
      message: error instanceof Error ? error.message : "网络错误 / 超时",
      finished_at_display: new Date().toLocaleString(),
    });
    appLogger.error("balance", "balance_check_error", "Balance check failed", {
      durationMs: Date.now() - startedAt,
      context: {
        profileKey,
        provider: profile.provider,
        baseUrlHost: safeUrlHost(normalizeBalanceBaseUrl(profile.url)),
        authKind: resolvedAuth.kind,
        sharedProfileCount: sharedProfileKeys.length,
      },
      error,
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

function buildRendererUrl(searchParams?: Record<string, string>): string {
  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  if (devServerUrl) {
    const url = new URL(devServerUrl);
    for (const [key, value] of Object.entries(searchParams ?? {})) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  }
  const url = pathToFileURL(resolveDistIndexPath());
  for (const [key, value] of Object.entries(searchParams ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

function createNodePtyProcess(options: CreatePtyProcessOptions) {
  const ptyProcess = nodePty.spawn(options.filePath, options.args, {
    name: "xterm-color",
    cols: options.cols,
    rows: options.rows,
    cwd: options.cwd,
    env: options.env,
  });
  return {
    pid: ptyProcess.pid,
    write: (data: string) => ptyProcess.write(data),
    resize: (cols: number, rows: number) => ptyProcess.resize(cols, rows),
    kill: () => ptyProcess.kill(),
    onData: (listener: (data: string) => void) => {
      const disposable = ptyProcess.onData(listener);
      return () => disposable.dispose();
    },
    onExit: (listener: (event: { exitCode: number; signal?: number }) => void) => {
      const disposable = ptyProcess.onExit(listener);
      return () => disposable.dispose();
    },
  };
}

function getTerminalAttachmentKey(webContentsId: number, sessionId: string): string {
  return `${webContentsId}:${sessionId}`;
}

function clearTerminalAttachment(webContentsId: number, sessionId: string): void {
  const attachmentKey = getTerminalAttachmentKey(webContentsId, sessionId);
  const dispose = terminalAttachmentDisposers.get(attachmentKey);
  if (!dispose) {
    return;
  }
  dispose();
  terminalAttachmentDisposers.delete(attachmentKey);
}

function describeLaunchResult(planTerminalMode: "direct" | "monitored", snapshot?: TerminalSessionSnapshot): LaunchResult {
  return {
    launched: true,
    terminalMode: planTerminalMode,
    monitoringActive: planTerminalMode === "monitored",
    terminalSessionId: snapshot?.sessionId,
  };
}

async function createMainWindow(): Promise<void> {
  appLogger.info("window", "main_window_start", "Opening main window");
  const browserWindow = new BrowserWindow({
    title: APP_NAME,
    width: 1520,
    height: 920,
    minWidth: 1200,
    minHeight: 760,
    // 启动期间立即显示窗口（纯色背景），避免渲染器冷启动期间（日志实测约 3.4s）
    // 用户双击后完全看不到窗口反馈。backgroundColor 与启动 shell 背景同色，
    // 纯色 → shell 过渡无闪烁；shell 自带进度条，冷启动结束后立即接管视觉反馈。
    show: true,
    backgroundColor: resolveWindowBackgroundColor(),
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      additionalArguments: [getStartupThemeArgument()],
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow = browserWindow;
  browserWindow.webContents.on("did-finish-load", () => {
    appLogger.info("window", "main_window_did_finish_load", "Main window finished loading");
  });
  browserWindow.on("ready-to-show", () => {
    appLogger.info("window", "main_window_ready_to_show", "Main window is ready to show");
  });

  browserWindow.on("closed", () => {
    if (mainWindow === browserWindow) {
      mainWindow = null;
    }
  });

  await showStartupShell(browserWindow);

  try {
    const devServerUrl = process.env.VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      await browserWindow.loadURL(devServerUrl);
      return;
    }

    await browserWindow.loadFile(resolveDistIndexPath());
  } catch (error: unknown) {
    appLogger.error("window", "main_window_load_error", "Main window failed to load renderer", { error });
    await showStartupLoadError(browserWindow, error);
  }
}

async function createTerminalWindow(sessionId: string): Promise<BrowserWindow> {
  const browserWindow = new BrowserWindow({
    title: "Codex Terminal",
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 560,
    show: true,
    backgroundColor: "#10161f",
    icon: resolveWindowIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      additionalArguments: [getStartupThemeArgument()],
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  terminalWindows.set(sessionId, browserWindow);
  browserWindow.on("closed", () => {
    terminalWindows.delete(sessionId);
    void terminalSessionManager.closeSession(sessionId, "window_closed").catch(() => {
      // Ignore close races when the PTY already exited.
    });
  });
  await browserWindow.loadURL(buildRendererUrl({ view: "terminal", sessionId }));
  return browserWindow;
}

// ---- 注册所有 IPC 处理器 ----

function registerAllIpcHandlers(): void {
  // ============ Skills IPC（按需初始化） ============
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.scan, async () => {
    const svc = await getReadySkillsService();
    return svc.scanEnvironment();
  });
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.loadCachedSnapshot, async () =>
    (await getReadySkillsService()).loadCachedSnapshot(),
  );
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.refreshSnapshot, async () =>
    (await getReadySkillsService()).refreshSnapshot(),
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.updateSkillUserTags,
    async (_event, skillId: string, tags: string[]) => {
      const svc = await getReadySkillsService();
      return svc.updateSkillUserTags(skillId, tags);
    },
  );
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.pickProjectDirectory, async () => {
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
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.selectProject, async (_event, projectPath: string) =>
    (await getReadySkillsService()).selectProject(projectPath),
  );
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.clearCurrentProjectSelection, async () =>
    (await getReadySkillsService()).clearCurrentProjectSelection(),
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.scanProject,
    async (_event, projectPath?: string) =>
      (await getReadySkillsService()).scanProjectSkills(projectPath),
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.preview,
    async (_event, action: PreviewAction, skillIds: string[]) =>
      (await getReadySkillsService()).createPreview(action, skillIds),
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.execute,
    async (_event, action: PreviewAction, skillIds: string[]) => {
      appLogger.info("skills", "batch_execute_start", "Skills batch execution started", {
        context: { action, skillCount: skillIds.length },
      });
      const svc = await getReadySkillsService();
      const result = await svc.executeBatch(action, skillIds);
      appLogger.info("skills", "batch_execute_finished", "Skills batch execution finished", {
        context: {
          action,
          skillCount: skillIds.length,
          successCount: result.results.filter((item) => item.success).length,
          failureCount: result.results.filter((item) => !item.success).length,
        },
      });
      return result;
    },
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.projectPreview,
    async (_event, host: SkillHost, skillIds: string[], action: ProjectBatchAction) =>
      (await getReadySkillsService()).createProjectPreview(host, skillIds, action),
  );
  handleIpc(
    CODEDECK_SKILLS_IPC_CHANNELS.projectExecute,
    async (_event, host: SkillHost, skillIds: string[], action: ProjectBatchAction) => {
      appLogger.info("skills", "project_batch_execute_start", "Project skills batch execution started", {
        context: { host, action, skillCount: skillIds.length },
      });
      const svc = await getReadySkillsService();
      const result = await svc.executeProjectBatch(host, skillIds, action);
      appLogger.info("skills", "project_batch_execute_finished", "Project skills batch execution finished", {
        context: {
          host,
          action,
          skillCount: skillIds.length,
          successCount: result.results.filter((item) => item.success).length,
          failureCount: result.results.filter((item) => !item.success).length,
        },
      });
      return result;
    },
  );
  handleIpc(CODEDECK_SKILLS_IPC_CHANNELS.rollbackLastBatch, async () => {
    const svc = await getReadySkillsService();
    const result = await svc.rollbackLastSuccessfulBatch();
    appLogger.info("skills", "batch_rollback_finished", "Last successful skills batch rollback finished", {
      context: {
        successCount: result.results.filter((item) => item.success).length,
        failureCount: result.results.filter((item) => !item.success).length,
      },
    });
    return result;
  });

  ipcMain.on("app:renderer-log", (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object") {
      return;
    }
    const record = payload as { event?: unknown; message?: unknown; context?: unknown };
    if (typeof record.event !== "string" || typeof record.message !== "string") {
      return;
    }
    appLogger.info("renderer", record.event, record.message, {
      context: record.context,
    });
  });

  handleIpc("terminal:attach", (event, sessionId: string) => {
    const sender = event.sender;
    clearTerminalAttachment(sender.id, sessionId);
    const dispose = terminalSessionManager.attachSession(sessionId, {
      onOutput: (chunk) => {
        if (!sender.isDestroyed()) {
          sender.send("terminal:output", sessionId, chunk);
        }
      },
      onStatus: (snapshot) => {
        if (!sender.isDestroyed()) {
          sender.send("terminal:status", snapshot);
        }
      },
    });
    terminalAttachmentDisposers.set(getTerminalAttachmentKey(sender.id, sessionId), dispose);
    sender.once("destroyed", () => {
      clearTerminalAttachment(sender.id, sessionId);
    });
    const snapshot = terminalSessionManager.getSnapshot(sessionId);
    if (!snapshot) {
      throw new Error(`终端会话不存在：${sessionId}`);
    }
    return snapshot;
  }, { level: "debug" });
  handleIpc("terminal:send-input", async (_event, sessionId: string, data: string) => {
    terminalSessionManager.sendInput(sessionId, data);
  }, { level: "debug" });
  handleIpc("terminal:resize", async (_event, sessionId: string, cols: number, rows: number) => {
    terminalSessionManager.resizeSession(sessionId, cols, rows);
  }, { level: "debug" });
  handleIpc("terminal:close", async (_event, sessionId: string) => {
    await terminalSessionManager.closeSession(sessionId, "renderer_requested");
    const browserWindow = terminalWindows.get(sessionId);
    if (browserWindow && !browserWindow.isDestroyed()) {
      browserWindow.close();
    }
  }, { level: "debug" });
  handleIpc("terminal:read-clipboard-text", async () => clipboard.readText(), { level: "debug" });
  handleIpc("terminal:write-clipboard-text", async (_event, text: string) => {
    clipboard.writeText(text);
  }, { level: "debug" });

  // ============ Profile IPC ============

  handleIpc("profile:check-encrypted-config", async () => {
    return hasEncryptedConfigFile();
  }, { level: "debug" });

  handleIpc(
    "profile:unlock",
    async (_event, passphrase: string) => {
      appLogger.info("auth", "unlock_start", "Profile unlock started", {
        context: {
          passphrase_length: passphrase?.length ?? 0,
        },
      });
      try {
        await ensureProfileStoresReady();
        appLogger.info("auth", "unlock_profile_services_ready", "Profile storage services ready during unlock");
        const { profiles, state, siteBalanceSessionsByBaseUrl } = await loadProfilesAndState(passphrase);
        appLogger.info("auth", "unlock_profiles_loaded", "Profiles loaded during unlock", {
          context: {
            profileCount: profiles.length,
          },
        });
        currentPassphrase = passphrase;

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
          codexRuntimeHome: getModelMappingConfigService().getCodexRuntimeHome(),
        });
        settingsStateService = new SettingsStateService(stateAccessor);

        appLogger.info("auth", "unlock_success", "Profile unlock succeeded");
        return {
          success: true,
          bootstrap: buildProfileBootstrapPayload(),
        };
      } catch (err: any) {
        appLogger.error("auth", "unlock_error", "Profile unlock failed", { error: err });
        for (const win of BrowserWindow.getAllWindows()) {
          win.webContents.send("profile:unlock-error", err?.message || "解锁失败");
        }
        throw err;
      }
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:initialize-encryption",
    async (_event, passphrase: string) => {
      await ensureProfileStoresReady();
      currentPassphrase = passphrase;
      const state = await localStateStore!.load();
      const stateAccessor = new StateAccessor(localStateStore!, state);
      profileStateAccessor = stateAccessor;
      const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase());
      profileService = new ProfileService([], stateAccessor, syncStore, {});
      launchService = new LaunchService(profileService, {
        getModelMappingsState: () => currentModelMappingsState(),
        codexProfilesRoot: getModelMappingConfigService().getCodexProfilesRoot(),
        codexRuntimeHome: getModelMappingConfigService().getCodexRuntimeHome(),
      });
      settingsStateService = new SettingsStateService(stateAccessor);
      return { success: true };
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:change-passphrase",
    async (_event, currentPassword: string, nextPassword: string) => {
      await ensureProfileStoresReady();
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
    { includeArgs: false },
  );

  // Profile CRUD
  handleIpc("profile:bootstrap", () => {
    return buildProfileBootstrapPayload();
  }, { level: "debug" });

  handleIpc("profile:list", () => {
    const svc = getProfileService();
    return {
      profiles: svc.getProfiles(),
      state: svc.getState(),
      siteBalanceSessionsByBaseUrl: svc.getSiteBalanceSessionsByBaseUrl(),
      defaultWorkingDirectory: getDefaultWorkingDirectory(),
    };
  }, { level: "debug" });

  handleIpc(
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

  handleIpc("profile:delete", async (_event, key: ProfileKey) => {
    await getProfileService().deleteProfile(key);
  });

  handleIpc(
    "profile:clone",
    async (_event, sourceKey: ProfileKey, targetProvider: string) => {
      return getProfileService().cloneProfileToProvider(sourceKey, targetProvider);
    },
  );

  handleIpc(
    "profile:select",
    async (_event, provider: string, key: ProfileKey) => {
      await getProfileService().selectProfile(provider, key);
    },
  );

  handleIpc(
    "profile:reorder",
    async (_event, provider: string, orderedKeys: ProfileKey[]) => {
      await getProfileService().reorderProfiles(provider, orderedKeys);
    },
  );

  handleIpc(
    "profile:activate-provider",
    async (_event, provider: string) => {
      await getProfileService().activateProvider(provider);
    },
  );
  handleIpc(
    "profile:update-working-directory-favorites",
    async (_event, favorites: unknown) => {
      return getProfileService().updateWorkingDirectoryFavorites(favorites);
    },
  );
  handleIpc(
    "profile:save-site-balance-session",
    async (_event, baseUrl: string, draft: SiteBalanceSessionDraft) => {
      return getProfileService().saveSiteBalanceSession(baseUrl, draft);
    },
  );
  handleIpc(
    "profile:delete-site-balance-session",
    async (_event, baseUrl: string, sessionId: string) => {
      await getProfileService().deleteSiteBalanceSession(baseUrl, sessionId);
    },
  );
  handleIpc("profile:pick-working-directory", async () => {
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
  handleIpc("profile:open-base-url", async (_event, baseUrl: string) => {
    await shell.openExternal(resolveBaseUrlExternalTarget(baseUrl));
  });

  // Launcher
  handleIpc(
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
    { level: "debug" },
  );

  handleIpc(
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
    { level: "debug" },
  );

  handleIpc("launcher:launch", async (_event, request: LaunchRequest) => {
    const startedAt = Date.now();
    const capability_overlay = await prepareCapabilityOverlay(request);
    const planRequest = {
      ...request,
      capability_overlay,
    };
    const plan = getLaunchService().buildExecutionPlan(planRequest);
    appLogger.info("launcher", "launch_plan_created", "Launch plan created", {
      context: {
        provider: request.provider,
        profileKey: request.profile_key,
        launchMode: plan.launchMode,
        terminalMode: plan.terminalMode,
        cwd: plan.cwd,
        valid: plan.valid,
        commandExecutable: plan.commandExecutable,
        hasCodexConfig: !!plan.codexConfig,
      },
    });
    if (!plan.valid) {
      throw new Error(plan.error || "无法生成启动命令");
    }
    await importExternalCodexSessionIfNeeded(request);
    if (plan.claudeSettings) {
      await writeManagedLaunchTextFile(plan.claudeSettings.settingsPath, plan.claudeSettings.content);
      appLogger.info("launcher", "claude_permissions_written", "Claude managed permission settings written", {
        context: {
          provider: request.provider,
          profileKey: request.profile_key,
          settingsPath: plan.claudeSettings.settingsPath,
        },
      });
    }
    if (plan.codexConfig) {
      await getModelMappingConfigService().writeCodexProfile({
        profileId: request.profile_key,
        profileName: plan.codexConfig.profileName,
        providerId: plan.codexConfig.providerId,
        providerName: plan.codexConfig.providerName,
        baseUrl: plan.codexConfig.baseUrl,
        apiKeyEnv: plan.codexConfig.apiKeyEnv,
        targetModel: plan.codexConfig.targetModel,
        content: plan.codexConfig.content,
        rulesContent: plan.codexConfig.rulesContent,
      });
      appLogger.info("launcher", "codex_config_written", "Codex profile config written", {
        context: {
          provider: request.provider,
          profileKey: request.profile_key,
          providerId: plan.codexConfig.providerId,
          baseUrlHost: safeUrlHost(plan.codexConfig.baseUrl),
        },
      });
    }
    try {
      if (plan.provider === "codex" && plan.terminalMode === "monitored") {
        const snapshot = await launchMonitoredTerminalSession(plan);
        sessionListCache.invalidate(request.provider);
        appLogger.info("launcher", "launch_success", "Monitored terminal session started", {
          durationMs: Date.now() - startedAt,
          context: {
            provider: request.provider,
            profileKey: request.profile_key,
            launchMode: plan.launchMode,
            terminalMode: plan.terminalMode,
            cwd: plan.cwd,
            commandExecutable: plan.commandExecutable,
            terminalSessionId: snapshot.sessionId,
            hasCodexConfig: !!plan.codexConfig,
          },
        });
        return describeLaunchResult(plan.terminalMode, snapshot);
      }

      await executeLaunchPlan(plan, {
        directoryExists,
        commandExists,
        spawnExternalTerminal,
      });
      sessionListCache.invalidate(request.provider);
      appLogger.info("launcher", "launch_success", "Launch command executed", {
        durationMs: Date.now() - startedAt,
        context: {
          provider: request.provider,
          profileKey: request.profile_key,
          launchMode: plan.launchMode,
          terminalMode: plan.terminalMode,
          cwd: plan.cwd,
          commandExecutable: plan.commandExecutable,
          hasCodexConfig: !!plan.codexConfig,
        },
      });
      return describeLaunchResult(plan.terminalMode);
    } catch (error) {
      if (plan.provider === "codex" && plan.terminalMode === "monitored") {
        appLogger.error("launcher", "launch_monitored_fallback", "Monitored launch failed, falling back to direct launch", {
          durationMs: Date.now() - startedAt,
          context: {
            provider: request.provider,
            profileKey: request.profile_key,
            launchMode: plan.launchMode,
            cwd: plan.cwd,
            commandExecutable: plan.commandExecutable,
          },
          error,
        });
        const fallbackPlan = getLaunchService().buildExecutionPlan({
          ...planRequest,
          terminal_mode: "direct",
        });
        await executeLaunchPlan(fallbackPlan, {
          directoryExists,
          commandExists,
          spawnExternalTerminal,
        });
        sessionListCache.invalidate(request.provider);
        appLogger.info("launcher", "launch_success", "Fallback direct launch executed", {
          durationMs: Date.now() - startedAt,
          context: {
            provider: request.provider,
            profileKey: request.profile_key,
            launchMode: fallbackPlan.launchMode,
            terminalMode: fallbackPlan.terminalMode,
            cwd: fallbackPlan.cwd,
            commandExecutable: fallbackPlan.commandExecutable,
            hasCodexConfig: !!fallbackPlan.codexConfig,
          },
        });
        return describeLaunchResult("direct");
      }
      throw error;
    }
  });

  // Sessions
  handleIpc(
    "session:list",
    async (_event, request: ListSessionsRequest) => {
      const codexHomes = await resolveCodexSessionHomes(request);
      const sessions = await sessionListCache.run({
        request,
        codexHomes,
        load: () => listSessionsForProvider(request, {
          listClaudeSessions,
          listCodexSessions: (sessionRequest) => codexHomes.length > 0
            ? listCodexSessionsFromHomes(sessionRequest, codexHomes)
            : listCodexSessions(sessionRequest),
        }),
      });
      appLogger.info("sessions", "session_list_finished", "Session list loaded", {
        context: {
          provider: request.provider,
          scope: request.scope,
          codexHomeCount: codexHomes.length,
          sessionCount: sessions.length,
        },
      });
      return sessions;
    },
  );

  handleIpc("session:refresh", async (_event, provider: string) => {
    sessionListCache.invalidate(provider);
    if (provider.trim().toLowerCase() === "codex") {
      invalidateCodexSessionCache();
    }
  }, { level: "debug" });

  handleIpc(
    "session:update-tab-state",
    async (_event, provider: string, patch: SessionsTabStatePatch) => {
      await getSettingsStateService().updateSessionsTabState(provider, patch);
    },
  );

  handleIpc(
    "session:update-favorites",
    async (_event, favorites: unknown) => {
      return getSettingsStateService().updateSessionFavorites(favorites);
    },
  );

  handleIpc("balance:test", async (_event, profileKey: ProfileKey) => {
    void runBalanceCheck(profileKey);
  });

  handleIpc(
    "balance:get-state",
    (_event, profileKey: ProfileKey): BalanceCheckState => {
      const state = getProfileService().getState();
      return state.balance_checks_by_profile[profileKey] ?? defaultBalanceCheckState();
    },
    { level: "debug" },
  );
  handleIpc("balance:clear-state", async (_event, profileKey: ProfileKey) => {
    const state = getProfileService().getState();
    if (state.balance_checks_by_profile[profileKey] === undefined) {
      emitBalanceProgress(profileKey, defaultBalanceCheckState());
      return;
    }
    delete state.balance_checks_by_profile[profileKey];
    await getProfileStateAccessor().save(state);
    emitBalanceProgress(profileKey, defaultBalanceCheckState());
  });

  handleIpc("model-mapping-config:get", async () => currentModelMappingsState(), { level: "debug" });
  handleIpc("model-mapping-config:save", async (_event, state: ModelMappingsState) => {
    const saved = await getModelMappingConfigService().save(state);
    modelMappingsStateCache = saved;
    return saved;
  });
  handleIpc("model-mapping-config:fetch-site-models", async (_event, draft: Pick<Profile, "url" | "key">) => {
    const startedAt = Date.now();
    try {
      const result = await getModelCatalogService().fetch({
        baseUrl: draft.url,
        apiKey: draft.key,
      });
      appLogger.info("model_catalog", "fetch_site_models_success", "Site models fetched", {
        durationMs: Date.now() - startedAt,
        context: {
          baseUrlHost: safeUrlHost(draft.url),
          modelCount: result.models.length,
        },
      });
      return result;
    } catch (error) {
      appLogger.error("model_catalog", "fetch_site_models_error", "Site models fetch failed", {
        durationMs: Date.now() - startedAt,
        context: {
          baseUrlHost: safeUrlHost(draft.url),
        },
        error,
      });
      throw error;
    }
  });

  // Parameter Settings
  handleIpc("parameter:get", (): ParameterSettings => {
    return getSettingsStateService().getParameterSettings();
  }, { level: "debug" });

  handleIpc(
    "parameter:update",
    async (_event, settings: Partial<ParameterSettings>) => {
      return getSettingsStateService().updateParameterSettings(settings);
    },
  );

  // Global Settings
  handleIpc("settings:get-global", (): GlobalSettings => {
    return getSettingsStateService().getGlobalSettings();
  }, { level: "debug" });

  handleIpc(
    "settings:update-global",
    async (_event, settings: Partial<GlobalSettings>) => {
      const updated = await getSettingsStateService().updateGlobalSettings(settings);
      applyNativeThemeMode(updated.theme_mode);
      for (const win of BrowserWindow.getAllWindows()) {
        win.setBackgroundColor(resolveWindowBackgroundColor());
      }
      return updated;
    },
  );

  handleIpc("dialog:unsaved-profile-action", async () => {
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

  handleIpc("dialog:launch-unsaved-profile", async () => {
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

app.setAppUserModelId(APP_ID);

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
  appLogger.info("app", "ready_start", "Electron app ready handler started");
  // 1. 先确定工作区根目录，但不执行 Skills 工作区初始化
  resolveProjectRoot();
  await syncNativeThemeFromLocalState();

  // 2. 先注册 IPC，再开窗；Profile 存储改为后台预热，不阻塞解锁页出现。
  registerAllIpcHandlers();
  appLogger.info("app", "ipc_handlers_registered", "IPC handlers registered");
  warmProfileStoresInBackground();

  // 3. 创建主窗口
  await createMainWindow();
  appLogger.info("app", "main_window_created", "Main window created");

  app.on("activate", async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  appLogger.info("app", "window_all_closed", "All windows closed");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  appLogger.error("process", "uncaught_exception", "Uncaught exception", { error });
});

process.on("unhandledRejection", (reason) => {
  appLogger.error("process", "unhandled_rejection", "Unhandled rejection", { error: reason });
});
