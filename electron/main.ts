import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  safeStorage,
  session as electronSession,
  shell,
  Tray,
} from "electron";
import path from "node:path";
import { existsSync, readFileSync, promises as fs } from "node:fs";
import os from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import readline from "node:readline";
import { randomBytes, randomUUID } from "node:crypto";
import {
  CODEDECK_PROJECT_ROOT_CONFIG_FILE,
  findNearestWorkspaceRoot,
  initializeWorkspace,
  resolveStartupProjectRoot,
  resolveWorkspaceLayout,
  type WorkspaceLayout,
} from "../src/shared/app-workspace.js";
import { resolveElectronRuntimePaths } from "../src/shared/electron-runtime-paths.js";
import { revealAndFocusMainWindow } from "../src/shared/electron/main-window-reactivation.js";
import { createChromiumFetch } from "../src/shared/electron/chromium-fetch.js";
import {
  buildCodexAppServerArgs,
  buildCodexDesktopThreadStartRequest,
  buildCodexDesktopNewThreadUrl,
  buildCodexDesktopThreadUrl,
  hasCodexDesktopHandoffMarker,
  validateCodexDesktopHandoffLaunch,
  validateCodexDesktopThreadProvider,
} from "../src/shared/electron/codex-desktop-handoff.js";
import {
  resolveDefaultPaths,
  type PreviewAction,
  CodeDeckSkillsService,
} from "../src/shared/skills-service.js";
import type { ProjectBatchAction, SkillHost } from "../src/shared/types.js";
import { CODEDECK_SKILLS_IPC_CHANNELS } from "../src/shared/code-deck-ipc.js";
import {
  APP_REACTIVATED_CHANNEL,
  type AppReactivationReason,
} from "../src/shared/app-reactivation.js";

// ---- Profile 相关导入 ----
import { EncryptedConfigStore } from "../src/shared/crypto/store.js";
import { AutoUnlockKeyStore } from "../src/shared/crypto/auto-unlock-key.js";
import { LocalStateStore } from "../src/shared/state/store.js";
import { ProfileService } from "../src/shared/services/profile-service.js";
import { LaunchService } from "../src/shared/services/launch-service.js";
import { CapabilityOverlayService } from "../src/shared/services/capability-overlay-service.js";
import { SettingsStateService, type SessionsTabStatePatch } from "../src/shared/services/settings-state-service.js";
import {
  ModelMappingConfigService,
  buildCodexSiteProviderId,
  resolveCodexSiteProviderToken,
} from "../src/shared/services/model-mapping-config-service.js";
import { ModelCatalogService } from "../src/shared/services/model-catalog-service.js";
import { BalanceService, normalizeBalanceBaseUrl } from "../src/shared/services/balance-service.js";
import {
  CustomCompatibilityExecutor,
  type CustomCompatibilityExecutionOptions,
} from "../src/shared/services/custom-compatibility-executor.js";
import {
  isCustomCredentialForwardingAllowed,
  normalizeSiteCustomCompatibility,
  type CustomBalanceRule,
  type CustomCheckinRule,
  type SiteCustomCompatibility,
} from "../src/shared/services/custom-compatibility.js";
import {
  CheckinService,
  type CheckinDiagnosticAttempt,
} from "../src/shared/services/checkin-service.js";
import { CheckinScheduler } from "../src/shared/services/checkin-scheduler.js";
import {
  buildProfileHealthPrompt,
  classifyProfileHealthCliFailure,
  createCompletedProfileHealthState,
  createFailedProfileHealthState,
  createPassiveProfileHealthState,
  createRunningProfileHealthState,
} from "../src/shared/profile-health/service.js";
import {
  buildProfileHealthTarget,
  profileHealthTargetKey,
  profileHealthRequestMatchesSavedProfile,
  type ProfileHealthProgressEvent,
  type ProfileHealthState,
  type ProfileHealthTarget,
  type ProfileHealthTestRequest,
  type ProfileHealthTestResult,
} from "../src/shared/profile-health/types.js";
import type { ManagementRequestContext } from "../src/shared/services/management-auth.js";
import {
  CheckinVerificationService,
  type CheckinVerificationDiagnosticEvent,
} from "../src/shared/electron/checkin-verification-service.js";
import {
  CustomElementSelectorService,
  type CustomElementSelectorResult,
} from "../src/shared/electron/custom-element-selector-service.js";
import { CustomCompatibilityPageService } from "../src/shared/electron/custom-compatibility-page-service.js";
import {
  BrowserAccountSessionManager,
  BrowserLoginRequiredError,
  type BrowserAccountDiagnosticEvent,
  type BrowserAccountStatusSnapshot,
  browserPartitionName,
} from "../src/shared/electron/browser-account-session-manager.js";
import { PendingBrowserAccountReferenceRegistry } from "../src/shared/electron/browser-account-pending-references.js";
import {
  allocateBrowserSlot,
  buildProfileBalanceCheckState,
  resolveBalanceAuth,
  resolveSharedBalanceProfileKeys,
  type SiteBalanceSessionDraft,
  type SiteBalanceSession,
  type SiteBalanceSessionsByBaseUrl,
  type BrowserIdentitySlot,
  type EncryptedProfileConfig,
  normalizeBrowserOrigin,
  normalizeEncryptedProfileConfig,
  normalizeBrowserSlot,
} from "../src/shared/balance/site-balance-sessions.js";
import {
  buildCheckinAccountKey,
  localDateKey,
  type CheckinAccountState,
  type CheckinBatchSummary,
  type CheckinResult,
  type CheckinSnapshot,
  type CheckinTrigger,
  type CheckinVerificationResult,
} from "../src/shared/checkin/types.js";
import {
  CheckinExecutionQueue,
  settleCheckinsSequentially,
} from "../src/shared/checkin/execution-queue.js";
import { pickDirectoryPath } from "../src/shared/electron/dialog-helpers.js";
import { createAppLogger, createIpcHandlerLogger } from "../src/shared/electron/debug-log.js";
import { SessionCatalog } from "../src/shared/electron/session-catalog.js";
import { createSessionListCache } from "../src/shared/electron/session-list-cache.js";
import type { EncryptionSetupStatus } from "../src/shared/encryption-status.js";
import {
  buildWindowsPtyLaunchSpec,
  executeLaunchPlan,
  type ExternalTerminalLaunchSpec,
} from "../src/shared/electron/launch-runtime.js";
import {
  DEFAULT_PROFILE_BROWSER_PARTITION,
  resolveBaseUrlBrowserTarget,
} from "../src/shared/electron/open-url.js";
import {
  customCompatibilityPartitionName,
  resolveProfileBrowserPartitionRequest,
} from "../src/shared/electron/profile-browser-partition.js";
import {
  runBrowserNavigationAction,
  type BrowserNavigationAction,
} from "../src/shared/electron/browser-navigation.js";
import {
  TerminalSessionManager,
  type CreatePtyProcessOptions,
  type TerminalSessionAutoContinueEvent,
  type TerminalSessionActivityEvent,
  type TerminalSessionSnapshot,
} from "../src/shared/electron/terminal-session-manager.js";
import { resolveTerminalTaskbarAction } from "../src/shared/electron/terminal-taskbar.js";
import { parseTerminalTurnLifecycleLine } from "../src/shared/electron/terminal-turn-lifecycle.js";
import {
  buildTerminalWindowTitle,
  normalizeTerminalDisplayTitle,
} from "../src/shared/electron/terminal-session-title.js";
import type { TerminalAutoContinueConfigPatch } from "../src/shared/electron/terminal-auto-continue.js";
import {
  isCapabilityPathCurrent,
  type LearnedBalancePath,
  type LearnedCheckinPath,
} from "../src/shared/site-capability-cache.js";
import {
  assertCanonicalCodexSessionSource,
  findMonitoredTerminalSessionTitle,
  getClaudeSessionDetail,
  getCodexSessionDetail,
  getSessionDetailForProvider,
  invalidateCodexSessionCache,
  listClaudeSessions,
  listCodexSessions,
  listCodexSessionsFromHomes,
  listSessionsForProvider,
  readLastAssistantTextFromSessionFile,
  resolveMonitoredTerminalSessionFile,
  type CodexSessionHome,
  type GetSessionDetailRequest,
  type ListSessionsRequest,
} from "../src/shared/services/session-service.js";
import {
  ensureProfileHealthCodexHome,
  resolveCanonicalCodexHome,
} from "../src/shared/services/codex-home.js";
import {
  type BootstrapResult,
  type LocalState,
} from "../src/shared/state/local-state.js";
import {
  defaultRuntimeSettings,
  getProfileApiKey,
  isOfficialNativeProfile,
  withOfficialNativeProfiles,
  type Profile,
  type ProfileKey,
  type RuntimeSettings,
  type GlobalSettings,
} from "../src/shared/profile/types.js";
import { itemKey } from "../src/shared/profile/keys-internal.js";
import type { ProfileOrganization } from "../src/shared/profile/organization.js";
import type { LaunchRequest, LaunchResult, CommandPreview } from "../src/shared/launcher/types.js";
import {
  defaultBalanceCheckState,
  type BalanceCheckState,
} from "../src/shared/balance/types.js";
import { defaultParameterSettings, type ParameterSettings } from "../src/shared/parameter/types.js";
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
import { AgentBridgeServer } from "../src/shared/agent-bridge/server.js";
import {
  AgentTaskManager,
  type AgentTaskLaunchOptions,
} from "../src/shared/agent-bridge/task-manager.js";
import { cleanTerminalText } from "../src/shared/agent-bridge/protocol.js";
import {
  hasTerminalCliReadyPrompt,
  normalizeTerminalPromptInput,
} from "../src/shared/electron/terminal-prompt-input.js";
import {
  AGENT_BRIDGE_CONNECTION_FILE,
  AgentBridgeRequestError,
  type AgentBridgeRequest,
  type AgentBridgeResponse,
  type AgentProfileSummary,
} from "../src/shared/agent-bridge/types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- 应用路径常量 ----
const ENCRYPTED_DATA_FILE = "claude_profiles.encrypted.json";
const LEGACY_DATA_FILE = "profiles.json";
const LOCAL_STATE_FILE = "local_state.json";
const AUTO_UNLOCK_KEY_FILE = "profile-auto-unlock-key.json";
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
let customCompatibilityExecutor: CustomCompatibilityExecutor | null = null;
let customCompatibilityPageService: CustomCompatibilityPageService | null = null;
const customCompatibilityFetchesByPartition = new Map<string, typeof fetch>();
let checkinService: CheckinService | null = null;
let checkinScheduler: CheckinScheduler | null = null;
let checkinVerificationService: CheckinVerificationService | null = null;
let customElementSelectorService: CustomElementSelectorService | null = null;
let browserAccountSessionManager: BrowserAccountSessionManager | null = null;
let pendingBrowserAccountReferences: PendingBrowserAccountReferenceRegistry | null = null;
let browserAccountRuntimeShutdownPromise: Promise<void> | null = null;
let browserAccountRuntimeCleanupCompletedForQuit = false;
let modelMappingsStateCache: ModelMappingsState | null = null;
let encryptedStore: EncryptedConfigStore | null = null;
let autoUnlockKeyStore: AutoUnlockKeyStore | null = null;
let localStateStore: LocalStateStore | null = null;
let sessionCatalog: SessionCatalog | null = null;
let profileStateAccessor: StateAccessor | null = null;
let currentPassphrase: string = "";
const legacyCleanupWarnings = new Set<string>();
let mainWindow: BrowserWindow | null = null;
const profileBrowserWindows = new Set<BrowserWindow>();
const PROFILE_BROWSER_NAVIGATION_TIMEOUT_MS = 30_000;
let appTray: Tray | null = null;
let closeToTrayEnabled = false;
let isExplicitlyQuitting = false;
let skillsInitPromise: Promise<void> | null = null;
let profileStoresInitPromise: Promise<void> | null = null;
const sessionListCache = createSessionListCache({ ttlMs: 60_000 });
type NodePtyModule = typeof import("node-pty");
let nodePtyModule: NodePtyModule | null = null;
let nodePtyLoadPromise: Promise<NodePtyModule> | null = null;
let checkinStateWriteQueue: Promise<void> = Promise.resolve();
let profileHealthStateWriteQueue: Promise<void> = Promise.resolve();
const checkinExecutionQueue = new CheckinExecutionQueue();
const checkinRunsByAccount = new Map<string, Promise<CheckinResult>>();
const deferredCheckinStates = new Map<string, CheckinAccountState>();
const deferredCheckinCapabilityPaths = new Map<string, LearnedCheckinPath | null>();
const queuedBalanceRefreshAccounts = new Set<string>();
const balanceRefreshQueue: SiteBalanceSession[] = [];
let activeBalanceRefreshCount = 0;
const MAX_BALANCE_REFRESH_CONCURRENCY = 3;
let agentBridgeServer: AgentBridgeServer | null = null;
let agentTaskManager: AgentTaskManager | null = null;

async function ensureNodePtyLoaded(): Promise<NodePtyModule> {
  if (nodePtyModule) {
    return nodePtyModule;
  }
  if (!nodePtyLoadPromise) {
    nodePtyLoadPromise = import("node-pty")
      .then((loadedModule) => {
        nodePtyModule = loadedModule;
        return loadedModule;
      })
      .catch((error: unknown) => {
        nodePtyLoadPromise = null;
        throw error;
      });
  }
  return nodePtyLoadPromise;
}

function invalidateSessionCaches(provider: string): void {
  sessionListCache.invalidate(provider);
  if (provider.trim().toLowerCase() === "codex") {
    invalidateCodexSessionCache();
  }
}

const terminalSessionManager = new TerminalSessionManager({
  createPtyProcess: createNodePtyProcess,
  onAutoContinueEvent: logTerminalAutoContinueEvent,
  onActivityChange: handleTerminalActivityChange,
});
const terminalAttachmentDisposers = new Map<string, () => void>();
const managedTerminalParentTokens = new Map<string, string>();
const terminalIdlePromptSessions = new Set<string>();
const terminalWindows = new Map<string, BrowserWindow>();
const terminalFlashTimers = new Map<string, NodeJS.Timeout>();
const terminalTitlePollTimers = new Map<string, NodeJS.Timeout>();
interface TerminalLifecycleWatcher {
  filePath: string;
  provider: string;
  startedAtMs: number;
  offset: number;
  remainder: string;
  initialized: boolean;
  polling: boolean;
  timer?: NodeJS.Timeout;
}
const terminalLifecycleWatchers = new Map<string, TerminalLifecycleWatcher>();
const terminalProfileHealthTargets = new Map<string, ProfileHealthTarget>();
interface ActiveProfileHealthTurnWaiter {
  resolve: (filePath: string) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}
const activeProfileHealthTurnWaiters = new Map<string, ActiveProfileHealthTurnWaiter>();
const completedTerminalTurnFiles = new Map<string, string>();
const profileHealthRunsByTarget = new Map<string, Promise<ProfileHealthTestResult>>();
let profileHealthCliQueue: Promise<void> = Promise.resolve();
const TERMINAL_TITLE_POLL_INTERVAL_MS = 2_000;
const TERMINAL_TITLE_POLL_TIMEOUT_MS = 60_000;
const TERMINAL_LIFECYCLE_POLL_INTERVAL_MS = 750;
const TERMINAL_LIFECYCLE_INITIAL_TAIL_BYTES = 1_048_576;
const PROFILE_HEALTH_ASSISTANT_READ_RETRY_MS = [0, 75, 150, 300] as const;
const PROFILE_HEALTH_CLAUDE_READY_TIMEOUT_MS = 60_000;
const PROFILE_HEALTH_CLAUDE_INPUT_SETTLE_MS = 1_000;
const PROFILE_HEALTH_CLAUDE_SUBMIT_DELAY_MS = 250;
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
    delayMs: event.delayMs,
    subscriberCount: event.subscriberCount,
    visibleExcerpt: event.visibleExcerpt,
    failureEpisodeId: event.failureEpisodeId,
    failureState: event.failureState,
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
    && autoUnlockKeyStore
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

async function writeManagedLaunchTextFile(targetPath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
}

async function getEncryptionSetupStatus(): Promise<EncryptionSetupStatus> {
  await ensureProfileStoresReady();
  const status = await encryptedStore!.getStatus();
  if (
    status.mode === "unlock"
    && status.source === "canonical"
    && await autoUnlockKeyStore!.exists()
  ) {
    return { mode: "auto-unlock", source: "canonical" };
  }
  return status;
}

function takeLegacyCleanupWarnings(): string[] | undefined {
  if (legacyCleanupWarnings.size === 0) {
    return undefined;
  }
  const warnings = [...legacyCleanupWarnings];
  legacyCleanupWarnings.clear();
  return warnings;
}

function resolveWindowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? "#111827" : "#f2efe7";
}

async function syncNativeThemeFromLocalState(): Promise<void> {
  const stateStore = localStateStore ?? new LocalStateStore(getLocalStatePath());
  const state = await stateStore.load();
  applyNativeThemeMode(state.global_settings.theme_mode);
  syncCloseToTraySetting(state.global_settings.close_to_tray);
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
  const portableWorkspaceRoot = findNearestWorkspaceRoot({
    startDirectories: [
      path.dirname(process.execPath),
      process.resourcesPath,
      process.cwd(),
    ],
    isWorkspaceRoot: (directory) => (
      existsSync(path.join(directory, "package.json"))
      && existsSync(path.join(directory, "app-data"))
    ),
  });

  return resolveStartupProjectRoot({
    projectRootFileContents: getProjectRootConfigFileCandidates().map(readProjectRootConfigFile),
    portableWorkspaceRoot,
    envProjectRoot: process.env[CODEDECK_PROJECT_ROOT_ENV],
  });
}

function stopTerminalTaskbarFlash(sessionId: string, browserWindow?: BrowserWindow): void {
  const timer = terminalFlashTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    terminalFlashTimers.delete(sessionId);
  }
  if (browserWindow && !browserWindow.isDestroyed() && process.platform === "win32") {
    browserWindow.flashFrame(false);
  }
}

function applyTerminalTaskbarActivity(
  sessionId: string,
  event: Pick<TerminalSessionActivityEvent, "previousActivity" | "activity" | "reason">,
): void {
  const browserWindow = terminalWindows.get(sessionId);
  if (!browserWindow || browserWindow.isDestroyed()) {
    return;
  }
  const action = resolveTerminalTaskbarAction({
    platform: process.platform,
    previousActivity: event.previousActivity,
    activity: event.activity,
    reason: event.reason,
    focused: browserWindow.isFocused(),
  });
  if (action.progress === null) {
    return;
  }
  stopTerminalTaskbarFlash(sessionId, browserWindow);
  if (action.progress === 2) {
    browserWindow.setProgressBar(2, { mode: "indeterminate" });
  } else {
    browserWindow.setProgressBar(-1);
  }
  if (action.flash) {
    browserWindow.flashFrame(true);
    terminalFlashTimers.set(sessionId, setTimeout(() => {
      terminalFlashTimers.delete(sessionId);
      if (!browserWindow.isDestroyed()) {
        browserWindow.flashFrame(false);
      }
    }, 3_000));
  }
}

class ProfileHealthTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`健康检测超时（${timeoutMs}ms）`);
    this.name = "ProfileHealthTimeoutError";
  }
}

function settleActiveProfileHealthTurn(
  sessionId: string,
  outcome: { filePath: string } | { error: Error },
): boolean {
  const waiter = activeProfileHealthTurnWaiters.get(sessionId);
  if (!waiter) return false;
  activeProfileHealthTurnWaiters.delete(sessionId);
  clearTimeout(waiter.timer);
  if ("filePath" in outcome) {
    waiter.resolve(outcome.filePath);
  } else {
    waiter.reject(outcome.error);
  }
  return true;
}

function handleTerminalActivityChange(event: TerminalSessionActivityEvent): void {
  agentTaskManager?.handleActivityChange(event);
  if (event.reason === "idle_prompt") {
    terminalIdlePromptSessions.add(event.sessionId);
  }
  if (event.reason === "turn_completed") {
    const healthWatcher = terminalLifecycleWatchers.get(event.sessionId);
    if (activeProfileHealthTurnWaiters.has(event.sessionId)) {
      settleActiveProfileHealthTurn(
        event.sessionId,
        healthWatcher
          ? { filePath: healthWatcher.filePath }
          : { error: new Error("健康检测会话已完成，但未解析到会话 JSONL 文件") },
      );
    } else {
      if (healthWatcher) {
        completedTerminalTurnFiles.set(event.sessionId, healthWatcher.filePath);
      }
      const target = terminalProfileHealthTargets.get(event.sessionId);
      if (target) {
        void updatePassiveProfileHealth(target);
      }
    }
  }
  if (event.reason === "process_exit" || event.reason === "session_closed") {
    terminalIdlePromptSessions.delete(event.sessionId);
    const snapshot = terminalSessionManager.getSnapshot(event.sessionId);
    const output = cleanTerminalText(snapshot?.output ?? "").slice(-2_000);
    settleActiveProfileHealthTurn(
      event.sessionId,
      { error: new Error(output || `健康 CLI 会话异常结束：${event.reason}`) },
    );
    completedTerminalTurnFiles.delete(event.sessionId);
    managedTerminalParentTokens.delete(event.sessionId);
    terminalProfileHealthTargets.delete(event.sessionId);
  }
  applyTerminalTaskbarActivity(event.sessionId, event);
  appLogger.info("terminal", "activity_changed", "Monitored terminal activity changed", {
    context: {
      provider: event.provider,
      sessionId: event.sessionId,
      previousActivity: event.previousActivity,
      activity: event.activity,
      reason: event.reason,
    },
  });
}

function broadcastProfileHealthProgress(event: ProfileHealthProgressEvent): void {
  for (const win of getCodeDeckWindows()) {
    win.webContents.send("profile-health:progress", event);
  }
}

function enqueueProfileHealthStateUpdate(
  update: (state: LocalState) => void,
): Promise<void> {
  profileHealthStateWriteQueue = profileHealthStateWriteQueue
    .catch(() => undefined)
    .then(async () => {
      const svc = getProfileService();
      const state = svc.getState();
      update(state);
      await profileStateAccessor?.save(state);
    });
  return profileHealthStateWriteQueue;
}

async function updatePassiveProfileHealth(target: ProfileHealthTarget): Promise<void> {
  const targetKey = profileHealthTargetKey(target);
  await enqueueProfileHealthStateUpdate((state) => {
    const previous = state.profile_health_by_target[targetKey];
    state.profile_health_by_target[targetKey] = createPassiveProfileHealthState(target, previous);
  });
}

function resolveSavedProfileHealthMatch(request: ProfileHealthTestRequest): Profile | null {
  const requestedKey = request.profile_key?.trim() ?? "";
  if (!requestedKey) return null;
  const saved = getProfileService().getProfiles().find((profile) => itemKey(profile) === requestedKey);
  if (!saved || isOfficialNativeProfile(saved)) return null;
  return profileHealthRequestMatchesSavedProfile(saved, request) ? saved : null;
}

function waitForProfileHealthTurn(sessionId: string, timeoutMs: number): Promise<string> {
  const completedFile = completedTerminalTurnFiles.get(sessionId);
  if (completedFile) {
    completedTerminalTurnFiles.delete(sessionId);
    return Promise.resolve(completedFile);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      settleActiveProfileHealthTurn(sessionId, { error: new ProfileHealthTimeoutError(timeoutMs) });
    }, timeoutMs);
    activeProfileHealthTurnWaiters.set(sessionId, { resolve, reject, timer });
    const snapshot = terminalSessionManager.getSnapshot(sessionId);
    if (!snapshot || snapshot.status !== "running") {
      const output = cleanTerminalText(snapshot?.output ?? "").slice(-2_000);
      settleActiveProfileHealthTurn(sessionId, {
        error: new Error(output || "健康 CLI 会话在等待回合完成前已退出"),
      });
    }
  });
}

function enqueueProfileHealthCliProbe(
  run: () => Promise<ProfileHealthState>,
): Promise<ProfileHealthState> {
  const queued = profileHealthCliQueue.then(run, run);
  profileHealthCliQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

async function submitClaudeProfileHealthPrompt(
  sessionId: string,
  prompt: string,
): Promise<void> {
  const input = normalizeTerminalPromptInput(prompt);
  await new Promise<void>((resolve, reject) => {
    let output = "";
    let readyTimer: NodeJS.Timeout | undefined;
    let disposeAttachment = (): void => undefined;
    const timeout = setTimeout(() => {
      dispose();
      reject(new Error("Claude CLI 在 60 秒内未进入可输入状态"));
    }, PROFILE_HEALTH_CLAUDE_READY_TIMEOUT_MS);
    disposeAttachment = terminalSessionManager.attachSession(sessionId, {
      onOutput: (chunk) => {
        output = (output + chunk).slice(-16_000);
        const visibleTail = cleanTerminalText(output).slice(-8_000);
        if (!hasTerminalCliReadyPrompt(visibleTail)) return;
        if (readyTimer) clearTimeout(readyTimer);
        readyTimer = setTimeout(() => {
          const snapshot = terminalSessionManager.getSnapshot(sessionId);
          if (snapshot?.status !== "running") {
            dispose();
            reject(new Error("Claude CLI 在提交健康检测提示前已退出"));
            return;
          }
          terminalSessionManager.sendInput(sessionId, input.data);
          setTimeout(() => {
            const current = terminalSessionManager.getSnapshot(sessionId);
            if (input.submitSeparately && current?.status === "running") {
              terminalSessionManager.sendInput(sessionId, "\r");
            }
          }, PROFILE_HEALTH_CLAUDE_SUBMIT_DELAY_MS);
          dispose();
          resolve();
        }, PROFILE_HEALTH_CLAUDE_INPUT_SETTLE_MS);
      },
      onStatus: (snapshot) => {
        if (snapshot.status === "running") return;
        dispose();
        reject(new Error(`Claude CLI 在提交健康检测提示前退出，代码 ${snapshot.exitCode ?? "未知"}`));
      },
    });
    function dispose(): void {
      clearTimeout(timeout);
      if (readyTimer) clearTimeout(readyTimer);
      disposeAttachment();
    }
  });
}

async function readProfileHealthAssistantText(filePath: string): Promise<string> {
  for (const delayMs of PROFILE_HEALTH_ASSISTANT_READ_RETRY_MS) {
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    try {
      const assistantText = (await readLastAssistantTextFromSessionFile(filePath)).trim();
      if (assistantText) return assistantText;
    } catch {
      // A just-written JSONL record can be briefly unavailable; retry only the read.
    }
  }
  return "";
}

async function runProfileHealthCliProbe(options: {
  profile: Profile;
  target: ProfileHealthTarget;
  previous?: ProfileHealthState;
  timeoutMs: number;
}): Promise<ProfileHealthState> {
  const startedAt = Date.now();
  const checkedAt = new Date(startedAt).toISOString();
  const service = getProfileService();
  const savedRuntime = service.getState().runtime_by_profile[options.target.profile_key]
    ?? defaultRuntimeSettings(options.profile.provider);
  const runtime: RuntimeSettings = {
    ...savedRuntime,
    launch_mode: "new",
    terminal_mode: "monitored",
    startup_mode: "managed",
    extra_env: { ...savedRuntime.extra_env },
  };
  const prompt = buildProfileHealthPrompt(options.previous?.checkpoint);
  const request: LaunchRequest = {
    profile_key: options.target.profile_key,
    provider: options.profile.provider,
    runtime_settings: runtime,
    terminal_mode: "monitored",
    permission_override: "readonly",
    model_override: options.target.model_id,
    disable_codex_hooks: true,
  };
  let terminalSessionId = "";
  try {
    const profileHealthCodexHome = options.target.provider === "codex"
      ? await ensureProfileHealthCodexHome(runtime.cwd)
      : undefined;
    const { plan } = await prepareLaunchExecution(request, {
      codexHomeOverride: profileHealthCodexHome,
    });
    const initialPromptEnvKey = "CODEDECK_AGENT_INITIAL_PROMPT_BASE64";
    const initialPromptBase64 = Buffer.from(prompt, "utf8").toString("base64");
    const codexLaunchPlan = options.target.provider === "codex"
      ? { ...plan, agentInitialPromptEnvKey: initialPromptEnvKey }
      : plan;
    const snapshot = await launchMonitoredTerminalSession(codexLaunchPlan, {
      showWindow: false,
      expectedPreview: prompt,
      ...(options.target.provider === "codex"
        ? { additionalEnv: { [initialPromptEnvKey]: initialPromptBase64 } }
        : {}),
    });
    terminalSessionId = snapshot.sessionId;
    const completedFile = waitForProfileHealthTurn(terminalSessionId, options.timeoutMs);
    const filePath = options.target.provider === "claude"
      ? (await Promise.all([
          submitClaudeProfileHealthPrompt(terminalSessionId, prompt),
          completedFile,
        ]))[1]
      : await completedFile;
    const assistantText = await readProfileHealthAssistantText(filePath);
    const latencyMs = Date.now() - startedAt;
    if (!assistantText) {
      return createFailedProfileHealthState({
        target: options.target,
        previous: options.previous,
        status: "model_unavailable",
        reasonCode: "empty_response",
        message: "CLI 回合已完成，但会话 JSONL 中没有可读取的 assistant 文本",
        checkedAt,
        latencyMs,
      });
    }
    return createCompletedProfileHealthState({
      target: options.target,
      previous: options.previous,
      assistantText,
      checkedAt,
      latencyMs,
    });
  } catch (error) {
    const snapshot = terminalSessionId
      ? terminalSessionManager.getSnapshot(terminalSessionId)
      : undefined;
    const terminalEvidence = cleanTerminalText(snapshot?.output ?? "").slice(-4_000);
    const errorEvidence = error instanceof Error ? error.message : String(error ?? "");
    const failure = classifyProfileHealthCliFailure(
      [errorEvidence, terminalEvidence].filter(Boolean).join("\n"),
      {
        timedOut: error instanceof ProfileHealthTimeoutError,
        secrets: [getProfileApiKey(options.profile)],
      },
    );
    return createFailedProfileHealthState({
      target: options.target,
      previous: options.previous,
      status: failure.status,
      reasonCode: failure.reasonCode,
      message: failure.message,
      checkedAt,
      latencyMs: Date.now() - startedAt,
    });
  } finally {
    if (terminalSessionId) {
      settleActiveProfileHealthTurn(
        terminalSessionId,
        { error: new Error("健康检测会话已结束") },
      );
      stopTerminalTitleResolution(terminalSessionId);
      stopTerminalLifecycleWatcher(terminalSessionId);
      completedTerminalTurnFiles.delete(terminalSessionId);
      try {
        await terminalSessionManager.closeSession(terminalSessionId, "profile_health_completed");
      } catch {
        // The PTY may already have exited; cleanup is best effort in that case.
      }
    }
  }
}

async function testProfileHealth(request: ProfileHealthTestRequest): Promise<ProfileHealthTestResult> {
  if (isOfficialNativeProfile(request.profile)) {
    throw new Error("官方原生 Profile 不支持主动健康检测");
  }
  const savedProfile = resolveSavedProfileHealthMatch(request);
  if (!savedProfile) {
    throw new Error("请先保存 Profile，并确保当前表单没有未保存修改");
  }
  const profileKey = itemKey(savedProfile);
  const target = buildProfileHealthTarget(savedProfile, profileKey);
  const targetKey = profileHealthTargetKey(target);
  const runtime = getProfileService().getState().runtime_by_profile[profileKey]
    ?? defaultRuntimeSettings(savedProfile.provider);
  if (!target.base_url || !getProfileApiKey(savedProfile).trim() || !target.model_id) {
    throw new Error("检测需要当前渠道的 Base URL、API Key 和模型 ID");
  }
  if (!runtime.cwd.trim() || !runtime.command_base.trim()) {
    throw new Error("检测需要已保存的工作目录和 CLI 命令");
  }
  const currentRun = profileHealthRunsByTarget.get(targetKey);
  if (currentRun) {
    return currentRun;
  }

  const run = (async (): Promise<ProfileHealthTestResult> => {
    const previous = getProfileService().getState().profile_health_by_target[targetKey];
    const runningState = createRunningProfileHealthState(target, previous);
    const runningEvent: ProfileHealthProgressEvent = {
      target_key: targetKey,
      state: runningState,
      persisted: true,
    };
    await enqueueProfileHealthStateUpdate((state) => {
      state.profile_health_by_target[targetKey] = runningState;
    });
    broadcastProfileHealthProgress(runningEvent);

    const resultState = await enqueueProfileHealthCliProbe(() =>
      runProfileHealthCliProbe({
        profile: savedProfile,
        target,
        previous,
        timeoutMs: getProfileService().getState().parameter_settings.connectivity_test_timeout_ms,
      }));
    const persisted = Boolean(resolveSavedProfileHealthMatch(request));
    if (persisted) {
      await enqueueProfileHealthStateUpdate((state) => {
        state.profile_health_by_target[targetKey] = resultState;
      });
    }
    const result = { target_key: targetKey, state: resultState, persisted };
    broadcastProfileHealthProgress(result);
    return result;
  })();

  profileHealthRunsByTarget.set(targetKey, run);
  try {
    return await run;
  } finally {
    if (profileHealthRunsByTarget.get(targetKey) === run) {
      profileHealthRunsByTarget.delete(targetKey);
    }
  }
}

function stopTerminalLifecycleWatcher(sessionId: string): void {
  const watcher = terminalLifecycleWatchers.get(sessionId);
  if (watcher?.timer) {
    clearTimeout(watcher.timer);
  }
  terminalLifecycleWatchers.delete(sessionId);
}

async function pollTerminalLifecycle(sessionId: string): Promise<void> {
  const watcher = terminalLifecycleWatchers.get(sessionId);
  const snapshot = terminalSessionManager.getSnapshot(sessionId);
  if (!watcher || !snapshot || snapshot.status !== "running") {
    stopTerminalLifecycleWatcher(sessionId);
    return;
  }
  if (watcher.polling) {
    return;
  }
  watcher.polling = true;
  try {
    const stat = await fs.stat(watcher.filePath);
    if (stat.size < watcher.offset) {
      watcher.offset = 0;
      watcher.remainder = "";
      watcher.initialized = false;
    }
    const readFrom = watcher.initialized
      ? watcher.offset
      : Math.max(0, stat.size - TERMINAL_LIFECYCLE_INITIAL_TAIL_BYTES);
    if (stat.size > readFrom) {
      const length = stat.size - readFrom;
      const buffer = Buffer.alloc(length);
      const handle = await fs.open(watcher.filePath, "r");
      try {
        await handle.read(buffer, 0, length, readFrom);
      } finally {
        await handle.close();
      }
      const initialRead = !watcher.initialized;
      const combined = `${initialRead ? "" : watcher.remainder}${buffer.toString("utf8")}`;
      const lines = combined.split(/\r?\n/);
      watcher.remainder = lines.pop() ?? "";
      if (initialRead && readFrom > 0) {
        lines.shift();
      }
      watcher.offset = stat.size;
      watcher.initialized = true;

      for (const line of lines) {
        const event = parseTerminalTurnLifecycleLine(watcher.provider, line);
        if (!event) {
          continue;
        }
        if (
          initialRead
          && (event.timestampMs === undefined || event.timestampMs < watcher.startedAtMs - 1_000)
        ) {
          continue;
        }
        terminalSessionManager.reportTurnLifecycle(sessionId, event.phase);
        appLogger.info("terminal", "turn_lifecycle", "Monitored terminal turn lifecycle changed", {
          context: {
            provider: watcher.provider,
            sessionId,
            phase: event.phase,
            source: "session_jsonl",
          },
        });
      }
    } else if (!watcher.initialized) {
      watcher.offset = stat.size;
      watcher.initialized = true;
    }
  } catch (error) {
    appLogger.debug("terminal", "turn_lifecycle_poll_failed", "Failed to poll terminal turn lifecycle", {
      context: { provider: watcher.provider, sessionId },
      error,
    });
  } finally {
    watcher.polling = false;
    if (terminalLifecycleWatchers.get(sessionId) === watcher) {
      watcher.timer = setTimeout(() => {
        void pollTerminalLifecycle(sessionId);
      }, TERMINAL_LIFECYCLE_POLL_INTERVAL_MS);
    }
  }
}

function startTerminalLifecycleWatcher(
  sessionId: string,
  provider: string,
  filePath: string,
  startedAt: Date,
): void {
  stopTerminalLifecycleWatcher(sessionId);
  terminalLifecycleWatchers.set(sessionId, {
    filePath,
    provider,
    startedAtMs: startedAt.getTime(),
    offset: 0,
    remainder: "",
    initialized: false,
    polling: false,
  });
  void pollTerminalLifecycle(sessionId);
}

function getProjectRootConfigFileCandidates(): string[] {
  const candidateDirectories = [
    process.cwd(),
    path.dirname(process.execPath),
    process.resourcesPath,
    appRoot,
  ];
  const seen = new Set<string>();
  return candidateDirectories
    .map((directory) => path.join(directory, CODEDECK_PROJECT_ROOT_CONFIG_FILE))
    .filter((candidate) => {
      const resolved = path.resolve(candidate);
      if (seen.has(resolved)) {
        return false;
      }
      seen.add(resolved);
      return true;
    });
}

function readProjectRootConfigFile(filePath: string): string | undefined {
  try {
    if (!existsSync(filePath)) {
      return undefined;
    }
    return readFileSync(filePath, "utf8");
  } catch {
    return undefined;
  }
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

function getCustomCompatibilityExecutor(): CustomCompatibilityExecutor {
  if (!customCompatibilityExecutor) {
    customCompatibilityExecutor = new CustomCompatibilityExecutor();
  }
  return customCompatibilityExecutor;
}

function getCustomCompatibilityPageService(): CustomCompatibilityPageService {
  if (!customCompatibilityPageService) {
    customCompatibilityPageService = new CustomCompatibilityPageService({
      createSession: (partition) => electronSession.fromPartition(partition),
      createWindow: (options) => new BrowserWindow(options),
      getParentWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      windowIcon: resolveWindowIconPath(),
    });
  }
  return customCompatibilityPageService;
}

function getCheckinService(): CheckinService {
  if (!checkinService) throw new Error("签到服务尚未初始化。");
  return checkinService;
}

function getCheckinVerificationService(): CheckinVerificationService {
  if (!checkinVerificationService) {
    checkinVerificationService = new CheckinVerificationService({
      createSession: (partition) => electronSession.fromPartition(partition, { cache: false }),
      createWindow: (options) => new BrowserWindow(options),
      getParentWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      windowIcon: resolveWindowIconPath(),
      onDiagnostic: logCheckinVerificationDiagnostic,
    });
  }
  return checkinVerificationService;
}

function getCustomElementSelectorService(): CustomElementSelectorService {
  if (!customElementSelectorService) {
    customElementSelectorService = new CustomElementSelectorService({
      createSession: (partition) => electronSession.fromPartition(partition),
      createWindow: (options) => new BrowserWindow(options),
      getParentWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      windowIcon: resolveWindowIconPath(),
    });
  }
  return customElementSelectorService;
}

function getBrowserAccountSessionManager(): BrowserAccountSessionManager {
  if (!browserAccountSessionManager) {
    browserAccountSessionManager = new BrowserAccountSessionManager({
      createSession: (partition) => electronSession.fromPartition(partition, { cache: false }),
      createWindow: (options) => new BrowserWindow(options),
      configureInteractiveWindow: installBrowserNavigationMenu,
      getParentWindow: () => mainWindow && !mainWindow.isDestroyed() ? mainWindow : null,
      windowIcon: resolveWindowIconPath(),
      onStatusChange: emitBrowserAccountStatus,
      onDiagnostic: logBrowserAccountDiagnostic,
    });
  }
  return browserAccountSessionManager;
}

function getPendingBrowserAccountReferences(): PendingBrowserAccountReferenceRegistry {
  if (!pendingBrowserAccountReferences) {
    const manager = getBrowserAccountSessionManager();
    pendingBrowserAccountReferences = new PendingBrowserAccountReferenceRegistry({
      createReference: (baseUrl) => manager.createReference(baseUrl),
      createSessionId: () => `session-${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      buildAccountKey: buildCheckinAccountKey,
      discardReference: (accountKey, browserSessionId) => (
        manager.discardReference(accountKey, browserSessionId)
      ),
      onDiscardError: (error) => {
        appLogger.error(
          "browser-auth",
          "pending_reference_cleanup_failed",
          "Pending browser account partition cleanup failed",
          { error },
        );
      },
    });
  }
  return pendingBrowserAccountReferences;
}

function shutdownBrowserAccountRuntime(): Promise<void> {
  if (browserAccountRuntimeShutdownPromise) {
    return browserAccountRuntimeShutdownPromise;
  }
  const operation = (async () => {
    try {
      await browserAccountSessionManager?.shutdown();
    } catch (error) {
      appLogger.error(
        "browser-auth",
        "runtime_shutdown_failed",
        "Browser account runtime shutdown failed",
        { error },
      );
    }
    await pendingBrowserAccountReferences?.shutdown();
  })();
  browserAccountRuntimeShutdownPromise = operation;
  operation.then(
    () => {
      if (browserAccountRuntimeShutdownPromise === operation) {
        browserAccountRuntimeShutdownPromise = null;
      }
    },
    () => {
      if (browserAccountRuntimeShutdownPromise === operation) {
        browserAccountRuntimeShutdownPromise = null;
      }
    },
  );
  return operation;
}

function emitBrowserAccountStatus(snapshot: BrowserAccountStatusSnapshot): void {
  for (const win of getCodeDeckWindows()) {
    win.webContents.send("browser-auth:status", snapshot);
  }
}

function logCheckinVerificationDiagnostic(event: CheckinVerificationDiagnosticEvent): void {
  const { duration_ms: durationMs, ...context } = event;
  appLogger.info("checkin_verification", event.event, "Check-in verification state changed", {
    durationMs,
    context,
  });
}

function logBrowserAccountDiagnostic(event: BrowserAccountDiagnosticEvent): void {
  appLogger.info("browser-auth", event.event, "Browser login probe state changed", {
    context: event,
  });
}

async function ensureConfiguredCodexHome(): Promise<string> {
  return getModelMappingConfigService().ensureCodexHome();
}

async function resolveCodexSessionHome(request: ListSessionsRequest): Promise<string | undefined> {
  if (request.provider.trim().toLowerCase() !== "codex") {
    return undefined;
  }
  return getModelMappingConfigService().getCodexHome();
}

async function resolveCodexSessionHomes(request: ListSessionsRequest): Promise<CodexSessionHome[]> {
  const canonicalHome = await resolveCodexSessionHome(request);
  if (!canonicalHome) {
    return [];
  }
  return [{ kind: "global_codex", home: canonicalHome }];
}

async function validateCodexResumeSession(request: LaunchRequest): Promise<void> {
  if (
    request.provider.trim().toLowerCase() !== "codex"
    || request.runtime_settings.launch_mode !== "resume_selected"
  ) {
    return;
  }
  const sessionId = request.session_id?.trim() ?? "";
  if (!sessionId) {
    throw new Error("恢复指定会话时必须提供 sessionId。");
  }
  assertCanonicalCodexSessionSource(request.session_source?.source_kind);
  const session = await getCodexSessionDetail({
    provider: "codex",
    scope: "global_recent",
    session_id: sessionId,
  }, getModelMappingConfigService().getCodexHome());
  if (!session) {
    throw new Error("用户全局 Codex Home 中未找到该会话，请刷新会话列表后重试。");
  }
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

async function launchMonitoredTerminalSession(
  plan: Parameters<typeof executeLaunchPlan>[0],
  options: {
    showWindow?: boolean;
    additionalEnv?: Record<string, string>;
    expectedPreview?: string;
  } = {},
): Promise<TerminalSessionSnapshot> {
  await validateLaunchPlan(plan);
  await ensureNodePtyLoaded();
  const startedAt = new Date();
  const spec = buildWindowsPtyLaunchSpec(plan);
  const managedSessionId = randomUUID();
  const managedParentToken = randomBytes(32).toString("base64url");
  const mergedEnv = Object.fromEntries(
    Object.entries({
      ...process.env,
      ...plan.env,
      ...options.additionalEnv,
      CODEDECK_TERMINAL_SESSION_ID: managedSessionId,
      CODEDECK_TERMINAL_PARENT_TOKEN: managedParentToken,
    }).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
  if (mergedEnv.PATH && !mergedEnv.Path) {
    mergedEnv.Path = mergedEnv.PATH;
  }
  const snapshot = await terminalSessionManager.createSession({
    sessionId: managedSessionId,
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
      intervalMs: 0,
      intervalMode: "fixed",
      intervalStdDevMs: 1_000,
    },
  });
  managedTerminalParentTokens.set(snapshot.sessionId, managedParentToken);
  if (options.showWindow !== false) {
    try {
      await createTerminalWindow(snapshot);
    } catch (windowError) {
      stopTerminalTitleResolution(snapshot.sessionId);
      await terminalSessionManager.closeSession(snapshot.sessionId, "window_create_failed");
      throw windowError;
    }
  }
  scheduleTerminalTitleResolution(snapshot, plan, startedAt, options.expectedPreview);
  return snapshot;
}

const DESKTOP_HANDOFF_TIMEOUT_MS = 30_000;
const DESKTOP_HANDOFF_POLL_MS = 250;
const DESKTOP_HANDOFF_READY_TIMEOUT_MS = 15_000;
const DESKTOP_HANDOFF_SUBMIT_DELAY_MS = 100;
const DESKTOP_HANDOFF_ROUTE_DELAY_MS = 750;
const DESKTOP_HANDOFF_LOCK_TIMEOUT_MS = 10_000;
const DESKTOP_HANDOFF_APP_SERVER_TIMEOUT_MS = 15_000;

async function waitForDesktopHandoffPrompt(sessionId: string): Promise<void> {
  const deadline = Date.now() + DESKTOP_HANDOFF_READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const current = terminalSessionManager.getSnapshot(sessionId);
    if (!current) {
      throw new Error("Desktop 交接失败：临时终端会话不存在。");
    }
    if (current.status !== "running") {
      throw new Error("Desktop 交接失败：Codex CLI 在等待输入前已退出。");
    }
    // The initial snapshot is idle before Codex renders its first prompt. The
    // detector emits idle_prompt only after actual output reaches a stable TUI
    // prompt, so require both signals before submitting /app.
    if (current.output.trim() && terminalIdlePromptSessions.has(sessionId)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, DESKTOP_HANDOFF_POLL_MS));
  }
  throw new Error("Desktop 交接超时：Codex CLI 未进入可交互提示。");
}

async function waitForPathState(
  targetPath: string,
  expectedExists: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(targetPath) === expectedExists) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, DESKTOP_HANDOFF_POLL_MS));
  }
  return existsSync(targetPath) === expectedExists;
}

interface CodexAppServerThreadResult {
  threadId: string;
  modelProvider: string;
}

async function stopCodexAppServer(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null) return;
  child.stdin?.end();
  const exited = await Promise.race([
    new Promise<boolean>((resolve) => child.once("exit", () => resolve(true))),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 3_000)),
  ]);
  if (!exited && child.exitCode === null) {
    child.kill();
    await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
    ]);
  }
}

async function createBlankCodexDesktopThread(
  plan: Parameters<typeof executeLaunchPlan>[0],
): Promise<CodexAppServerThreadResult> {
  await validateLaunchPlan(plan);
  const appServerSpec = buildWindowsPtyLaunchSpec({
    ...plan,
    commandArgs: buildCodexAppServerArgs(plan.commandArgs, plan.codexConfig?.providerId),
  });
  const child = spawn(
    appServerSpec.filePath,
    appServerSpec.args,
    {
      cwd: appServerSpec.cwd,
      env: {
        ...process.env,
        ...plan.env,
      },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  const output = readline.createInterface({ input: child.stdout });
  const requestId = 1;
  const persistRequestId = 2;
  let createdThread: CodexAppServerThreadResult | undefined;
  const resultPromise = new Promise<CodexAppServerThreadResult>((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      reject(new Error("Desktop 交接超时：Codex app-server 未创建空白会话。"));
    }, DESKTOP_HANDOFF_APP_SERVER_TIMEOUT_MS);
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      output.close();
      callback();
    };
    child.once("error", (error) => {
      settle(() => reject(new Error(`Desktop 交接失败：无法启动 Codex app-server（${error.message}）。`)));
    });
    child.once("exit", (code) => {
      settle(() => reject(new Error(`Desktop 交接失败：Codex app-server 在创建会话前退出（${code ?? "unknown"}）。`)));
    });
    output.on("line", (line) => {
      let message: {
        id?: number;
        result?: { thread?: { id?: string; modelProvider?: string } };
        error?: { message?: string };
      };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        return;
      }
      if (message.id !== requestId && message.id !== persistRequestId) return;
      if (message.error) {
        settle(() => reject(new Error(
          `Desktop 交接失败：Codex app-server 拒绝创建会话（${message.error?.message || "unknown error"}）。`,
        )));
        return;
      }
      if (message.id === requestId) {
        const threadId = message.result?.thread?.id?.trim() ?? "";
        const modelProvider = message.result?.thread?.modelProvider?.trim() ?? "";
        if (!threadId) {
          settle(() => reject(new Error("Desktop 交接失败：Codex app-server 未返回 thread ID。")));
          return;
        }
        createdThread = { threadId, modelProvider };
        // Codex does not persist a new thread until it receives at least one
        // rollout item. An empty assistant item creates the rollout without a
        // user turn, model request, or visible conversation content.
        send({
          method: "thread/inject_items",
          id: persistRequestId,
          params: {
            threadId,
            items: [{
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: "" }],
            }],
          },
        });
        return;
      }
      const persistedThread = createdThread;
      if (!persistedThread) {
        settle(() => reject(new Error("Desktop 交接失败：空白会话持久化顺序异常。")));
        return;
      }
      settle(() => resolve(persistedThread));
    });
  });

  const send = (message: unknown) => child.stdin.write(`${JSON.stringify(message)}\n`);
  send({
    method: "initialize",
    id: 0,
    params: {
      clientInfo: {
        name: "codedeck",
        title: "CodeDeck",
        version: app.getVersion(),
      },
    },
  });
  send({ method: "initialized", params: {} });
  send(buildCodexDesktopThreadStartRequest(requestId, {
    cwd: plan.cwd,
    model: plan.codexConfig?.targetModel,
    modelProvider: plan.codexConfig?.providerId,
  }));

  try {
    return await resultPromise;
  } finally {
    await stopCodexAppServer(child);
  }
}

async function openCodexDesktopThread(
  plan: Parameters<typeof executeLaunchPlan>[0],
  providerSessionId: string,
  resetFailedRoute: boolean,
): Promise<void> {
  const codexHome = plan.env.CODEX_HOME?.trim();
  if (!codexHome) {
    throw new Error("Desktop 交接失败：未找到 Codex Home，无法验证 writer 接管状态。");
  }
  const writerLockPath = path.join(
    codexHome,
    "thread-writer-locks",
    `${providerSessionId}.lock`,
  );
  if (!(await waitForPathState(writerLockPath, false, DESKTOP_HANDOFF_LOCK_TIMEOUT_MS))) {
    throw new Error("Desktop 交接失败：CodeDeck 临时 writer 未释放，请关闭监控会话后重试。");
  }
  if (resetFailedRoute) {
    await shell.openExternal(buildCodexDesktopNewThreadUrl(plan.cwd));
    await new Promise((resolve) => setTimeout(resolve, DESKTOP_HANDOFF_ROUTE_DELAY_MS));
  }
  await shell.openExternal(buildCodexDesktopThreadUrl(providerSessionId));
  if (!(await waitForPathState(writerLockPath, true, DESKTOP_HANDOFF_LOCK_TIMEOUT_MS))) {
    throw new Error(
      "Desktop 已收到会话打开请求，但未确认取得 writer。请在 Codex Desktop 中打开该会话并点击“重试”。",
    );
  }
}

async function completeNewDesktopHandoff(
  plan: Parameters<typeof executeLaunchPlan>[0],
): Promise<void> {
  const created = await createBlankCodexDesktopThread(plan);
  validateCodexDesktopThreadProvider(
    plan.codexConfig?.providerId,
    created.modelProvider,
  );
  appLogger.info("launcher", "desktop_blank_thread_created", "Blank Codex Desktop thread created", {
    context: {
      provider: plan.provider,
      modelProvider: created.modelProvider,
      threadId: created.threadId,
    },
  });
  await openCodexDesktopThread(plan, created.threadId, false);
}

async function completeDesktopHandoff(
  snapshot: TerminalSessionSnapshot,
  plan: Parameters<typeof executeLaunchPlan>[0],
): Promise<void> {
  const providerSessionId = validateCodexDesktopHandoffLaunch(
    plan.launchMode,
    plan.sessionId,
  );
  if (!providerSessionId) {
    throw new Error("Desktop 交接失败：恢复会话缺少 Codex session ID。");
  }
  await waitForDesktopHandoffPrompt(snapshot.sessionId);
  terminalSessionManager.sendInput(snapshot.sessionId, "/app");
  await new Promise((resolve) => setTimeout(resolve, DESKTOP_HANDOFF_SUBMIT_DELAY_MS));
  const beforeSubmit = terminalSessionManager.getSnapshot(snapshot.sessionId);
  if (beforeSubmit?.status !== "running") {
    throw new Error("Desktop 交接失败：Codex CLI 在提交 /app 前已退出。");
  }
  const handoffOutputStart = beforeSubmit.output.length;
  terminalSessionManager.sendInput(snapshot.sessionId, "\r");
  const deadline = Date.now() + DESKTOP_HANDOFF_TIMEOUT_MS;
  let openAcknowledged = false;
  while (Date.now() < deadline) {
    const current = terminalSessionManager.getSnapshot(snapshot.sessionId);
    if (!current) {
      throw new Error("Desktop 交接失败：临时终端会话不存在。");
    }
    if (current.status === "exited") {
      throw new Error("Desktop 交接失败：Codex CLI 在 Desktop 确认打开前已退出。");
    }
    if (hasCodexDesktopHandoffMarker(current.output.slice(handoffOutputStart))) {
      openAcknowledged = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, DESKTOP_HANDOFF_POLL_MS));
  }
  if (!openAcknowledged) {
    throw new Error("Desktop 交接超时：未确认 Desktop 接管，请检查 Desktop 是否已安装并重试。");
  }

  const current = terminalSessionManager.getSnapshot(snapshot.sessionId);
  if (current?.status === "running") {
    await terminalSessionManager.closeSession(snapshot.sessionId, "desktop_handoff_open_acknowledged");
  }

  // `/app` reaches Desktop while the CLI still owns the writer, so Desktop can
  // render an active-writer error and will not retry after the CLI closes. Move
  // away from that failed route, then reopen the exact thread after the lock is
  // released. The recreated writer lock is the takeover evidence.
  await openCodexDesktopThread(plan, providerSessionId, true);
}

interface PrepareLaunchExecutionOptions {
  codexHomeOverride?: string;
}

async function prepareCapabilityOverlay(
  request: LaunchRequest,
  options: PrepareLaunchExecutionOptions = {},
): Promise<LaunchRequest["capability_overlay"]> {
  if (request.runtime_settings.startup_mode === "native") {
    return undefined;
  }
  if (request.provider.trim().toLowerCase() === "codex" && options.codexHomeOverride?.trim()) {
    return undefined;
  }
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
    const profileHome = await ensureConfiguredCodexHome();
    return {
      codex: await getCapabilityOverlayService().prepareCodexOverlay({
        profileId: request.profile_key,
        profileHome,
      }),
    };
  }
  return undefined;
}

async function prepareLaunchExecution(
  request: LaunchRequest,
  options: PrepareLaunchExecutionOptions = {},
): Promise<{
  planRequest: LaunchRequest;
  plan: ReturnType<LaunchService["buildExecutionPlan"]>;
}> {
  await validateCodexResumeSession(request);
  const capability_overlay = await prepareCapabilityOverlay(request, options);
  const selectedProfile = getProfileService().getProfiles()
    .find((profile) => itemKey(profile) === request.profile_key);
  const codexModelProviderOverride = request.provider === "codex"
    && selectedProfile
    && isOfficialNativeProfile(selectedProfile)
    && request.runtime_settings.launch_mode !== "new"
    ? await getModelMappingConfigService().resolveNativeCodexModelProvider()
    : undefined;
  const planRequest: LaunchRequest = {
    ...request,
    ...(request.desktop_handoff
      ? { terminal_mode: "monitored" as const, disable_codex_hooks: true }
      : {}),
    capability_overlay,
    ...(codexModelProviderOverride
      ? { codex_model_provider_override: codexModelProviderOverride }
      : {}),
  };
  const plan = getLaunchService().buildExecutionPlan(planRequest, {
    codexHomeOverride: options.codexHomeOverride,
  });
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
    const configService = options.codexHomeOverride?.trim()
      ? new ModelMappingConfigService({
          appDataRoot: path.join(projectRoot, "app-data"),
          codexHome: options.codexHomeOverride,
        })
      : getModelMappingConfigService();
    await configService.writeCodexProfile({
      profileId: request.profile_key,
      profileName: plan.codexConfig.profileName,
      providerId: plan.codexConfig.providerId,
      providerName: plan.codexConfig.providerName,
      baseUrl: plan.codexConfig.baseUrl,
      authCommand: plan.codexConfig.authCommand,
      targetModel: plan.codexConfig.targetModel,
      content: plan.codexConfig.content,
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
  return { planRequest, plan };
}

// ---- 初始化 Profile 服务 ----

async function initProfileServices(): Promise<void> {
  if (profileStoresReady()) {
    return;
  }
  const appDataDir = path.join(projectRoot, "app-data");
  sessionCatalog ??= new SessionCatalog({
    filePath: path.join(appDataDir, "cache", "session-catalog-v1.json"),
    onUpdate: (update) => {
      appLogger.info("sessions", "session_catalog_updated", "Session catalog state changed", {
        durationMs: update.duration_ms,
        context: {
          provider: update.provider,
          revision: update.revision,
          catalogState: update.catalog_state,
          discovered: update.discovered,
          updated: update.updated,
          scannedFiles: update.scanned_files,
        },
      });
      for (const win of getCodeDeckWindows()) {
        win.webContents.send("session:catalog-updated", update);
      }
    },
  });

  // 加密配置存储
  const encryptedPath = path.join(appDataDir, ENCRYPTED_DATA_FILE);
  encryptedStore = new EncryptedConfigStore(encryptedPath, {
    legacyEncryptedPaths: [path.join(projectRoot, ENCRYPTED_DATA_FILE)],
    legacyPlaintextPaths: [path.join(projectRoot, LEGACY_DATA_FILE)],
    onLegacyCleanupError: (legacyPath, error) => {
      legacyCleanupWarnings.add(
        `迁移后的旧配置文件未能删除：${legacyPath}。请退出应用后手动删除，避免敏感数据残留。`,
      );
      appLogger.warn("auth", "legacy_config_cleanup_failed", "Failed to remove migrated legacy config", {
        context: { legacyPath },
        error,
      });
    },
  });
  autoUnlockKeyStore = new AutoUnlockKeyStore(
    path.join(appDataDir, AUTO_UNLOCK_KEY_FILE),
    safeStorage,
  );

  // 本地状态存储
  const statePath = path.join(appDataDir, LOCAL_STATE_FILE);
  const codexHome = resolveCanonicalCodexHome();
  localStateStore = new LocalStateStore(statePath);
  modelMappingConfigService = new ModelMappingConfigService({ appDataRoot: appDataDir, codexHome });
  capabilityOverlayService = new CapabilityOverlayService({
    overlayRoot: path.join(appDataDir, "runtime-overlays"),
    codexHome,
    onDirectoryLinkFallback: ({ sourcePath, targetPath, reason }) => {
      appLogger.warn("capabilities", "directory_link_fallback", "Directory junction creation failed; copied directory instead", {
        context: { sourcePath, targetPath, reason },
      });
    },
  });
  modelCatalogService = new ModelCatalogService();
  const electronFetch = createChromiumFetch();
  customCompatibilityExecutor = new CustomCompatibilityExecutor();
  balanceService = new BalanceService(electronFetch);
  checkinService = new CheckinService(electronFetch);
  modelMappingsStateCache = await modelMappingConfigService.load();
}

async function loadProfilesAndState(
  passphrase: string,
): Promise<{
  config: EncryptedProfileConfig;
  profiles: Profile[];
  state: LocalState;
  siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
}> {
  if (!encryptedStore || !localStateStore) {
    throw new Error("存储未初始化");
  }

  let config = await encryptedStore.load(passphrase);
  const state = await localStateStore.load();
  const plaintextSecrets = collectProtectedSettings(state);
  if (config.protected_settings_version !== 1) {
    config = normalizeEncryptedProfileConfig({
      ...config,
      runtime_env_by_profile: {
        ...plaintextSecrets.runtime_env_by_profile,
        ...(config.runtime_env_by_profile ?? {}),
      },
      global_proxy: config.global_proxy || plaintextSecrets.global_proxy,
      protected_settings_version: 1,
    });
    await encryptedStore.save(config, passphrase);
  }
  applyProtectedSettings(state, config);
  if (hasProtectedSettings(plaintextSecrets)) {
    await localStateStore.save(state);
  }
  applyNativeThemeMode(state.global_settings.theme_mode);

  return {
    config,
    profiles: config.profiles,
    state,
    siteBalanceSessionsByBaseUrl: config.site_balance_sessions_by_base_url,
  };
}

async function initializeProfilesAndState(passphrase: string): Promise<{
  config: EncryptedProfileConfig;
  state: LocalState;
}> {
  if (!encryptedStore || !localStateStore) {
    throw new Error("存储未初始化");
  }
  const state = await localStateStore.load();
  const plaintextSecrets = collectProtectedSettings(state);
  const config = await encryptedStore.initialize(passphrase, plaintextSecrets);
  applyProtectedSettings(state, config);
  if (hasProtectedSettings(plaintextSecrets)) {
    await localStateStore.save(state);
  }
  applyNativeThemeMode(state.global_settings.theme_mode);
  return { config, state };
}

function getCodexAuthHelperPath(): string {
  return app.isPackaged
    ? path.join(path.dirname(process.execPath), "codedeck-agent.cmd")
    : path.join(projectRoot, "scripts", "codedeck-agent.cmd");
}

async function syncCodexProviderRegistry(
  profiles: Profile[],
  parameterSettings: ParameterSettings = defaultParameterSettings(),
): Promise<void> {
  const wireApi = parameterSettings.cli_settings.codex.wire_api.trim() || "responses";
  await getModelMappingConfigService().syncCodexProviderRegistry({
    authCommand: getCodexAuthHelperPath(),
    providers: profiles
      .filter((profile) => profile.provider === "codex" && !isOfficialNativeProfile(profile))
      .map((profile) => ({
        providerId: buildCodexSiteProviderId(itemKey(profile)),
        providerName: `${profile.name} Site`,
        baseUrl: profile.url,
        wireApi,
      })),
  });
}

async function activateProfileServices(
  passphrase: string,
  config: EncryptedProfileConfig,
  state: LocalState,
): Promise<BootstrapResult> {
  await syncCodexProviderRegistry(
    config.profiles,
    state.parameter_settings ?? defaultParameterSettings(),
  );
  currentPassphrase = passphrase;
  const stateAccessor = new StateAccessor(localStateStore!, state);
  profileStateAccessor = stateAccessor;
  const syncStore = new SyncStoreAdapter(encryptedStore!, () => getPassphrase(), config);
  profileService = new ProfileService(
    withOfficialNativeProfiles(config.profiles),
    stateAccessor,
    syncStore,
    config.site_balance_sessions_by_base_url,
    config.browser_identity_slots ?? [],
  );
  for (const account of Object.values(config.site_balance_sessions_by_base_url).flat()) {
    if (account.auth_kind === "browser_session") {
      getBrowserAccountSessionManager().registerAccount(buildCheckinAccountKey(
        normalizeBalanceBaseUrl(account.base_url),
        account.id,
      ));
    }
  }
  launchService = new LaunchService(profileService, {
    getModelMappingsState: () => currentModelMappingsState(),
    codexProfilesRoot: getModelMappingConfigService().getCodexProfilesRoot(),
    codexHome: getModelMappingConfigService().getCodexHome(),
    codexAuthCommand: getCodexAuthHelperPath(),
  });
  settingsStateService = new SettingsStateService(stateAccessor, syncStore);
  startCheckinScheduler();
  await checkinStateWriteQueue;
  return buildProfileBootstrapPayload();
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
      profile_organization_by_provider: state.profile_organization_by_provider,
      runtime_by_profile: state.runtime_by_profile,
      balance_checks_by_profile: state.balance_checks_by_profile,
      profile_health_by_target: state.profile_health_by_target,
      checkin_states_by_account: state.checkin_states_by_account,
      checkin_next_scheduled_at: state.checkin_next_scheduled_at,
      global_settings: state.global_settings,
      working_directory_favorites: state.working_directory_favorites,
      session_favorites: state.session_favorites,
    },
    siteBalanceSessionsByBaseUrl: svc.getSiteBalanceSessionsByBaseUrl(),
    browserIdentitySlots: svc.getBrowserIdentitySlots(),
    defaultWorkingDirectory: getDefaultWorkingDirectory(),
  };
}

function getAgentBridgeConnectionFile(): string {
  const userDataRoot = app.isPackaged
    ? app.getPath("userData")
    : path.join(os.homedir(), APP_DEV_USER_DATA_DIR);
  return path.join(userDataRoot, AGENT_BRIDGE_CONNECTION_FILE);
}

function getAgentProfileSummaries(): AgentProfileSummary[] {
  if (!profileService) {
    return [];
  }
  const state = profileService.getState();
  return profileService.getProfiles().map((profile) => {
    const profileKey = itemKey(profile);
    const runtime = state.runtime_by_profile[profileKey] ?? defaultRuntimeSettings(profile.provider);
    return {
      profile_key: profileKey,
      provider: profile.provider,
      name: profile.name,
      model: profile.selectedModelId?.trim() || runtime.model.trim(),
      available: Boolean(runtime.cwd.trim() && runtime.command_base.trim()),
    };
  });
}

function getAgentBridgeSettings() {
  return settingsStateService?.getParameterSettings().agent_bridge;
}

async function launchAgentTask(
  options: AgentTaskLaunchOptions,
): Promise<{
  terminalSessionId: string;
  provider: "claude" | "codex";
  initialPromptSubmitted?: boolean;
}> {
  const service = getProfileService();
  const profile = service.getProfiles().find((candidate) => itemKey(candidate) === options.profileKey);
  if (!profile) {
    throw new AgentBridgeRequestError("profile_not_found", "Profile 不存在。");
  }
  const savedRuntime = service.getState().runtime_by_profile[options.profileKey]
    ?? defaultRuntimeSettings(profile.provider);
  const cwd = options.cwd?.trim() || savedRuntime.cwd.trim();
  if (!cwd || !(await directoryExists(cwd))) {
    throw new AgentBridgeRequestError("invalid_cwd", "工作目录不存在或未配置。");
  }
  const runtime: RuntimeSettings = {
    ...savedRuntime,
    cwd,
    launch_mode: "new",
    terminal_mode: "monitored",
    extra_env: { ...savedRuntime.extra_env },
  };
  const request: LaunchRequest = {
    profile_key: options.profileKey,
    provider: profile.provider,
    runtime_settings: runtime,
    terminal_mode: "monitored",
    disable_codex_hooks: true,
    ...(options.model ? { model_override: options.model } : {}),
    ...(options.reasoningEffort ? { reasoning_effort_override: options.reasoningEffort } : {}),
  };
  const { plan } = await prepareLaunchExecution(request);
  const initialPromptBase64 = Buffer.from(options.initialPrompt, "utf8").toString("base64");
  const initialPromptEnvKey = "CODEDECK_AGENT_INITIAL_PROMPT_BASE64";
  const submitInitialPromptAtLaunch = profile.provider === "codex"
    && initialPromptBase64.length <= 24_000;
  const launchPlan = submitInitialPromptAtLaunch
    ? { ...plan, agentInitialPromptEnvKey: initialPromptEnvKey }
    : plan;
  const snapshot = await launchMonitoredTerminalSession(launchPlan, {
    showWindow: options.showTerminal,
    expectedPreview: options.initialPrompt,
    additionalEnv: {
      // Explicit orchestrators must not inherit delegated mode from the host
      // process or a saved runtime environment.
      CODEDECK_DELEGATED: options.orchestrator ? "0" : "1",
      ...(app.isPackaged
        ? { CODEDECK_AGENT_CLI: path.join(path.dirname(process.execPath), "codedeck-agent.cmd") }
        : {}),
      ...(options.callbackToken
        ? {
            CODEDECK_AGENT_SCOPED_TOKEN: options.callbackToken,
            CODEDECK_AGENT_SCOPED_PIPE: agentBridgeServer?.getConnection()?.pipe_name ?? "",
          }
        : {}),
      ...(submitInitialPromptAtLaunch
        ? { [initialPromptEnvKey]: initialPromptBase64 }
        : {}),
    },
  });
  invalidateSessionCaches(profile.provider);
  return {
    terminalSessionId: snapshot.sessionId,
    provider: profile.provider,
    ...(submitInitialPromptAtLaunch ? { initialPromptSubmitted: true } : {}),
  };
}

function ensureAgentTaskManager(): AgentTaskManager {
  agentTaskManager ??= new AgentTaskManager({
    terminal: {
      launch: launchAgentTask,
      attach: (terminalSessionId, subscriber) =>
        terminalSessionManager.attachSession(terminalSessionId, subscriber),
      sendInput: (terminalSessionId, data) =>
        terminalSessionManager.sendInput(terminalSessionId, data),
      close: (terminalSessionId, reason) =>
        terminalSessionManager.closeSession(terminalSessionId, reason),
      getSnapshot: (terminalSessionId) =>
        terminalSessionManager.getSnapshot(terminalSessionId),
      verifyParentContext: (terminalSessionId, token) => {
        const snapshot = terminalSessionManager.getSnapshot(terminalSessionId);
        return snapshot?.status === "running"
          && managedTerminalParentTokens.get(terminalSessionId) === token;
      },
    },
    listProfiles: getAgentProfileSummaries,
    isProfileBlocked: (profileKey) =>
      getAgentBridgeSettings()?.blocked_profile_keys.includes(profileKey) ?? true,
    getConcurrencyLimit: () =>
      getAgentBridgeSettings()?.max_concurrent_tasks ?? 4,
    readLastAssistantText: readLastAssistantTextFromSessionFile,
  });
  return agentTaskManager;
}

async function handleAgentBridgeRequest(
  request: AgentBridgeRequest,
): Promise<AgentBridgeResponse> {
  if (request.command === "auth_token") {
    const resolution = resolveCodexSiteProviderToken(
      profileService?.getProfiles(),
      request.provider_id,
    );
    if (!resolution.ok) {
      const messages = {
        store_locked: "CodeDeck Profile 尚未解锁。",
        provider_not_found: "Provider ID 无效。",
        profile_not_found: "对应的 Codex Profile 不存在或未配置 token。",
      } as const;
      throw new AgentBridgeRequestError(
        resolution.code,
        messages[resolution.code],
        resolution.code === "store_locked",
      );
    }
    return { ok: true, token: resolution.token };
  }
  if (!profileService || !settingsStateService) {
    throw new AgentBridgeRequestError(
      "profiles_locked",
      "CodeDeck Profile 尚未解锁。",
      true,
    );
  }
  const settings = getAgentBridgeSettings();
  if (!settings?.enabled) {
    throw new AgentBridgeRequestError(
      "bridge_disabled",
      "CodeDeck 本地 AI 委托接口尚未启用。",
    );
  }
  const manager = ensureAgentTaskManager();
  if (request.command === "profiles") {
    const result = manager.listProfiles();
    return { ok: true, profiles: result.profiles, capacity: result.capacity };
  }
  if (request.command === "run") {
    return manager.run({
      profileKey: request.profile_key,
      prompt: request.prompt,
      cwd: request.cwd,
      waitMs: request.wait_ms,
      showTerminal: request.show_terminal,
      orchestrator: request.orchestrator,
      model: request.model,
      reasoningEffort: request.reasoning_effort,
      parentSessionId: request.parent_session_id,
      parentToken: request.parent_token,
      returnPolicy: request.return_policy,
    });
  }
  if (request.command === "continue") {
    return manager.continue(
      request.session_id,
      request.prompt,
      request.wait_ms,
      request.return_policy,
      request.parent_session_id,
      request.parent_token,
    );
  }
  if (request.command === "status") {
    return manager.status(request.session_id);
  }
  if (request.command === "wait") {
    return manager.wait(request.session_id, request.wait_ms);
  }
  if (request.command === "interrupt") {
    return manager.interruptChild(
      request.session_id,
      request.parent_session_id,
      request.parent_token,
    );
  }
  return manager.cancel(request.session_id);
}

async function startAgentBridgeServer(): Promise<void> {
  agentBridgeServer ??= new AgentBridgeServer({
    connectionFile: getAgentBridgeConnectionFile(),
    handleRequest: handleAgentBridgeRequest,
    handleScopedRequest: async (token, request) => {
      const manager = ensureAgentTaskManager();
      if (request.command === "policy") {
        return manager.scopedPolicy(token, request.return_policy);
      }
      if (request.command === "status_parent") {
        return manager.scopedStatusParent(token);
      }
      if (request.command === "continue_parent") {
        return manager.scopedContinueParent(token, request.prompt);
      }
      return manager.scopedInterruptParent(token);
    },
  });
  await agentBridgeServer.start();
  appLogger.info("agent_bridge", "server_started", "Local AI delegation bridge started", {
    context: { connectionFile: getAgentBridgeConnectionFile() },
  });
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
  getCodeDeckWindows().forEach((win) => {
    win.webContents.send("balance:test-progress", profileKey, nextState);
  });
}

async function saveAndEmitBalanceState(profileKeys: ProfileKey[], nextState: BalanceCheckState): Promise<void> {
  const savedStates = await persistBalanceState(profileKeys, nextState);
  for (const [profileKey, state] of savedStates) {
    emitBalanceProgress(profileKey, state);
  }
}

function customCompatibilitySourceOrigin(account: SiteBalanceSession): string {
  const configured = account.auth_kind === "browser_session"
    ? account.browser_origin || account.custom_compatibility?.identity_origin || account.base_url
    : account.custom_compatibility?.identity_origin || account.base_url;
  return new URL(configured).origin;
}

function customCompatibilityPartition(account: SiteBalanceSession): string {
  if (account.auth_kind === "browser_session") {
    return getBrowserAccountSessionManager().getPartitionName(account);
  }
  return customCompatibilityPartitionName(buildCheckinAccountKey(
    normalizeBalanceBaseUrl(account.base_url),
    account.id,
  ));
}

function getCustomCompatibilityFetch(partition: string): typeof fetch {
  const current = customCompatibilityFetchesByPartition.get(partition);
  if (current) return current;
  const created = createChromiumFetch(8_000, partition);
  customCompatibilityFetchesByPartition.set(partition, created);
  return created;
}

async function buildCustomCompatibilityExecutionOptions(
  account: SiteBalanceSession,
  rule: CustomBalanceRule | CustomCheckinRule,
): Promise<CustomCompatibilityExecutionOptions> {
  const sourceOrigin = customCompatibilitySourceOrigin(account);
  const forwardCredential = isCustomCredentialForwardingAllowed(
    rule,
    sourceOrigin,
    rule.target_url,
  );
  let headers: Record<string, string> = {};
  if (
    rule.mode === "api"
    && forwardCredential
    && account.auth_kind === "access_token"
    && account.access_token.trim()
  ) {
    headers = { Authorization: `Bearer ${account.access_token.trim()}` };
  }

  const partition = customCompatibilityPartition(account);
  const requestFetch = getCustomCompatibilityFetch(partition);
  if (account.auth_kind !== "browser_session") {
    return {
      request: { fetch: requestFetch, headers },
      page: getCustomCompatibilityPageService().createTransport(partition),
    };
  }

  const accountKey = buildCheckinAccountKey(
    normalizeBalanceBaseUrl(account.base_url),
    account.id,
  );
  if (
    rule.mode === "api"
    && forwardCredential
    && account.custom_compatibility?.identity_mode !== "user_confirmed"
  ) {
    const requestContext = await getBrowserAccountSessionManager().getRequestContext(
      accountKey,
      account,
    );
    headers = { ...requestContext.headers };
  }
  return {
    request: {
      fetch: requestFetch,
      headers,
      credentials: "include",
    },
    page: getCustomCompatibilityPageService().createTransport(partition),
  };
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
  const capabilityTargetKey = resolvedAuth.kind === "explicit_session"
    ? `session:${buildCheckinAccountKey(resolvedAuth.base_url, resolvedAuth.session.id)}`
    : `profile:${profileKey}`;
  const browserAccountKey = resolvedAuth.kind === "explicit_session"
    && resolvedAuth.session.auth_kind === "browser_session"
    ? buildCheckinAccountKey(resolvedAuth.base_url, resolvedAuth.session.id)
    : null;
  const credentialUpdatedAt = resolvedAuth.kind === "explicit_session"
    ? resolvedAuth.session.updated_at
    : "";
  const customBalanceRule = resolvedAuth.kind === "explicit_session"
    && resolvedAuth.session.custom_compatibility?.enabled === true
    ? resolvedAuth.session.custom_compatibility.balance
    : undefined;
  const cachedBalancePath = getProfileService().getState().site_capability_cache
    .balance_by_target[capabilityTargetKey];
  const learnedBalancePath = cachedBalancePath
    && cachedBalancePath.base_url === normalizeBalanceBaseUrl(profile.url)
    && isCapabilityPathCurrent(
      cachedBalancePath.learned_at,
      cachedBalancePath.credential_updated_at,
      credentialUpdatedAt,
    )
    ? cachedBalancePath
    : undefined;
  appLogger.info("balance", "balance_check_start", "Balance check started", {
    context: {
      profileKey,
      provider: profile.provider,
      baseUrlHost: safeUrlHost(normalizeBalanceBaseUrl(profile.url)),
      authKind: resolvedAuth.kind,
      sharedProfileCount: sharedProfileKeys.length,
      capabilityCacheHit: Boolean(learnedBalancePath),
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
    } else if (
      resolvedAuth.kind === "explicit_session"
      && resolvedAuth.session.auth_kind === "session_cookie"
    ) {
      delete getProfileStateAccessor().get().site_capability_cache
        .balance_by_target[capabilityTargetKey];
      finalState = {
        ...defaultBalanceCheckState(),
        provider: profile.provider,
        profile_name: profile.name,
        base_url: normalizeBalanceBaseUrl(profile.url),
        supported: true,
        success: false,
        message: "该账号使用已停用的手工 Cookie，请通过浏览器重新登录",
        endpoint: `${resolvedAuth.base_url}/api/user/self`,
      };
    } else if (customBalanceRule && resolvedAuth.kind === "explicit_session") {
      delete getProfileStateAccessor().get().site_capability_cache
        .balance_by_target[capabilityTargetKey];
      finalState = await getCustomCompatibilityExecutor().queryBalance(
        profile,
        customBalanceRule,
        timeoutMs,
        await buildCustomCompatibilityExecutionOptions(
          resolvedAuth.session,
          customBalanceRule,
        ),
      );
    } else {
      const managementRequestContext = browserAccountKey
        && resolvedAuth.kind === "explicit_session"
        ? await getBrowserAccountSessionManager().getRequestContext(
            browserAccountKey,
            resolvedAuth.session,
          )
        : undefined;
      finalState = await getBalanceService().query(
        profile,
        timeoutMs,
        resolvedAuth.kind === "explicit_session"
          ? resolvedAuth.session
          : null,
        {
          learnedPath: learnedBalancePath,
          managementRequestContext,
          onPathLearned: (path: LearnedBalancePath) => {
            getProfileStateAccessor().get().site_capability_cache
              .balance_by_target[capabilityTargetKey] = path;
          },
          onPathInvalidated: () => {
            delete getProfileStateAccessor().get().site_capability_cache
              .balance_by_target[capabilityTargetKey];
          },
          onSessionUpdated: resolvedAuth.kind === "explicit_session"
            ? async (session) => {
              await getProfileService().saveSiteBalanceSession(session.base_url, {
                id: session.id,
                label: session.label,
                access_token: session.access_token,
                refresh_token: session.refresh_token,
                token_expires_at: session.token_expires_at,
                user_id: session.user_id,
              });
            }
            : undefined,
        },
      );
      if (
        browserAccountKey
        && getBrowserAccountSessionManager().getStatus(browserAccountKey).status === "login_required"
      ) {
        throw new BrowserLoginRequiredError();
      }
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
        capabilityCacheHit: Boolean(learnedBalancePath),
        supported: finalState.supported,
        success: finalState.success,
        message: finalState.message,
      },
    });
  } catch (error) {
    if (error instanceof BrowserLoginRequiredError) {
      delete getProfileStateAccessor().get().site_capability_cache
        .balance_by_target[capabilityTargetKey];
      if (browserAccountKey) {
        const current = getProfileService().getState().checkin_states_by_account[browserAccountKey];
        await persistCheckinAccountState(browserAccountKey, {
          ...current,
          status: "login_required",
          message: error.message,
        });
      }
    }
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

function listCheckinAccounts(): SiteBalanceSession[] {
  return Object.values(getProfileService().getSiteBalanceSessionsByBaseUrl())
    .flat()
    .map((session) => ({ ...session }));
}

function findCheckinAccount(rawBaseUrl: string, sessionId: string): SiteBalanceSession {
  const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
  const account = listCheckinAccounts().find((session) => (
    normalizeBalanceBaseUrl(session.base_url) === baseUrl && session.id === sessionId
  ));
  if (!account) {
    throw new Error("后台账号不存在");
  }
  return account;
}

function normalizeCustomSelectorPageUrl(value: string): string {
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error();
    return parsed.toString();
  } catch {
    throw new Error("元素选择页面必须是完整的 http:// 或 https:// URL");
  }
}

function isDeclaredCustomSelectorPage(account: SiteBalanceSession, pageUrl: string): boolean {
  const compatibility = account.custom_compatibility;
  if (!compatibility?.enabled) return false;
  const declaredUrls = [
    compatibility.login_url,
    compatibility.balance?.page_url,
    compatibility.balance?.mode === "page" ? compatibility.balance.target_url : undefined,
    compatibility.checkin?.page_url,
    compatibility.checkin?.mode === "page" ? compatibility.checkin.target_url : undefined,
  ].filter((value): value is string => Boolean(value));
  return declaredUrls.some((value) => normalizeCustomSelectorPageUrl(value) === pageUrl);
}

function resolveProfileBrowserPartition(
  rawBaseUrl: string,
  targetInput: unknown,
): { partition: string } {
  return resolveProfileBrowserPartitionRequest(rawBaseUrl, targetInput, {
    defaultPartition: DEFAULT_PROFILE_BROWSER_PARTITION,
    normalizeBaseUrl: normalizeBalanceBaseUrl,
    normalizeBrowserOrigin,
    findSavedSession: findCheckinAccount,
    getSavedSessionPartition: (account) => (
      getBrowserAccountSessionManager().getPartitionName(account)
    ),
    findBrowserSlot: (slot) => getProfileService().getBrowserIdentitySlots().find(
      (candidate) => candidate.slot === slot,
    ),
    getBrowserSlotPartition: browserPartitionName,
    preparePendingPartition: (normalizedBaseUrl) => (
      getPendingBrowserAccountReferences().prepare(normalizedBaseUrl).reference.partition
    ),
  });
}

async function openProfileSiteBrowser(rawBaseUrl: string, targetInput: unknown): Promise<void> {
  const targetUrl = resolveBaseUrlBrowserTarget(rawBaseUrl);
  const { partition } = resolveProfileBrowserPartition(rawBaseUrl, targetInput);
  const browserSession = electronSession.fromPartition(partition);
  browserSession.setPermissionCheckHandler(() => false);
  browserSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));

  const browserWindow = new BrowserWindow({
    title: "CodeDeck 内置浏览器",
    width: 1180,
    height: 820,
    minWidth: 840,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    ...(resolveWindowIconPath() ? { icon: resolveWindowIconPath() } : {}),
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  profileBrowserWindows.add(browserWindow);
  installBrowserNavigationMenu(browserWindow);
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isHttpUrl(url)) void browserWindow.loadURL(url).catch(() => undefined);
    return { action: "deny" };
  });
  browserWindow.webContents.on("will-navigate", (event, targetUrl) => {
    if (!isHttpUrl(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-redirect", (event, targetUrl) => {
    if (!isHttpUrl(targetUrl)) event.preventDefault();
  });
  browserWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  browserWindow.on("closed", () => profileBrowserWindows.delete(browserWindow));
  try {
    browserWindow.show();
    browserWindow.focus();
    await loadProfileBrowserUrlWithTimeout(browserWindow, targetUrl);
  } catch (error) {
    if (!browserWindow.isDestroyed()) browserWindow.close();
    throw error;
  }
}

async function loadProfileBrowserUrlWithTimeout(
  browserWindow: BrowserWindow,
  url: string,
): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      browserWindow.loadURL(url),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          if (!browserWindow.isDestroyed()) browserWindow.webContents.stop();
          reject(new Error("浏览器页面加载超时"));
        }, PROFILE_BROWSER_NAVIGATION_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function installBrowserNavigationMenu(browserWindow: BrowserWindow): void {
  const navigate = (action: BrowserNavigationAction) => {
    if (!browserWindow.isDestroyed()) {
      runBrowserNavigationAction(browserWindow.webContents, action);
    }
  };
  browserWindow.setMenu(Menu.buildFromTemplate([
    { label: "后退", accelerator: "Alt+Left", click: () => navigate("back") },
    { label: "前进", accelerator: "Alt+Right", click: () => navigate("forward") },
    { label: "刷新", accelerator: "CmdOrCtrl+R", click: () => navigate("reload") },
    { label: "停止", accelerator: "Esc", click: () => navigate("stop") },
    { label: "关闭", accelerator: "CmdOrCtrl+W", click: () => browserWindow.close() },
  ]));
  browserWindow.setAutoHideMenuBar(false);
  browserWindow.setMenuBarVisibility(true);
}

function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

function allocateBrowserAccountSessionId(): string {
  return `session-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function referenceForBrowserSlot(
  browserOrigin: string,
  slot: BrowserIdentitySlot,
): { browserSessionId: string; browserOrigin: string } {
  return {
    browserSessionId: slot.browser_session_id,
    browserOrigin: normalizeBrowserOrigin(browserOrigin),
  };
}

async function loginBrowserAccount(
  rawBaseUrl: string,
  existingSessionId?: string,
  requestedBrowserSlot?: number,
  customCompatibilityInput?: unknown,
): Promise<SiteBalanceSession> {
  const baseUrl = normalizeBalanceBaseUrl(rawBaseUrl);
  if (!baseUrl) throw new Error("Base URL 不能为空");
  const existing = existingSessionId
    ? findCheckinAccount(baseUrl, existingSessionId)
    : undefined;
  const customCompatibility = customCompatibilityInput !== undefined
    ? normalizeSiteCustomCompatibility(customCompatibilityInput)
    : existing?.custom_compatibility;
  const browserOrigin = normalizeBrowserOrigin(
    customCompatibility?.identity_origin
      || existing?.browser_origin
      || baseUrl,
  );
  if (
    existing?.auth_kind === "browser_session"
    && existing.browser_origin
    && normalizeBrowserOrigin(existing.browser_origin) !== browserOrigin
  ) {
    throw new Error("管理 / 身份 origin 已变化，请删除并重新创建该浏览器账号");
  }
  if (!existing) {
    const normalizedRequestedSlot = normalizeBrowserSlot(requestedBrowserSlot);
    if (requestedBrowserSlot !== undefined && !normalizedRequestedSlot) {
      throw new Error("浏览器账号槽位无效");
    }
    const identitySlots = getProfileService().getBrowserIdentitySlots();
    const sharedSlot = normalizedRequestedSlot
      ? identitySlots.find((slot) => slot.slot === normalizedRequestedSlot)
      : undefined;
    if (normalizedRequestedSlot && !sharedSlot) {
      throw new Error(`浏览器账号${normalizedRequestedSlot}不存在`);
    }
    if (sharedSlot) {
      const sessionId = allocateBrowserAccountSessionId();
      return completeBrowserAccountLogin(
        baseUrl,
        sessionId,
        buildCheckinAccountKey(baseUrl, sessionId),
        referenceForBrowserSlot(browserOrigin, sharedSlot),
        sharedSlot.slot,
        undefined,
        false,
        customCompatibility,
      );
    }
    const browserSlot = allocateBrowserSlot(identitySlots);
    if (browserOrigin !== new URL(baseUrl).origin) {
      const sessionId = allocateBrowserAccountSessionId();
      return completeBrowserAccountLogin(
        baseUrl,
        sessionId,
        buildCheckinAccountKey(baseUrl, sessionId),
        getBrowserAccountSessionManager().createReference(browserOrigin),
        browserSlot,
        undefined,
        true,
        customCompatibility,
      );
    }
    return getPendingBrowserAccountReferences().run(baseUrl, async (pending) => (
      completeBrowserAccountLogin(
        baseUrl,
        pending.sessionId,
        pending.accountKey,
        pending.reference,
        browserSlot,
        undefined,
        false,
        customCompatibility,
      )
    ));
  }

  const sessionId = existing.id;
  const reusableReference = existing?.auth_kind === "browser_session"
    && existing.browser_session_id
    && existing.browser_origin
    ? {
        browserSessionId: existing.browser_session_id,
        browserOrigin: existing.browser_origin,
      }
    : null;
  const reference = reusableReference
    ?? getBrowserAccountSessionManager().createReference(baseUrl);
  const accountKey = buildCheckinAccountKey(baseUrl, sessionId);
  const browserSlot = existing.browser_slot
    ?? allocateBrowserSlot(getProfileService().getBrowserIdentitySlots());
  return completeBrowserAccountLogin(
    baseUrl,
    sessionId,
    accountKey,
    reference,
    browserSlot,
    existing,
    !reusableReference,
    customCompatibility,
  );
}

async function completeBrowserAccountLogin(
  baseUrl: string,
  sessionId: string,
  accountKey: string,
  reference: { browserSessionId: string; browserOrigin: string },
  browserSlot: number,
  existing?: SiteBalanceSession,
  discardReferenceOnRejected: boolean = false,
  customCompatibility?: SiteCustomCompatibility,
): Promise<SiteBalanceSession> {
  const identityMode = customCompatibility?.identity_mode ?? "standard";
  const loginResult = await getBrowserAccountSessionManager().openLogin({
    accountKey,
    browserSessionId: reference.browserSessionId,
    browserOrigin: reference.browserOrigin,
    ...(customCompatibility?.login_url ? { loginUrl: customCompatibility.login_url } : {}),
    identityMode,
    ...(identityMode === "standard" && existing?.user_id
      ? { expectedUserId: existing.user_id }
      : {}),
  });
  if (
    loginResult.status !== "ready"
    || (identityMode === "standard" && !loginResult.userId)
  ) {
    if (discardReferenceOnRejected) {
      await getBrowserAccountSessionManager().discardReference(
        accountKey,
        reference.browserSessionId,
      );
    }
    throw new Error(loginResult.message);
  }
  let saved: SiteBalanceSession;
  try {
    saved = await getProfileService().saveSiteBalanceSession(baseUrl, {
      id: sessionId,
      label: existing?.label ?? "",
      access_token: "",
      auth_kind: "browser_session",
      browser_session_id: reference.browserSessionId,
      browser_slot: browserSlot,
      browser_origin: reference.browserOrigin,
      user_id: identityMode === "user_confirmed" ? "" : loginResult.userId ?? "",
      ...(customCompatibility ? { custom_compatibility: customCompatibility } : {}),
    });
  } catch (error) {
    if (discardReferenceOnRejected) {
      await getBrowserAccountSessionManager().discardReference(
        accountKey,
        reference.browserSessionId,
      );
    }
    throw error;
  }
  getBrowserAccountSessionManager().registerAccount(accountKey);
  const state = getProfileService().getState();
  delete state.checkin_states_by_account[accountKey];
  delete state.site_capability_cache.checkin_by_account[accountKey];
  delete state.site_capability_cache.balance_by_target[`session:${accountKey}`];
  await getProfileStateAccessor().save(state);
  return saved;
}

function browserLoginRequiredResult(baseUrl: string): CheckinResult {
  return {
    status: "login_required",
    success: false,
    message: "浏览器登录已失效，请重新登录",
    endpoint: `${baseUrl}/api/user/self`,
    error_code: "auth_not_logged_in",
  };
}

async function persistBrowserVerificationLoginRequired(
  accountKey: string,
  baseUrl: string,
  current: CheckinAccountState | undefined,
  runId: string,
): Promise<CheckinVerificationResult> {
  const result: CheckinVerificationResult = {
    status: "failed",
    success: false,
    message: "浏览器登录已失效，请重新登录",
    endpoint: `${baseUrl}/api/user/self`,
    error_code: "auth_not_logged_in",
  };
  await persistCheckinAccountState(accountKey, {
    ...current,
    status: "login_required",
    trigger: "manual",
    message: result.message,
    endpoint: result.endpoint,
    error_code: result.error_code,
    diagnostic_run_id: runId,
    last_attempt_at: new Date().toISOString(),
  });
  return result;
}

function getCodeDeckWindows(): BrowserWindow[] {
  return [mainWindow, ...terminalWindows.values()]
    .filter((win): win is BrowserWindow => Boolean(win && !win.isDestroyed()));
}

function emitCheckinProgress(accountKey: string, state: CheckinAccountState): void {
  for (const win of getCodeDeckWindows()) {
    win.webContents.send("checkin:progress", accountKey, state);
  }
}

function emitCheckinScheduleChanged(nextScheduledAt: string): void {
  for (const win of getCodeDeckWindows()) {
    win.webContents.send("checkin:schedule-changed", nextScheduledAt);
  }
}

function mutateCheckinLocalState(mutator: (state: LocalState) => void): Promise<void> {
  const operation = checkinStateWriteQueue.then(async () => {
    const state = getProfileService().getState();
    mutator(state);
    await getProfileStateAccessor().save(state);
  });
  checkinStateWriteQueue = operation.catch(() => undefined);
  return operation;
}

async function persistCheckinAccountState(
  accountKey: string,
  nextState: CheckinAccountState,
  deferSave: boolean = false,
): Promise<void> {
  if (deferSave) {
    deferredCheckinStates.set(accountKey, nextState);
    getProfileStateAccessor().get().checkin_states_by_account[accountKey] = nextState;
    emitCheckinProgress(accountKey, nextState);
    return;
  }
  await mutateCheckinLocalState((state) => {
    state.checkin_states_by_account[accountKey] = nextState;
  });
  emitCheckinProgress(accountKey, nextState);
}

async function flushCheckinLocalState(): Promise<void> {
  const pendingStates = [...deferredCheckinStates.entries()];
  const pendingPaths = [...deferredCheckinCapabilityPaths.entries()];
  deferredCheckinStates.clear();
  deferredCheckinCapabilityPaths.clear();
  const operation = checkinStateWriteQueue.then(async () => {
    const state = getProfileService().getState();
    for (const [accountKey, nextState] of pendingStates) {
      state.checkin_states_by_account[accountKey] = nextState;
    }
    for (const [accountKey, path] of pendingPaths) {
      if (path) {
        state.site_capability_cache.checkin_by_account[accountKey] = path;
      } else {
        delete state.site_capability_cache.checkin_by_account[accountKey];
      }
    }
    await getProfileStateAccessor().save(state);
  });
  checkinStateWriteQueue = operation.catch(() => undefined);
  await operation;
}

async function persistNextCheckinSchedule(nextScheduledAt: string): Promise<void> {
  if (!profileService || !profileStateAccessor) {
    return;
  }
  await mutateCheckinLocalState((state) => {
    state.checkin_next_scheduled_at = nextScheduledAt;
  });
  emitCheckinScheduleChanged(nextScheduledAt);
}

function getCheckinSnapshot(): CheckinSnapshot {
  const state = getProfileService().getState();
  return {
    states_by_account: { ...state.checkin_states_by_account },
    next_scheduled_at: state.checkin_next_scheduled_at,
  };
}

function collectProtectedSettings(
  state: LocalState,
): Pick<EncryptedProfileConfig, "runtime_env_by_profile" | "global_proxy"> {
  return {
    runtime_env_by_profile: Object.fromEntries(
      Object.entries(state.runtime_by_profile)
        .filter(([, runtime]) => Object.keys(runtime.extra_env ?? {}).length > 0)
        .map(([key, runtime]) => [key, { ...runtime.extra_env }]),
    ),
    global_proxy: state.global_settings.proxy,
  };
}

function hasProtectedSettings(
  settings: Pick<EncryptedProfileConfig, "runtime_env_by_profile" | "global_proxy">,
): boolean {
  return Boolean(
    settings.global_proxy
    || Object.keys(settings.runtime_env_by_profile ?? {}).length > 0,
  );
}

function applyProtectedSettings(state: LocalState, config: EncryptedProfileConfig): void {
  const encryptedRuntimeEnv = config.runtime_env_by_profile ?? {};
  for (const [key, runtime] of Object.entries(state.runtime_by_profile)) {
    state.runtime_by_profile[key] = {
      ...runtime,
      extra_env: { ...(encryptedRuntimeEnv[key] ?? {}) },
    };
  }
  for (const profile of config.profiles) {
    const key = itemKey(profile);
    if (state.runtime_by_profile[key] || !encryptedRuntimeEnv[key]) {
      continue;
    }
    state.runtime_by_profile[key] = {
      ...defaultRuntimeSettings(profile.provider),
      extra_env: { ...encryptedRuntimeEnv[key] },
    };
  }
  state.global_settings = {
    ...state.global_settings,
    proxy: config.global_proxy ?? "",
  };
}

function isAutomaticCheckinEligible(account: SiteBalanceSession, today: string): boolean {
  if (account.auto_checkin_enabled !== true) {
    return false;
  }
  const accountKey = buildCheckinAccountKey(
    normalizeBalanceBaseUrl(account.base_url),
    account.id,
  );
  const current = getProfileService().getState().checkin_states_by_account[accountKey];
  return current?.status !== "login_required"
    && current?.last_auto_attempt_local_date !== today
    && current?.satisfied_local_date !== today;
}

async function refreshBalanceForCheckinAccount(account: SiteBalanceSession): Promise<void> {
  const baseUrl = normalizeBalanceBaseUrl(account.base_url);
  const profile = getProfileService().getProfiles().find((candidate) => (
    normalizeBalanceBaseUrl(candidate.url) === baseUrl
    && candidate.balance_session_id === account.id
  ));
  if (profile) {
    await runBalanceCheck(itemKey(profile));
  }
}

function queueBalanceRefreshForCheckinAccount(account: SiteBalanceSession): void {
  const accountKey = buildCheckinAccountKey(normalizeBalanceBaseUrl(account.base_url), account.id);
  if (queuedBalanceRefreshAccounts.has(accountKey)) return;
  queuedBalanceRefreshAccounts.add(accountKey);
  balanceRefreshQueue.push({ ...account });
  pumpBalanceRefreshQueue();
}

function pumpBalanceRefreshQueue(): void {
  while (
    activeBalanceRefreshCount < MAX_BALANCE_REFRESH_CONCURRENCY
    && balanceRefreshQueue.length > 0
  ) {
    const account = balanceRefreshQueue.shift();
    if (!account) return;
    const accountKey = buildCheckinAccountKey(normalizeBalanceBaseUrl(account.base_url), account.id);
    activeBalanceRefreshCount += 1;
    void refreshBalanceForCheckinAccount(account)
      .catch((error: unknown) => {
        appLogger.warn("balance", "checkin_balance_refresh_failed", "Background balance refresh failed", {
          context: { baseUrlHost: safeUrlHost(account.base_url), accountId: account.id },
          error,
        });
      })
      .finally(() => {
        activeBalanceRefreshCount -= 1;
        queuedBalanceRefreshAccounts.delete(accountKey);
        pumpBalanceRefreshQueue();
      });
  }
}

function mergeCheckinVerificationResult(
  initialResult: CheckinResult,
  verificationResult: CheckinVerificationResult,
): CheckinResult {
  const shared = {
    message: verificationResult.message,
    endpoint: verificationResult.endpoint,
    ...(verificationResult.reward ? { reward: verificationResult.reward } : {}),
    ...(initialResult.diagnostic_run_id
      ? { diagnostic_run_id: initialResult.diagnostic_run_id }
      : {}),
    ...(verificationResult.verification ?? initialResult.verification
      ? { verification: verificationResult.verification ?? initialResult.verification }
      : {}),
  };
  if (verificationResult.status === "success" || verificationResult.status === "already_checked") {
    return {
      ...shared,
      status: verificationResult.status,
      success: true,
    };
  }
  if (verificationResult.status === "canceled" || verificationResult.status === "timeout") {
    return {
      ...shared,
      status: "manual_required",
      success: false,
      manual_url: initialResult.manual_url,
      error_code: "turnstile_required",
    };
  }
  return {
    ...shared,
    status: "failed",
    success: false,
    error_code: verificationResult.error_code ?? "unknown_failure",
  };
}

function buildCustomManualCheckinPageRule(
  rule: CustomCheckinRule,
  manualUrl: string | undefined,
): CustomCheckinRule | undefined {
  if (rule.mode !== "page") return undefined;
  const pageUrl = rule.page_url || manualUrl || rule.target_url;
  if (!pageUrl) return undefined;
  return {
    ...rule,
    mode: "page",
    page_url: pageUrl,
  };
}

async function executeCheckinAccountOnce(
  account: SiteBalanceSession,
  trigger: CheckinTrigger,
  verificationPolicy: "open" | "defer",
): Promise<CheckinResult> {
  const deferStateSave = verificationPolicy === "defer";
  const baseUrl = normalizeBalanceBaseUrl(account.base_url);
  const accountKey = buildCheckinAccountKey(baseUrl, account.id);
  const current = getProfileService().getState().checkin_states_by_account[accountKey];
  const customCheckinRule = account.custom_compatibility?.enabled === true
    ? account.custom_compatibility.checkin
    : undefined;
  const runId = randomUUID().replace(/-/g, "").slice(0, 12);
  const startedAt = Date.now();
  const diagnosticAttempts: Array<Pick<
    CheckinDiagnosticAttempt,
    | "stage"
    | "authorization_mode"
    | "cookie_mode"
    | "user_id_source"
    | "method"
    | "endpoint_path"
    | "http_status"
    | "message_code"
    | "message_preview"
  >> = [];
  await persistCheckinAccountState(accountKey, {
    ...current,
    status: "running",
    trigger,
    message: "正在签到...",
    error_code: undefined,
    diagnostic_run_id: undefined,
  }, deferStateSave);

  const cachedPath = getProfileService().getState().site_capability_cache
    .checkin_by_account[accountKey];
  const learnedPath = !customCheckinRule && cachedPath && isCapabilityPathCurrent(
    cachedPath.learned_at,
    cachedPath.credential_updated_at,
    account.updated_at,
  ) ? cachedPath : undefined;
  const updateLearnedPath = (path: LearnedCheckinPath): void => {
    getProfileStateAccessor().get().site_capability_cache.checkin_by_account[accountKey] = path;
    if (deferStateSave) deferredCheckinCapabilityPaths.set(accountKey, path);
  };
  const invalidateLearnedPath = (): void => {
    delete getProfileStateAccessor().get().site_capability_cache.checkin_by_account[accountKey];
    if (deferStateSave) deferredCheckinCapabilityPaths.set(accountKey, null);
  };

  let managementRequestContext: ManagementRequestContext | undefined;
  let preflightResult: CheckinResult | null = null;
  if (account.auth_kind === "session_cookie") {
    invalidateLearnedPath();
    preflightResult = {
      ...browserLoginRequiredResult(baseUrl),
      message: "该账号使用已停用的手工 Cookie，请通过浏览器重新登录",
    };
  } else if (account.auth_kind === "browser_session" && !customCheckinRule) {
    try {
      managementRequestContext = await getBrowserAccountSessionManager().getRequestContext(
        accountKey,
        account,
      );
    } catch (error) {
      if (error instanceof BrowserLoginRequiredError) {
        invalidateLearnedPath();
        preflightResult = browserLoginRequiredResult(baseUrl);
      } else {
        throw error;
      }
    }
  }

  let result: CheckinResult;
  if (preflightResult) {
    result = preflightResult;
  } else {
    try {
      if (customCheckinRule) {
        invalidateLearnedPath();
        result = await getCustomCompatibilityExecutor().checkin(
          customCheckinRule,
          12_000,
          await buildCustomCompatibilityExecutionOptions(account, customCheckinRule),
        );
      } else {
        result = await getCheckinService().checkin(
          { ...account, base_url: baseUrl },
          12_000,
          {
            runId,
            trigger,
            learnedPath,
            onPathLearned: updateLearnedPath,
            onPathInvalidated: invalidateLearnedPath,
            managementRequestContext,
            onDiagnostic: (event) => {
              const { duration_ms: durationMs, ...context } = event;
              diagnosticAttempts.push({
                stage: event.stage,
                authorization_mode: event.authorization_mode,
                cookie_mode: event.cookie_mode,
                user_id_source: event.user_id_source,
                method: event.method,
                endpoint_path: event.endpoint_path,
                http_status: event.http_status,
                message_code: event.message_code,
                ...(event.message_preview
                  ? { message_preview: event.message_preview }
                  : {}),
              });
              appLogger.debug("checkin_auth", "auth_attempt", "Check-in authentication attempt", {
                durationMs,
                context,
              });
            },
          },
        );
      }
    } catch (error) {
      if (!(error instanceof BrowserLoginRequiredError) || account.auth_kind !== "browser_session") {
        throw error;
      }
      invalidateLearnedPath();
      result = browserLoginRequiredResult(baseUrl);
    }
    if (
      account.auth_kind === "browser_session"
      && getBrowserAccountSessionManager().getStatus(accountKey).status === "login_required"
    ) {
      invalidateLearnedPath();
      result = browserLoginRequiredResult(baseUrl);
    }
  }
  if (result.status === "manual_required" && verificationPolicy === "open") {
    await persistCheckinAccountState(accountKey, {
      ...current,
      status: "verifying",
      trigger,
      message: "等待人工验证",
      endpoint: result.endpoint,
      ...(result.manual_url ? { manual_url: result.manual_url } : {}),
      ...(result.error_code ? { error_code: result.error_code } : {}),
      ...(result.diagnostic_run_id
        ? { diagnostic_run_id: result.diagnostic_run_id }
        : {}),
      ...(result.verification ? { verification: result.verification } : {}),
    });
    const customManualPageRule = customCheckinRule
      ? buildCustomManualCheckinPageRule(customCheckinRule, result.manual_url)
      : undefined;
    const customApiRule = customCheckinRule?.mode === "api" ? customCheckinRule : undefined;
    if (customApiRule && !customApiRule.page_url) {
      result = {
        ...result,
        message: "自定义 API 签到需要人工验证，请在规则中配置签到页面 URL",
      };
    } else {
      const customApiExecutionOptions = customApiRule
        ? await buildCustomCompatibilityExecutionOptions(account, customApiRule)
        : undefined;
      const verificationResult = await getCheckinVerificationService().openVerification({
        account: { ...account, base_url: baseUrl },
        trigger,
        runId,
        preferredCookieMode: result.verification?.cookie_mode,
        ...(account.auth_kind === "browser_session" && managementRequestContext
          ? {
              browserSessionPartition: getBrowserAccountSessionManager().getPartitionName(account),
              managementRequestContext,
            }
          : {}),
        ...(customCheckinRule && !managementRequestContext
          ? { browserSessionPartition: customCompatibilityPartition(account) }
          : {}),
        ...(customManualPageRule ? { customPageRule: customManualPageRule } : {}),
        ...(customApiRule && customApiExecutionOptions
          ? {
              customApiRule,
              customApiProbe: () => getCustomCompatibilityExecutor().checkin(
                customApiRule,
                12_000,
                customApiExecutionOptions,
              ),
            }
          : {}),
      });
      result = mergeCheckinVerificationResult(result, verificationResult);
    }
  }
  if (
    account.auth_kind === "browser_session"
    && getBrowserAccountSessionManager().getStatus(accountKey).status === "login_required"
  ) {
    invalidateLearnedPath();
    result = browserLoginRequiredResult(baseUrl);
  }
  const now = new Date();
  const today = localDateKey(now);
  const nextState: CheckinAccountState = {
    status: result.status,
    trigger,
    message: result.message,
    endpoint: result.endpoint,
    ...(result.reward ? { reward: result.reward } : {}),
    ...(result.manual_url ? { manual_url: result.manual_url } : {}),
    ...(result.error_code ? { error_code: result.error_code } : {}),
    ...(result.diagnostic_run_id
      ? { diagnostic_run_id: result.diagnostic_run_id }
      : {}),
    ...(result.verification ? { verification: result.verification } : {}),
    last_attempt_at: now.toISOString(),
    ...(trigger === "automatic" ? { last_auto_attempt_local_date: today } : {
      ...(current?.last_auto_attempt_local_date
        ? { last_auto_attempt_local_date: current.last_auto_attempt_local_date }
        : {}),
    }),
    ...(result.status === "success" || result.status === "already_checked"
      ? { satisfied_local_date: today }
      : current?.satisfied_local_date
        ? { satisfied_local_date: current.satisfied_local_date }
        : {}),
  };
  await persistCheckinAccountState(accountKey, nextState, deferStateSave);
  const logOptions = {
    durationMs: Date.now() - startedAt,
    context: {
      run_id: runId,
      base_url_host: safeUrlHost(baseUrl),
      trigger,
      status: result.status,
      error_code: result.error_code,
      capability_cache_hit: Boolean(learnedPath),
      request_count: diagnosticAttempts.length,
      attempts: diagnosticAttempts,
    },
  };
  if (result.success) {
    appLogger.info("checkin_auth", "checkin_summary", "Check-in authentication completed", logOptions);
  } else {
    appLogger.warn("checkin_auth", "checkin_summary", "Check-in authentication failed", logOptions);
  }
  return result;
}

function unexpectedCheckinFailure(account: SiteBalanceSession): CheckinResult {
  const baseUrl = normalizeBalanceBaseUrl(account.base_url);
  return {
    status: "failed",
    success: false,
    message: "签到过程中发生异常，请重试",
    endpoint: `${baseUrl}/api/user/checkin`,
    error_code: "unknown_failure",
  };
}

async function persistUnexpectedCheckinFailure(
  account: SiteBalanceSession,
  trigger: CheckinTrigger,
  deferStateSave: boolean,
): Promise<void> {
  const baseUrl = normalizeBalanceBaseUrl(account.base_url);
  const accountKey = buildCheckinAccountKey(baseUrl, account.id);
  const current = getProfileService().getState().checkin_states_by_account[accountKey];
  const now = new Date();
  const today = localDateKey(now);
  const result = unexpectedCheckinFailure(account);
  await persistCheckinAccountState(accountKey, {
    status: result.status,
    trigger,
    message: result.message,
    endpoint: result.endpoint,
    error_code: result.error_code,
    last_attempt_at: now.toISOString(),
    ...(trigger === "automatic"
      ? { last_auto_attempt_local_date: today }
      : current?.last_auto_attempt_local_date
        ? { last_auto_attempt_local_date: current.last_auto_attempt_local_date }
        : {}),
    ...(current?.satisfied_local_date
      ? { satisfied_local_date: current.satisfied_local_date }
      : {}),
  }, deferStateSave);
}

function executeCheckinAccount(
  account: SiteBalanceSession,
  trigger: CheckinTrigger,
  verificationPolicy: "open" | "defer",
): Promise<CheckinResult> {
  const accountKey = buildCheckinAccountKey(
    normalizeBalanceBaseUrl(account.base_url),
    account.id,
  );
  const running = checkinRunsByAccount.get(accountKey);
  if (running) {
    return running;
  }
  const operation = checkinExecutionQueue.enqueue(async () => {
    try {
      return await executeCheckinAccountOnce(account, trigger, verificationPolicy);
    } catch (error) {
      await persistUnexpectedCheckinFailure(account, trigger, verificationPolicy === "defer");
      throw error;
    }
  }).finally(() => {
    checkinRunsByAccount.delete(accountKey);
  });
  checkinRunsByAccount.set(accountKey, operation);
  return operation;
}

async function reopenCheckinVerification(
  account: SiteBalanceSession,
): Promise<CheckinVerificationResult> {
  const baseUrl = normalizeBalanceBaseUrl(account.base_url);
  const accountKey = buildCheckinAccountKey(baseUrl, account.id);
  const current = getProfileService().getState().checkin_states_by_account[accountKey];
  const customCheckinRule = account.custom_compatibility?.enabled === true
    ? account.custom_compatibility.checkin
    : undefined;
  const runId = current?.diagnostic_run_id
    || randomUUID().replace(/-/g, "").slice(0, 12);
  const manualUrl = current?.manual_url || `${baseUrl}/console/personal`;
  const customManualPageRule = customCheckinRule
    ? buildCustomManualCheckinPageRule(customCheckinRule, manualUrl)
    : undefined;
  const customApiRule = customCheckinRule?.mode === "api" ? customCheckinRule : undefined;
  if (customApiRule && !customApiRule.page_url) {
    throw new Error("自定义 API 签到需要人工验证时必须配置签到页面 URL");
  }
  let managementRequestContext: ManagementRequestContext | undefined;
  if (account.auth_kind === "browser_session" && !customCheckinRule) {
    try {
      managementRequestContext = await getBrowserAccountSessionManager().getRequestContext(
        accountKey,
        account,
      );
    } catch (error) {
      if (!(error instanceof BrowserLoginRequiredError)) throw error;
      return persistBrowserVerificationLoginRequired(accountKey, baseUrl, current, runId);
    }
  }
  await persistCheckinAccountState(accountKey, {
    ...current,
    status: "verifying",
    trigger: "manual",
    message: "等待人工验证",
    manual_url: manualUrl,
    diagnostic_run_id: runId,
  });
  const customApiExecutionOptions = customApiRule
    ? await buildCustomCompatibilityExecutionOptions(account, customApiRule)
    : undefined;
  const verificationResult = await getCheckinVerificationService().openVerification({
    account: { ...account, base_url: baseUrl },
    trigger: "manual",
    runId,
    preferredCookieMode: current?.verification?.cookie_mode,
    ...(account.auth_kind === "browser_session" && managementRequestContext
      ? {
          browserSessionPartition: getBrowserAccountSessionManager().getPartitionName(account),
          managementRequestContext,
        }
      : {}),
    ...(customCheckinRule && !managementRequestContext
      ? { browserSessionPartition: customCompatibilityPartition(account) }
      : {}),
    ...(customManualPageRule ? { customPageRule: customManualPageRule } : {}),
    ...(customApiRule && customApiExecutionOptions
      ? {
          customApiRule,
          customApiProbe: () => getCustomCompatibilityExecutor().checkin(
            customApiRule,
            12_000,
            customApiExecutionOptions,
          ),
        }
      : {}),
  });
  if (
    account.auth_kind === "browser_session"
    && getBrowserAccountSessionManager().getStatus(accountKey).status === "login_required"
  ) {
    return persistBrowserVerificationLoginRequired(accountKey, baseUrl, current, runId);
  }
  const mergedResult = mergeCheckinVerificationResult({
    status: "manual_required",
    success: false,
    message: current?.message || "站点签到需要人工验证",
    endpoint: current?.endpoint || `${baseUrl}/api/user/checkin`,
    manual_url: manualUrl,
    error_code: "turnstile_required",
    diagnostic_run_id: runId,
    ...(current?.verification ? { verification: current.verification } : {}),
  }, verificationResult);
  const now = new Date();
  const today = localDateKey(now);
  await persistCheckinAccountState(accountKey, {
    ...current,
    status: mergedResult.status,
    trigger: "manual",
    message: mergedResult.message,
    endpoint: mergedResult.endpoint,
    ...(mergedResult.reward ? { reward: mergedResult.reward } : {}),
    ...(mergedResult.manual_url ? { manual_url: mergedResult.manual_url } : {}),
    ...(mergedResult.error_code ? { error_code: mergedResult.error_code } : {}),
    diagnostic_run_id: runId,
    ...(mergedResult.verification ? { verification: mergedResult.verification } : {}),
    last_attempt_at: now.toISOString(),
    ...(current?.last_auto_attempt_local_date
      ? { last_auto_attempt_local_date: current.last_auto_attempt_local_date }
      : {}),
    ...(mergedResult.success
      ? { satisfied_local_date: today }
      : current?.satisfied_local_date
        ? { satisfied_local_date: current.satisfied_local_date }
        : {}),
  });
  if (mergedResult.success) {
    queueBalanceRefreshForCheckinAccount(account);
  }
  return verificationResult;
}

async function runCheckinBatch(
  accounts: SiteBalanceSession[],
  trigger: CheckinTrigger,
): Promise<CheckinBatchSummary> {
  let settledResults: PromiseSettledResult<CheckinResult>[] = [];
  try {
    settledResults = await settleCheckinsSequentially(
      accounts,
      (account) => executeCheckinAccount(account, trigger, "defer"),
    );
  } finally {
    await flushCheckinLocalState();
  }
  const results = settledResults.map((settled, index) => ({
    account: accounts[index],
    result: settled.status === "fulfilled"
      ? settled.value
      : unexpectedCheckinFailure(accounts[index]),
  }));

  for (const { account, result } of results) {
    if (result.status === "success" || result.status === "already_checked") {
      queueBalanceRefreshForCheckinAccount(account);
    }
  }

  return results.reduce<CheckinBatchSummary>((summary, item) => {
    summary[item.result.status] += 1;
    summary.total += 1;
    return summary;
  }, {
    total: 0,
    success: 0,
    already_checked: 0,
    manual_required: 0,
    login_required: 0,
    unsupported: 0,
    failed: 0,
  });
}

async function runEnabledCheckins(trigger: CheckinTrigger): Promise<CheckinBatchSummary> {
  const today = localDateKey();
  const accounts = listCheckinAccounts().filter((account) => (
    account.auto_checkin_enabled === true
    && (trigger === "manual" || isAutomaticCheckinEligible(account, today))
  ));
  return runCheckinBatch(accounts, trigger);
}

function startCheckinScheduler(): void {
  checkinScheduler?.stop();
  checkinScheduler = new CheckinScheduler({
    hasEligibleAccounts: (today) => listCheckinAccounts().some((account) => (
      isAutomaticCheckinEligible(account, today)
    )),
    runAutomaticCheckins: async () => {
      await runEnabledCheckins("automatic");
    },
    onScheduled: async (scheduledAt) => {
      await persistNextCheckinSchedule(scheduledAt);
    },
    onCleared: async () => {
      await persistNextCheckinSchedule("");
    },
  });
  checkinScheduler.start();
}

class StateAccessor {
  constructor(private store: LocalStateStore, private currentState: LocalState) {}

  get(): LocalState {
    return this.currentState;
  }

  async save(state: LocalState): Promise<void> {
    await this.store.save(state);
    this.currentState = state;
    // 通知渲染进程
    for (const win of getCodeDeckWindows()) {
      win.webContents.send("profile:state-changed", state);
    }
  }
}

class SyncStoreAdapter {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private store: EncryptedConfigStore,
    private getPassphrase: () => string,
    private currentConfig: EncryptedProfileConfig,
  ) {}

  saveConfig(config: EncryptedProfileConfig): Promise<void> {
    return this.enqueueConfigUpdate(config);
  }

  updateGlobalProxy(proxy: string): Promise<void> {
    return this.enqueueConfigUpdate({
      global_proxy: proxy,
      protected_settings_version: 1,
    });
  }

  private enqueueConfigUpdate(config: Partial<EncryptedProfileConfig>): Promise<void> {
    const nextSave = this.saveQueue.catch(() => undefined).then(async () => {
      const pw = this.getPassphrase();
      if (!pw) {
        return;
      }
      const nextConfig = normalizeEncryptedProfileConfig({
        ...this.currentConfig,
        ...config,
        runtime_env_by_profile: config.runtime_env_by_profile
          ?? this.currentConfig.runtime_env_by_profile,
        global_proxy: config.global_proxy ?? this.currentConfig.global_proxy,
        protected_settings_version: 1,
      });
      await this.store.save(nextConfig, pw);
      this.currentConfig = nextConfig;
    });
    this.saveQueue = nextSave;
    return nextSave;
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

function destroyAppTray(): void {
  appTray?.destroy();
  appTray = null;
}

function requestExplicitQuit(): void {
  isExplicitlyQuitting = true;
  app.quit();
}

function ensureAppTray(): void {
  if (appTray || !app.isReady()) {
    return;
  }
  const iconPath = resolveWindowIconPath();
  if (!iconPath) {
    appLogger.error("tray", "icon_missing", "Application tray icon could not be resolved");
    return;
  }
  const tray = new Tray(iconPath);
  tray.setToolTip(APP_NAME);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: "打开 CodeDeck",
      click: () => {
        void reactivateMainWindow("tray").catch((error) => {
          appLogger.error("tray", "reopen_failed", "Failed to reopen CodeDeck from tray", { error });
        });
      },
    },
    { type: "separator" },
    { label: "退出", click: requestExplicitQuit },
  ]));
  tray.on("click", () => {
    void reactivateMainWindow("tray").catch((error) => {
      appLogger.error("tray", "reopen_failed", "Failed to reopen CodeDeck from tray", { error });
    });
  });
  appTray = tray;
}

function syncCloseToTraySetting(enabled: unknown): void {
  closeToTrayEnabled = enabled === true;
  if (closeToTrayEnabled) {
    ensureAppTray();
  } else {
    destroyAppTray();
  }
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
  if (!nodePtyModule) {
    throw new Error("node-pty 尚未初始化，请先调用 ensureNodePtyLoaded()。");
  }
  const ptyProcess = nodePtyModule.spawn(options.filePath, options.args, {
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

function stopTerminalTitleResolution(sessionId: string): void {
  const timer = terminalTitlePollTimers.get(sessionId);
  if (!timer) {
    return;
  }
  clearTimeout(timer);
  terminalTitlePollTimers.delete(sessionId);
}

function applyTerminalDisplayTitle(sessionId: string, provider: string, displayTitle: string): void {
  const normalizedTitle = normalizeTerminalDisplayTitle(displayTitle);
  if (!normalizedTitle) {
    return;
  }
  terminalSessionManager.updateDisplayTitle(sessionId, normalizedTitle);
  const browserWindow = terminalWindows.get(sessionId);
  if (!browserWindow || browserWindow.isDestroyed()) {
    return;
  }
  browserWindow.setTitle(buildTerminalWindowTitle(provider, normalizedTitle));
}

function scheduleTerminalTitleResolution(
  snapshot: TerminalSessionSnapshot,
  plan: Parameters<typeof executeLaunchPlan>[0],
  startedAt: Date,
  expectedPreview?: string,
): void {
  const sessionId = snapshot.sessionId;
  const deadlineMs = Date.now() + TERMINAL_TITLE_POLL_TIMEOUT_MS;

  const poll = async (): Promise<void> => {
    const currentSnapshot = terminalSessionManager.getSnapshot(sessionId);
    if (!currentSnapshot || currentSnapshot.status !== "running") {
      stopTerminalTitleResolution(sessionId);
      return;
    }

    try {
      const titleResult = await findMonitoredTerminalSessionTitle({
        provider: currentSnapshot.provider,
        cwd: currentSnapshot.cwd,
        startedAt,
        sessionId: plan.sessionId,
        expectedPreview,
        codexHome: plan.env.CODEX_HOME,
        claudeHome: plan.env.CLAUDE_CONFIG_DIR,
      });
      if (titleResult.status === "resolved") {
        applyTerminalDisplayTitle(sessionId, currentSnapshot.provider, titleResult.title);
        stopTerminalTitleResolution(sessionId);
        const lifecycleFile = await resolveMonitoredTerminalSessionFile({
          provider: currentSnapshot.provider,
          cwd: currentSnapshot.cwd,
          sessionId: titleResult.sessionId,
          codexHome: plan.env.CODEX_HOME,
          claudeHome: plan.env.CLAUDE_CONFIG_DIR,
        });
        if (lifecycleFile) {
          agentTaskManager?.associateProviderSession(
            sessionId,
            titleResult.sessionId,
            lifecycleFile,
          );
          startTerminalLifecycleWatcher(
            sessionId,
            currentSnapshot.provider,
            lifecycleFile,
            startedAt,
          );
        } else {
          appLogger.debug("terminal", "turn_lifecycle_file_missing", "Terminal lifecycle file was not found", {
            context: {
              provider: currentSnapshot.provider,
              sessionId,
              resolvedSessionId: titleResult.sessionId,
            },
          });
        }
        appLogger.info("terminal", "title_resolved", "Monitored terminal title resolved from session history", {
          context: {
            provider: currentSnapshot.provider,
            sessionId,
            launchSessionId: plan.sessionId,
            resolvedSessionId: titleResult.sessionId,
            candidateCount: titleResult.candidateCount,
          },
        });
        return;
      }
      if (titleResult.status === "ambiguous") {
        appLogger.debug("terminal", "title_resolution_ambiguous", "Monitored terminal title candidates are ambiguous", {
          context: {
            provider: currentSnapshot.provider,
            sessionId,
            launchSessionId: plan.sessionId,
            candidateCount: titleResult.candidateCount,
          },
        });
      }
    } catch (error) {
      appLogger.debug("terminal", "title_resolution_failed", "Monitored terminal title lookup failed", {
        context: {
          provider: currentSnapshot.provider,
          sessionId,
          launchSessionId: plan.sessionId,
        },
        error,
      });
    }

    if (!expectedPreview?.trim() && Date.now() >= deadlineMs) {
      stopTerminalTitleResolution(sessionId);
      appLogger.info("terminal", "title_resolution_timeout", "Monitored terminal title resolution timed out", {
        context: {
          provider: currentSnapshot.provider,
          sessionId,
          launchSessionId: plan.sessionId,
        },
      });
      return;
    }

    stopTerminalTitleResolution(sessionId);
    terminalTitlePollTimers.set(sessionId, setTimeout(() => {
      void poll();
    }, TERMINAL_TITLE_POLL_INTERVAL_MS));
  };

  void poll();
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

  browserWindow.on("close", (event) => {
    if (!isExplicitlyQuitting && closeToTrayEnabled && appTray) {
      event.preventDefault();
      browserWindow.hide();
    }
  });

  browserWindow.on("closed", () => {
    if (mainWindow === browserWindow) {
      mainWindow = null;
      void checkinVerificationService?.cancelAll();
      void shutdownBrowserAccountRuntime();
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

async function createTerminalWindow(snapshot: TerminalSessionSnapshot): Promise<BrowserWindow> {
  const browserWindow = new BrowserWindow({
    title: buildTerminalWindowTitle(snapshot.provider, snapshot.displayTitle),
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
  terminalWindows.set(snapshot.sessionId, browserWindow);
  applyTerminalTaskbarActivity(snapshot.sessionId, {
    previousActivity: snapshot.activity,
    activity: snapshot.activity,
    reason: "busy_output",
  });
  browserWindow.on("focus", () => {
    stopTerminalTaskbarFlash(snapshot.sessionId, browserWindow);
  });
  browserWindow.on("closed", () => {
    stopTerminalTaskbarFlash(snapshot.sessionId);
    stopTerminalLifecycleWatcher(snapshot.sessionId);
    terminalWindows.delete(snapshot.sessionId);
    stopTerminalTitleResolution(snapshot.sessionId);
    void terminalSessionManager.closeSession(snapshot.sessionId, "window_closed").catch(() => {
      // Ignore close races when the PTY already exited.
    });
  });
  await browserWindow.loadURL(buildRendererUrl({ view: "terminal", sessionId: snapshot.sessionId }));
  return browserWindow;
}

async function reactivateMainWindow(reason: AppReactivationReason): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) {
    if (!app.isReady()) {
      return;
    }
    await createMainWindow();
  }

  const browserWindow = mainWindow;
  if (!browserWindow || browserWindow.isDestroyed()) {
    return;
  }
  if (!revealAndFocusMainWindow(browserWindow)) {
    return;
  }

  const event = {
    reason,
    reactivated_at: new Date().toISOString(),
  } as const;
  browserWindow.webContents.send(APP_REACTIVATED_CHANNEL, event);
  appLogger.info("app", "app_reactivated", "Existing CodeDeck instance reactivated", {
    context: event,
  });
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
  }, { level: "debug", logActivity: false });
  handleIpc("terminal:update-auto-continue", async (
    _event,
    sessionId: string,
    patch: TerminalAutoContinueConfigPatch,
  ) => {
    terminalSessionManager.updateAutoContinueConfig(sessionId, patch);
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

  handleIpc("profile:get-encryption-status", async () => {
    return getEncryptionSetupStatus();
  }, { level: "debug" });
  handleIpc("profile:check-encrypted-config", async () => {
    const mode = (await getEncryptionSetupStatus()).mode;
    return mode === "unlock" || mode === "auto-unlock";
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
        await checkinVerificationService?.cancelAll();
        await ensureProfileStoresReady();
        const setupStatus = await getEncryptionSetupStatus();
        appLogger.info("auth", "unlock_profile_services_ready", "Profile storage services ready during unlock");
        const { config, state } = await loadProfilesAndState(passphrase);
        if (setupStatus.mode === "auto-unlock") {
          await autoUnlockKeyStore!.remove();
        }
        appLogger.info("auth", "unlock_profiles_loaded", "Profiles loaded during unlock", {
          context: {
            profileCount: config.profiles.length,
          },
        });
        const bootstrap = await activateProfileServices(passphrase, config, state);

        appLogger.info("auth", "unlock_success", "Profile unlock succeeded");
        return {
          success: true,
          bootstrap,
          warnings: takeLegacyCleanupWarnings(),
        };
      } catch (err: any) {
        appLogger.error("auth", "unlock_error", "Profile unlock failed", { error: err });
        for (const win of getCodeDeckWindows()) {
          win.webContents.send("profile:unlock-error", err?.message || "解锁失败");
        }
        throw err;
      }
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:unlock-without-passphrase",
    async () => {
      await checkinVerificationService?.cancelAll();
      await ensureProfileStoresReady();
      const passphrase = await autoUnlockKeyStore!.loadRequired();
      const { config, state } = await loadProfilesAndState(passphrase);
      return {
        success: true,
        bootstrap: await activateProfileServices(passphrase, config, state),
        warnings: takeLegacyCleanupWarnings(),
      };
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:initialize-encryption",
    async (_event, passphrase: string) => {
      await checkinVerificationService?.cancelAll();
      await ensureProfileStoresReady();
      if (!passphrase) {
        throw new Error("配置口令不能为空");
      }
      const setupStatus = await encryptedStore!.getStatus();
      if (setupStatus.mode === "unlock") {
        throw new Error("加密配置已存在，请使用解锁流程。");
      }
      await autoUnlockKeyStore!.remove();
      const { config, state } = await initializeProfilesAndState(passphrase);
      return {
        success: true,
        bootstrap: await activateProfileServices(passphrase, config, state),
        warnings: takeLegacyCleanupWarnings(),
      };
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

  handleIpc(
    "profile:initialize-without-passphrase",
    async () => {
      await checkinVerificationService?.cancelAll();
      await ensureProfileStoresReady();
      const passphrase = await autoUnlockKeyStore!.createOrLoad();
      const { config, state } = await initializeProfilesAndState(passphrase);
      return {
        success: true,
        bootstrap: await activateProfileServices(passphrase, config, state),
        warnings: takeLegacyCleanupWarnings(),
      };
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:enable-passphrase",
    async (_event, nextPassword: string) => {
      await ensureProfileStoresReady();
      if (!nextPassword) {
        throw new Error("新密码不能为空");
      }
      const automaticPassphrase = await autoUnlockKeyStore!.loadRequired();
      await encryptedStore!.changePassphrase(automaticPassphrase, nextPassword);
      try {
        await autoUnlockKeyStore!.remove();
      } catch (error) {
        await encryptedStore!.changePassphrase(nextPassword, automaticPassphrase).catch(() => undefined);
        throw error;
      }
      currentPassphrase = nextPassword;
      return { success: true };
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:disable-passphrase",
    async (_event, currentPassword: string) => {
      await ensureProfileStoresReady();
      if (!currentPassword) {
        throw new Error("当前密码不能为空");
      }
      await encryptedStore!.load(currentPassword);
      const automaticPassphrase = await autoUnlockKeyStore!.createOrLoad();
      try {
        await encryptedStore!.changePassphrase(currentPassword, automaticPassphrase);
      } catch (error) {
        await autoUnlockKeyStore!.remove().catch(() => undefined);
        throw error;
      }
      currentPassphrase = automaticPassphrase;
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
      browserIdentitySlots: svc.getBrowserIdentitySlots(),
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
      const saved = await getProfileService().saveProfile(targetKey, draft, runtime);
      await syncCodexProviderRegistry(
        getProfileService().getProfiles(),
        getProfileService().getState().parameter_settings,
      );
      return saved;
    },
  );

  handleIpc("profile:delete", async (_event, key: ProfileKey) => {
    await getProfileService().deleteProfile(key);
    await syncCodexProviderRegistry(
      getProfileService().getProfiles(),
      getProfileService().getState().parameter_settings,
    );
  });

  handleIpc(
    "profile:clone",
    async (_event, sourceKey: ProfileKey, targetProvider: string) => {
      const cloned = await getProfileService().cloneProfileToProvider(sourceKey, targetProvider);
      await syncCodexProviderRegistry(
        getProfileService().getProfiles(),
        getProfileService().getState().parameter_settings,
      );
      return cloned;
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
    "profile:select-channel",
    async (_event, profileKey: ProfileKey, channelId: string) => {
      return getProfileService().selectProfileChannel(profileKey, channelId);
    },
  );

  handleIpc(
    "profile-health:test",
    async (_event, request: ProfileHealthTestRequest) => testProfileHealth(request),
    { includeArgs: false },
  );

  handleIpc(
    "profile-health:get",
    (_event, request: ProfileHealthTestRequest): ProfileHealthTestResult | null => {
      const profileKey = request.profile_key?.trim() ?? "";
      const target = buildProfileHealthTarget(request.profile, profileKey);
      const targetKey = profileHealthTargetKey(target);
      const savedMatch = resolveSavedProfileHealthMatch(request);
      const persistedState = savedMatch
        ? getProfileService().getState().profile_health_by_target[targetKey]
        : undefined;
      return persistedState
        ? { target_key: targetKey, state: persistedState, persisted: true }
        : null;
    },
    { includeArgs: false, level: "debug" },
  );

  handleIpc(
    "profile-health:clear",
    async (_event, request: ProfileHealthTestRequest): Promise<void> => {
      const target = buildProfileHealthTarget(request.profile, request.profile_key?.trim() ?? "");
      const targetKey = profileHealthTargetKey(target);
      if (resolveSavedProfileHealthMatch(request)) {
        await enqueueProfileHealthStateUpdate((state) => {
          delete state.profile_health_by_target[targetKey];
        });
      }
    },
    { includeArgs: false },
  );

  handleIpc(
    "profile:refresh-channel-models",
    async (_event, profileKey: ProfileKey, channelId: string) => {
      const svc = getProfileService();
      const profile = svc.getProfiles().find((candidate) => itemKey(candidate) === profileKey);
      const channel = profile?.channels?.find((candidate) => candidate.id === channelId.trim());
      if (!profile || !channel) {
        throw new Error("Profile 渠道不存在");
      }
      const result = await getModelCatalogService().fetch({
        baseUrl: profile.url,
        apiKey: channel.key,
      });
      const modelsFetchedAt = new Date().toISOString();
      const updatedProfile = await svc.updateProfileChannelModels(
        profileKey,
        channel.id,
        result.models,
        modelsFetchedAt,
        profile.url,
      );
      return { models: result.models, modelsFetchedAt, profile: updatedProfile };
    },
  );

  handleIpc(
    "profile:update-organization",
    async (_event, provider: string, organization: ProfileOrganization) => {
      await getProfileService().updateProfileOrganization(provider, organization);
    },
  );

  handleIpc(
    "profile:activate-provider",
    async (_event, provider: string) => {
      await getProfileService().activateProvider(provider);
    },
  );
  handleIpc(
    "profile:update-runtime-settings",
    async (_event, profileKey: ProfileKey, patch: Partial<RuntimeSettings>) => {
      return getProfileService().updateProfileRuntimeSettings(profileKey, patch);
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
    "browser-auth:login",
    async (
      _event,
      baseUrl: string,
      browserSlot?: number,
      customCompatibility?: unknown,
    ): Promise<SiteBalanceSession> => (
      loginBrowserAccount(baseUrl, undefined, browserSlot, customCompatibility)
    ),
  );
  handleIpc(
    "browser-auth:relogin",
    async (
      _event,
      baseUrl: string,
      sessionId: string,
      customCompatibility?: unknown,
    ): Promise<SiteBalanceSession> => (
      loginBrowserAccount(baseUrl, sessionId, undefined, customCompatibility)
    ),
  );
  handleIpc(
    "browser-auth:logout",
    async (_event, baseUrl: string, sessionId: string): Promise<void> => {
      const account = findCheckinAccount(baseUrl, sessionId);
      if (account.auth_kind !== "browser_session") {
        throw new Error("账号不是浏览器登录类型");
      }
      const accountKey = buildCheckinAccountKey(normalizeBalanceBaseUrl(baseUrl), sessionId);
      await checkinVerificationService?.cancelAccount(accountKey);
      await getBrowserAccountSessionManager().logout(accountKey, account);
      const state = getProfileStateAccessor().get();
      delete state.site_capability_cache.checkin_by_account[accountKey];
      delete state.site_capability_cache.balance_by_target[`session:${accountKey}`];
      await persistCheckinAccountState(accountKey, {
        status: "login_required",
        message: "已退出浏览器登录，请重新登录",
      });
    },
  );
  handleIpc(
    "profile:bind-site-balance-session",
    async (_event, profileKey: ProfileKey, baseUrl: string, sessionId: string) => (
      getProfileService().bindProfileSiteBalanceSession(profileKey, baseUrl, sessionId)
    ),
  );
  handleIpc(
    "browser-auth:get-status",
    async (_event, baseUrl: string, sessionId: string): Promise<BrowserAccountStatusSnapshot> => {
      const accountKey = buildCheckinAccountKey(normalizeBalanceBaseUrl(baseUrl), sessionId);
      return getBrowserAccountSessionManager().getStatus(accountKey);
    },
  );
  handleIpc(
    "profile:delete-site-balance-session",
    async (_event, baseUrl: string, sessionId: string) => {
      const normalizedBaseUrl = normalizeBalanceBaseUrl(baseUrl);
      const account = findCheckinAccount(baseUrl, sessionId);
      const accountKey = buildCheckinAccountKey(normalizedBaseUrl, sessionId);
      await checkinVerificationService?.cancelAccount(accountKey);
      if (account.auth_kind === "browser_session") {
        customCompatibilityFetchesByPartition.delete(customCompatibilityPartition(account));
        const remainingSlotReferences = listCheckinAccounts().filter((item) => (
          buildCheckinAccountKey(normalizeBalanceBaseUrl(item.base_url), item.id) !== accountKey
          && item.auth_kind === "browser_session"
          && item.browser_session_id === account.browser_session_id
        ));
        const clearWholePartition = remainingSlotReferences.length === 0;
        const identitySlot = clearWholePartition
          ? getProfileService().getBrowserIdentitySlots().find(
              (slot) => slot.browser_session_id === account.browser_session_id,
            )
          : undefined;
        await getBrowserAccountSessionManager().deleteAccount(
          accountKey,
          account,
          clearWholePartition,
        );
        await getProfileService().deleteSiteBalanceSession(baseUrl, sessionId);
        if (identitySlot) {
          await getProfileService().deleteBrowserIdentitySlot(identitySlot.slot);
        }
        return;
      }
      if (account.custom_compatibility?.enabled) {
        const partition = customCompatibilityPartition(account);
        customCompatibilityFetchesByPartition.delete(partition);
        const browserSession = electronSession.fromPartition(partition);
        await browserSession.clearStorageData();
        await browserSession.clearCache();
      }
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
  handleIpc("profile:open-base-url", async (
    _event,
    baseUrl: string,
    target: unknown,
  ) => {
    await openProfileSiteBrowser(baseUrl, target);
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
    const { planRequest, plan } = await prepareLaunchExecution(request);
    try {
      if (request.desktop_handoff) {
        if (request.provider !== "codex") {
          throw new Error("Desktop 交接仅支持 Codex。");
        }
        validateCodexDesktopHandoffLaunch(plan.launchMode, plan.sessionId);
        let temporarySessionId: string | undefined;
        if (plan.launchMode === "new") {
          await completeNewDesktopHandoff(plan);
        } else {
          const snapshot = await launchMonitoredTerminalSession(plan, { showWindow: false });
          temporarySessionId = snapshot.sessionId;
          await completeDesktopHandoff(snapshot, plan);
        }
        invalidateSessionCaches(request.provider);
        appLogger.info("launcher", "desktop_handoff_success", "Codex Desktop handoff completed", {
          durationMs: Date.now() - startedAt,
          context: {
            provider: request.provider,
            profileKey: request.profile_key,
            launchMode: plan.launchMode,
            cwd: plan.cwd,
            commandExecutable: plan.commandExecutable,
            temporarySessionId,
            hasCodexConfig: !!plan.codexConfig,
          },
        });
        return describeLaunchResult("direct");
      }
      if (plan.terminalMode === "monitored") {
        const snapshot = await launchMonitoredTerminalSession(plan);
        const launchedProfile = getProfileService().getProfiles()
          .find((profile) => itemKey(profile) === request.profile_key);
        if (launchedProfile && !isOfficialNativeProfile(launchedProfile)) {
          const healthTarget = buildProfileHealthTarget(
            launchedProfile,
            request.profile_key,
            request.model_override,
          );
          if (healthTarget.base_url && healthTarget.channel_id && healthTarget.model_id) {
            terminalProfileHealthTargets.set(snapshot.sessionId, healthTarget);
          }
        }
        invalidateSessionCaches(request.provider);
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
      invalidateSessionCaches(request.provider);
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
      if (plan.terminalMode === "monitored" && !request.desktop_handoff) {
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
        invalidateSessionCaches(request.provider);
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
      const page = await sessionCatalog!.createPage(request, codexHomes, sessions);
      appLogger.info("sessions", "session_list_finished", "Session list loaded", {
        context: {
          provider: request.provider,
          scope: request.scope,
          codexHomeCount: codexHomes.length,
          sessionCount: page.sessions.length,
          catalogState: page.catalog_state,
          catalogRevision: page.revision,
          partial: page.partial,
        },
      });
      return page;
    },
  );
  handleIpc(
    "profile:update-site-balance-session-auto-checkin",
    async (_event, baseUrl: string, sessionId: string, enabled: boolean) => {
      const updated = await getProfileService().updateSiteBalanceSessionAutoCheckin(
        baseUrl,
        sessionId,
        enabled,
      );
      checkinScheduler?.refresh();
      return updated;
    },
  );
  handleIpc(
    "custom-compatibility:select-element",
    async (
      _event,
      baseUrl: string,
      sessionId: string,
      pageUrl: string,
    ): Promise<CustomElementSelectorResult | null> => {
      const normalizedBaseUrl = normalizeBalanceBaseUrl(baseUrl);
      const normalizedPageUrl = normalizeCustomSelectorPageUrl(pageUrl);
      const normalizedSessionId = sessionId.trim();
      let partition = DEFAULT_PROFILE_BROWSER_PARTITION;
      if (normalizedSessionId) {
        const account = findCheckinAccount(normalizedBaseUrl, normalizedSessionId);
        if (!isDeclaredCustomSelectorPage(account, normalizedPageUrl)) {
          throw new Error("元素选择页面必须是当前账号已声明的自定义规则页面");
        }
        partition = customCompatibilityPartition(account);
      } else if (new URL(normalizedPageUrl).origin !== new URL(normalizedBaseUrl).origin) {
        throw new Error("新建账号尚未保存规则时，只允许选择官网同源页面");
      }
      return getCustomElementSelectorService().selectElement({
        pageUrl: normalizedPageUrl,
        partition,
      });
    },
    { includeArgs: false },
  );

  handleIpc(
    "session:get-detail",
    async (_event, request: GetSessionDetailRequest) => {
      const codexHome = await resolveCodexSessionHome(request);
      const session = await getSessionDetailForProvider(request, {
        getClaudeSessionDetail,
        getCodexSessionDetail: (detailRequest) => getCodexSessionDetail(
          detailRequest,
          codexHome,
        ),
      });
      appLogger.info("sessions", "session_detail_finished", "Session detail loaded", {
        context: {
          provider: request.provider,
          scope: request.scope,
          sessionId: request.session_id,
          found: !!session,
        },
      });
      return session;
    },
  );

  handleIpc("session:refresh", async (_event, provider: string) => {
    sessionListCache.invalidate(provider);
    if (provider.trim().toLowerCase() === "codex") {
      invalidateCodexSessionCache();
    }
    const codexHomes = await resolveCodexSessionHomes({
      provider,
      scope: "global_recent",
    });
    return sessionCatalog!.refresh(provider, codexHomes);
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

  handleIpc(
    "checkin:run-account",
    async (_event, baseUrl: string, sessionId: string): Promise<CheckinResult> => {
      const account = findCheckinAccount(baseUrl, sessionId);
      const result = await executeCheckinAccount(account, "manual", "open");
      if (result.status === "success" || result.status === "already_checked") {
        queueBalanceRefreshForCheckinAccount(account);
      }
      return result;
    },
  );
  handleIpc(
    "checkin:run-enabled",
    async (): Promise<CheckinBatchSummary> => runEnabledCheckins("manual"),
  );
  handleIpc(
    "checkin:open-verification",
    async (
      _event,
      baseUrl: string,
      sessionId: string,
    ): Promise<CheckinVerificationResult> => {
      const account = findCheckinAccount(baseUrl, sessionId);
      return reopenCheckinVerification(account);
    },
    { includeArgs: false },
  );
  handleIpc(
    "checkin:get-snapshot",
    (): CheckinSnapshot => getCheckinSnapshot(),
    { level: "debug" },
  );

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
      const wasAgentBridgeEnabled = getAgentBridgeSettings()?.enabled === true;
      const updated = await getSettingsStateService().updateParameterSettings(settings);
      if (wasAgentBridgeEnabled && !updated.agent_bridge.enabled && agentTaskManager) {
        await agentTaskManager.shutdown();
        agentTaskManager = null;
      }
      await syncCodexProviderRegistry(getProfileService().getProfiles(), updated);
      return updated;
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
      syncCloseToTraySetting(updated.close_to_tray);
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
    void reactivateMainWindow("second_instance").catch((error) => {
      appLogger.error("app", "app_reactivation_failed", "Failed to reactivate main window", { error });
    });
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
  await startAgentBridgeServer().catch((error) => {
    appLogger.error("agent_bridge", "server_start_failed", "Local AI delegation bridge failed to start", {
      error,
    });
  });

  // 3. 创建主窗口
  await createMainWindow();
  appLogger.info("app", "main_window_created", "Main window created");

  app.on("activate", async () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      await createMainWindow();
    }
  });
});

app.on("before-quit", (event) => {
  isExplicitlyQuitting = true;
  destroyAppTray();
  checkinScheduler?.stop();
  void checkinVerificationService?.cancelAll();
  void agentTaskManager?.shutdown();
  void agentBridgeServer?.stop();
  if (
    !browserAccountRuntimeCleanupCompletedForQuit
    && (browserAccountSessionManager || pendingBrowserAccountReferences)
  ) {
    event.preventDefault();
    void shutdownBrowserAccountRuntime().finally(() => {
      browserAccountRuntimeCleanupCompletedForQuit = true;
      app.quit();
    });
  }
});

app.on("window-all-closed", () => {
  appLogger.info("app", "window_all_closed", "All windows closed");
  if (process.platform !== "darwin") {
    checkinScheduler?.stop();
    app.quit();
  }
});

process.on("uncaughtException", (error) => {
  appLogger.error("process", "uncaught_exception", "Uncaught exception", { error });
});

process.on("unhandledRejection", (reason) => {
  appLogger.error("process", "unhandled_rejection", "Unhandled rejection", { error: reason });
});
