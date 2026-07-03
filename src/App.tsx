import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdvancedModelMapping, Profile, ProfileKey, GlobalSettings, LaunchMode } from "./shared/profile/types.js";
import type { BootstrapResult, LocalState } from "./shared/state/local-state.js";
import {
  getSessionFavoriteKey,
  mergeBootstrapState,
  normalizeSessionFavorites,
  normalizeWorkingDirectoryFavorites,
  type FavoriteSessionSummary,
} from "./shared/state/local-state.js";
import type { CommandPreview, LaunchRequest, LaunchSessionSource } from "./shared/launcher/types.js";
import type { BalanceCheckState } from "./shared/balance/types.js";
import type { ParameterSettings } from "./shared/parameter/types.js";
import type {
  ListSessionsRequest,
  SessionSummary,
} from "./shared/services/session-service.js";
import { itemKey } from "./shared/profile/keys-internal.js";
import {
  PROVIDER_CLAUDE,
  PROVIDER_CODEX,
  defaultRuntimeSettings,
  resolveClaudeModelAliasMode,
  shouldRecommendClaudeSingleModelCompatibility,
} from "./shared/profile/types.js";
import { defaultProfilePermissions, normalizeProfilePermissions, type PermissionPreset, type ProfilePermissions } from "./shared/profile/permissions.js";
import {
  listProfilesForProvider,
  resolveHistoryRestoreProfileKey,
} from "./shared/session-history-state.js";
import {
  buildNewProfileDraft,
  buildRuntimeSettingsFromDraft,
  buildSelectedProfileDraft,
  hasProfileDraftChanges,
  hasOnlyProfileDraftBalanceSessionChange,
  hasOnlyProfileDraftCwdChange,
  hasOnlyProfileDraftSelectedModelIdChange,
  type ProfileEditorDraft,
} from "./shared/profile-editor-state.js";
import { APP_NAME } from "./shared/branding.js";

// Components
import {
  buildBalanceListEntry,
  getBalanceStateForProfile,
} from "./shared/balance/presentation.js";
import {
  describeBalanceSessionHint,
  getSiteBalanceSessionsForBaseUrl,
  normalizeBalanceBaseUrl,
  type SiteBalanceSessionsByBaseUrl,
} from "./shared/balance/site-balance-sessions.js";
import { normalizeThemeMode, resolveEffectiveTheme } from "./shared/theme.js";

type TabId = "skills" | "profiles" | "sessions" | "settings";
type SessionsViewId = "claude" | "codex" | "favorites";
type SettingsSubTab = "global" | "parameters";
type BalanceSessionDraftState = {
  label: string;
  access_token: string;
  user_id: string;
};
type HydratedProfilesResult = {
  profiles: Profile[];
  state: LocalState;
  siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
  defaultWorkingDirectory: string;
};
type ModelCatalogCacheEntry = {
  models: string[];
  fetchedAt: string;
};
type ModelCatalogFetchState = {
  busy: boolean;
  error: string | null;
};
type StartupPhase = "checking" | "locked" | "unlocking" | "ready";

const EMPTY_MODEL_OPTIONS: string[] = [];
const DRAFT_PREVIEW_DEBOUNCE_MS = 300;
const HISTORY_PAGE_SIZE = 20;
let profilesPagePreloadPromise: Promise<typeof import("./components/app/ProfilesPage.tsx")> | null = null;

function preloadProfilesPageModule() {
  profilesPagePreloadPromise ??= import("./components/app/ProfilesPage.tsx");
  return profilesPagePreloadPromise;
}

function scheduleProfilesPagePreload(): () => void {
  const preload = () => {
    void preloadProfilesPageModule();
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(preload, { timeout: 2000 });
    return () => window.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(preload, 800);
  return () => window.clearTimeout(id);
}

const eagerAppPages = import.meta.env.MODE === "test"
  ? await Promise.all([
      import("./components/app/ProfilesPage.tsx"),
      import("./components/app/SessionsPage.tsx"),
      import("./components/app/SettingsPage.tsx"),
      import("./components/skills/SkillsPanel.tsx"),
    ])
  : null;
const EagerProfilesPage = eagerAppPages?.[0].ProfilesPage ?? null;
const EagerSessionsPage = eagerAppPages?.[1].SessionsPage ?? null;
const EagerSettingsPage = eagerAppPages?.[2].SettingsPage ?? null;
const EagerSkillsPanel = eagerAppPages?.[3].SkillsPanel ?? null;

const LazyProfilesPage = lazy(() =>
  preloadProfilesPageModule().then((module) => ({ default: module.ProfilesPage })),
);
const LazySessionsPage = lazy(() =>
  import("./components/app/SessionsPage.tsx").then((module) => ({ default: module.SessionsPage })),
);
const LazySettingsPage = lazy(() =>
  import("./components/app/SettingsPage.tsx").then((module) => ({ default: module.SettingsPage })),
);
const LazySkillsPanel = lazy(() =>
  import("./components/skills/SkillsPanel.tsx").then((module) => ({ default: module.SkillsPanel })),
);
const ProfilesPageComponent = EagerProfilesPage ?? LazyProfilesPage;
const SessionsPageComponent = EagerSessionsPage ?? LazySessionsPage;
const SettingsPageComponent = EagerSettingsPage ?? LazySettingsPage;
const SkillsPanelComponent = EagerSkillsPanel ?? LazySkillsPanel;

type StartupCheckResult = {
  hasEncryptedConfig: boolean;
};

let startupCheckPromise: Promise<StartupCheckResult> | null = null;
let startupCheckResult: StartupCheckResult | null = null;
let startupMilestonesLogged = new Set<string>();

export function resetAppStartupStateForTests(): void {
  startupCheckPromise = null;
  startupCheckResult = null;
  startupMilestonesLogged = new Set<string>();
}

function logRendererEvent(event: string, message: string, context?: unknown): void {
  window.profileManager?.logRendererEvent?.(event, message, context);
}

function logRendererMilestoneOnce(event: string, message: string, context?: unknown): void {
  if (startupMilestonesLogged.has(event)) {
    return;
  }
  startupMilestonesLogged.add(event);
  logRendererEvent(event, message, context);
}

async function resolveStartupCheckResult(): Promise<StartupCheckResult> {
  if (startupCheckResult) {
    return startupCheckResult;
  }
  if (!window.profileManager) {
    throw new Error("当前环境未注入 Profile API，请通过 Electron 运行。");
  }
  if (!startupCheckPromise) {
    startupCheckPromise = window.profileManager.checkEncryptedConfig()
      .then((hasEncryptedConfig) => {
        startupCheckResult = { hasEncryptedConfig };
        return startupCheckResult;
      })
      .catch((error) => {
        startupCheckPromise = null;
        throw error;
      });
  }
  return startupCheckPromise;
}

function StartupLoading({ message }: { message: string }) {
  return (
    <div className="startup-screen">
      <div className="unlock-card">
        <h1>{APP_NAME}</h1>
        <p>{message}</p>
        <div className="startup-progress" role="progressbar" aria-label={message}>
          <span className="startup-progress-bar" />
        </div>
      </div>
    </div>
  );
}

function useEventCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback(((...args: Parameters<T>) => callbackRef.current(...args)) as T, []);
}

function emptyBalanceSessionDraft(): BalanceSessionDraftState {
  return {
    label: "",
    access_token: "",
    user_id: "",
  };
}

function isEmptyNewBalanceSessionDraft(selection: string, draft: BalanceSessionDraftState): boolean {
  return selection === "new"
    && !draft.access_token.trim()
    && !draft.user_id.trim();
}

function normalizeEmptyNewBalanceSessionDraft(draft: ProfileEditorDraft): ProfileEditorDraft {
  if (!isEmptyNewBalanceSessionDraft(draft.balanceSessionSelection, draft.balanceSessionDraft)) {
    return draft;
  }
  return {
    ...draft,
    balanceSessionSelection: "auto",
    balanceSessionDraft: emptyBalanceSessionDraft(),
  };
}

function emptyPreview(): CommandPreview {
  return {
    command: "",
    cwd: "",
    env: [],
    valid: false,
  };
}

function buildLaunchPanelTerminalSummary(
  provider: "claude" | "codex",
  monitorModeEnabled: boolean,
  parameterSettings: ParameterSettings | undefined,
): string | undefined {
  if (provider === PROVIDER_CLAUDE) {
    return "Claude 终端：系统直连";
  }
  if (!monitorModeEnabled) {
    return "Codex 终端：系统直连（不接管交互）";
  }
  const codexSettings = parameterSettings?.cli_settings?.codex;
  if (!codexSettings?.auto_continue_on_failure) {
    return "Codex 终端：受监控独立窗口（自动继续关闭）";
  }
  if (codexSettings.auto_continue_limit === -1) {
    return "Codex 终端：受监控独立窗口（自动继续已启用，不限次数）";
  }
  return `Codex 终端：受监控独立窗口（自动继续已启用，最多 ${codexSettings?.auto_continue_limit ?? 1} 次）`;
}

function withLaunchPanelTerminalSummary(
  preview: CommandPreview,
  provider: "claude" | "codex",
  monitorModeEnabled: boolean,
  parameterSettings: ParameterSettings | undefined,
): CommandPreview {
  return {
    ...preview,
    terminalSummary: buildLaunchPanelTerminalSummary(provider, monitorModeEnabled, parameterSettings)
      ?? preview.terminalSummary,
  };
}

function sessionSourceFromSummary(session?: SessionSummary): LaunchSessionSource | undefined {
  if (!session?.source_kind && !session?.source_home) {
    return undefined;
  }
  return {
    source_kind: session.source_kind,
    source_home: session.source_home,
  };
}

function withDefaultWorkingDirectory(
  draft: ProfileEditorDraft,
  defaultWorkingDirectory: string,
): ProfileEditorDraft {
  const cwd = draft.cwd.trim() || defaultWorkingDirectory.trim();
  return cwd === draft.cwd ? draft : { ...draft, cwd };
}

function applyClaudeAliasRecommendationForNewDraft(options: {
  provider: string;
  editingKey: string;
  current: AdvancedModelMapping;
  url: string;
  selectedModelId: string;
}): AdvancedModelMapping {
  if (options.provider !== PROVIDER_CLAUDE || options.editingKey) {
    return options.current;
  }
  const aliasMode = resolveClaudeModelAliasMode(options.current);
  const hasCustomTargets = Boolean(
    options.current.claude?.defaultTarget?.trim()
    || options.current.claude?.opusTarget?.trim()
    || options.current.claude?.sonnetTarget?.trim()
    || options.current.claude?.haikuTarget?.trim()
    || options.current.claude?.subagentTarget?.trim(),
  );
  if (aliasMode !== "none" || hasCustomTargets) {
    return options.current;
  }
  if (!shouldRecommendClaudeSingleModelCompatibility(options.url, options.selectedModelId)) {
    return options.current;
  }
  return {
    ...options.current,
    enabled: true,
    claude: {
      ...options.current.claude,
      aliasMode: "single_model_compat",
    },
    codex: {
      ...options.current.codex,
    },
  };
}

function sameSessionRequest(left: ListSessionsRequest | null, right: ListSessionsRequest): boolean {
  return left?.provider === right.provider
    && left.scope === right.scope
    && (left.cwd ?? "") === (right.cwd ?? "")
    && (left.profile_key ?? "") === (right.profile_key ?? "")
    && (left.limit ?? 0) === (right.limit ?? 0)
    && (left.offset ?? 0) === (right.offset ?? 0);
}

function App() {
  // ---- Tab 状态 ----
  const [activeTab, setActiveTab] = useState<TabId>("profiles");
  const [sessionsView, setSessionsView] = useState<SessionsViewId>(PROVIDER_CLAUDE);

  // ---- Profile 状态 ----
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<LocalState | null>(null);
  const [siteBalanceSessionsByBaseUrl, setSiteBalanceSessionsByBaseUrl] = useState<SiteBalanceSessionsByBaseUrl>({});
  const [defaultWorkingDirectory, setDefaultWorkingDirectory] = useState("");
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [startupPhase, setStartupPhase] = useState<StartupPhase>("checking");
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [hasEncryptedConfig, setHasEncryptedConfig] = useState(false);

  // 编辑状态
  const [editingKey, setEditingKey] = useState<ProfileKey>("");
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [draftAdvancedModelMapping, setDraftAdvancedModelMapping] = useState(buildNewProfileDraft(PROVIDER_CLAUDE).advancedModelMapping);
  const [draftPermissions, setDraftPermissions] = useState<ProfilePermissions | null>(null);
  const [draftBalanceSessionSelection, setDraftBalanceSessionSelection] = useState("auto");
  const [draftBalanceSession, setDraftBalanceSession] = useState<BalanceSessionDraftState>(emptyBalanceSessionDraft());
  const [draftCwd, setDraftCwd] = useState("");
  const [draftCommandBase, setDraftCommandBase] = useState("");
  const [draftSettingsFile, setDraftSettingsFile] = useState("");
  const [draftArgs, setDraftArgs] = useState("");
  const [draftExcludeUser, setDraftExcludeUser] = useState(true);
  const [draftExtraEnv, setDraftExtraEnv] = useState<Record<string, string>>({});
  const [editorBaseline, setEditorBaseline] = useState<ProfileEditorDraft | null>(null);
  const [modelCatalogByBaseUrl, setModelCatalogByBaseUrl] = useState<Record<string, ModelCatalogCacheEntry>>({});
  const [modelCatalogFetchByBaseUrl, setModelCatalogFetchByBaseUrl] = useState<Record<string, ModelCatalogFetchState>>({});

  // 命令预览 & 余额检测
  const [preview, setPreview] = useState<CommandPreview>(emptyPreview());
  const [profilesLaunchMonitorModeEnabled, setProfilesLaunchMonitorModeEnabled] = useState(true);
  const [balanceState, setBalanceState] = useState<BalanceCheckState | null>(null);
  const [balanceKey, setBalanceKey] = useState<ProfileKey>("");

  // 会话
  const [profilesSessions, setProfilesSessions] = useState<SessionSummary[]>([]);
  const [profilesSelectedSessionId, setProfilesSelectedSessionId] = useState<string>("");
  const [profilesSessionsLoading, setProfilesSessionsLoading] = useState(false);
  const [profilesSessionsHydratedRequest, setProfilesSessionsHydratedRequest] = useState<ListSessionsRequest | null>(null);
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [historySelectedSessionId, setHistorySelectedSessionId] = useState<string>("");
  const [historyPreview, setHistoryPreview] = useState<CommandPreview>(emptyPreview());
  const [historyIsLoading, setHistoryIsLoading] = useState(false);
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyPrefetchedSessions, setHistoryPrefetchedSessions] = useState<SessionSummary[]>([]);
  const [historyPrefetchedHasMore, setHistoryPrefetchedHasMore] = useState(false);
  const [historyIsPrefetching, setHistoryIsPrefetching] = useState(false);
  const latestHistoryRequestRef = useRef<ListSessionsRequest | null>(null);
  const latestHistoryPrefetchRequestRef = useRef<ListSessionsRequest | null>(null);
  const latestProfilesSessionsRequestRef = useRef<ListSessionsRequest | null>(null);
  const historyPrefetchedOffsetRef = useRef<number | null>(null);
  const historyRequestSeqRef = useRef(0);
  const profilesSessionsRequestSeqRef = useRef(0);
  const previewRequestSeqRef = useRef(0);
  const profilesSessionsHydratedProviderRef = useRef<string | null>(null);
  const profilesSessionsHydratedRequestRef = useRef<ListSessionsRequest | null>(null);

  // 设置
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>("global");
  const [hasHydratedParameterSettings, setHasHydratedParameterSettings] = useState(false);
  const [isHydratingParameterSettings, setIsHydratingParameterSettings] = useState(false);
  const [initialPreviewDeferred, setInitialPreviewDeferred] = useState(false);
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [systemPrefersDark, setSystemPrefersDark] = useState(() =>
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false,
  );

  const activeProvider = (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex";
  const launchPanelPreview = useMemo(
    () => withLaunchPanelTerminalSummary(
      preview,
      activeProvider,
      profilesLaunchMonitorModeEnabled,
      state?.parameter_settings,
    ),
    [activeProvider, preview, profilesLaunchMonitorModeEnabled, state?.parameter_settings],
  );
  const sessionFavorites = state?.session_favorites ?? [];
  const sortedSessionFavorites = useMemo(
    () => [...sessionFavorites].sort(
      (left, right) => new Date(right.favorited_at).getTime() - new Date(left.favorited_at).getTime(),
    ),
    [sessionFavorites],
  );
  const sessionFavoriteKeys = useMemo(
    () => new Set(sessionFavorites.map((session) => session.favorite_key)),
    [sessionFavorites],
  );
  const visibleHistorySessions = useMemo(
    () => sessionsView === "favorites"
      ? sortedSessionFavorites
      : historySessions.filter((session) => session.provider === activeProvider),
    [activeProvider, historySessions, sessionsView, sortedSessionFavorites],
  );
  const selectedHistorySession = visibleHistorySessions.find(
    (session) => getSessionFavoriteKey(session) === historySelectedSessionId,
  );
  const historyRestoreProvider = selectedHistorySession?.provider ?? activeProvider;
  const historyRestoreProfileKey = resolveHistoryRestoreProfileKey(state, profiles, historyRestoreProvider);
  const historyRestoreProfiles = useMemo(
    () =>
      listProfilesForProvider(profiles, historyRestoreProvider).map((profile) => {
        const key = itemKey(profile);
        return {
          key,
          label: profile.name,
          cwd: state?.runtime_by_profile[key]?.cwd.trim() || defaultWorkingDirectory,
        };
      }),
    [defaultWorkingDirectory, historyRestoreProvider, profiles, state?.runtime_by_profile],
  );
  const selectedHistoryRestoreProfile = historyRestoreProfiles.find((profile) => profile.key === historyRestoreProfileKey);
  const historyRestoreDisabled = !selectedHistorySession
    || !historyRestoreProfileKey
    || !selectedHistoryRestoreProfile
    || !selectedHistoryRestoreProfile.cwd.trim();
  const historyRestoreHint = historyRestoreProfiles.length === 0
    ? "当前 provider 尚未配置可用 profile，无法恢复该会话。"
    : !historyRestoreProfileKey
      ? "请先为该 provider 选择用于恢复的 profile。"
      : !selectedHistoryRestoreProfile?.cwd.trim()
        ? "所选 Profile 当前未设置工作目录，请先设置后再恢复。"
        : "恢复时将使用所选 Profile 当前保存的工作目录，不会自动改写历史会话记录中的 cwd。";
  const draftSiteBalanceSessions = useMemo(
    () => getSiteBalanceSessionsForBaseUrl(siteBalanceSessionsByBaseUrl, draftUrl),
    [siteBalanceSessionsByBaseUrl, draftUrl],
  );
  const savedBalanceSessionHint = useMemo(() => {
    const selectedKey = state?.selected_profile_key ?? "";
    const selectedProfile = profiles.find((profile) => itemKey(profile) === selectedKey);
    if (!selectedProfile) {
      return "";
    }
    return describeBalanceSessionHint(selectedProfile, siteBalanceSessionsByBaseUrl);
  }, [profiles, siteBalanceSessionsByBaseUrl, state?.selected_profile_key]);
  const currentProfilesSessionsRequest = useMemo(
    () => buildProfilesSessionsRequest(state, undefined, { preferDraftCwd: false }),
    [
      defaultWorkingDirectory,
      state?.runtime_by_profile,
      state?.selected_profile_key,
      state?.selected_provider,
    ],
  );
  const profilesSessionsUninitialized = currentProfilesSessionsRequest
    ? !sameSessionRequest(profilesSessionsHydratedRequest, currentProfilesSessionsRequest)
    : false;

  // ---- 初始化 ----
  useEffect(() => {
    let cancelled = false;
    logRendererMilestoneOnce("root_mounted", "React root mounted");
    void checkConfigAndInit(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    document.body.classList.toggle("unlock-route", startupPhase !== "ready");
    return () => {
      document.body.classList.remove("unlock-route");
    };
  }, [startupPhase]);

  useEffect(() => {
    if (startupPhase !== "locked") {
      return;
    }
    return scheduleProfilesPagePreload();
  }, [startupPhase]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => setSystemPrefersDark(media.matches);
    handleChange();
    media.addEventListener?.("change", handleChange);
    return () => {
      media.removeEventListener?.("change", handleChange);
    };
  }, []);

  useEffect(() => {
    if (!state?.global_settings?.theme_mode && document.documentElement.dataset.theme) {
      return;
    }
    const themeMode = normalizeThemeMode(state?.global_settings?.theme_mode);
    const effectiveTheme = resolveEffectiveTheme(themeMode, systemPrefersDark);
    document.documentElement.dataset.theme = effectiveTheme;
    document.documentElement.dataset.themeMode = themeMode;
  }, [state?.global_settings?.theme_mode, systemPrefersDark]);

  useEffect(() => {
    if (activeProvider !== PROVIDER_CODEX) {
      return;
    }
    setProfilesLaunchMonitorModeEnabled(
      (state?.parameter_settings?.cli_settings?.codex?.terminal_mode ?? "monitored") !== "direct",
    );
  }, [activeProvider, state?.parameter_settings?.cli_settings?.codex?.terminal_mode]);

  useEffect(() => {
    if (startupPhase !== "ready") {
      return;
    }
    logRendererMilestoneOnce("main_content_committed", "Main content committed", {
      activeTab,
      profileCount: profiles.length,
    });
  }, [activeTab, profiles.length, startupPhase]);

  // 监听 profile state 变更事件
  useEffect(() => {
    if (!window.profileManager) return;
    const unsub = window.profileManager.onStateChanged((newState) => {
      setState(newState as LocalState);
    });
    return unsub;
  }, [isUnlocked]);

  useEffect(() => {
    if (!window.profileManager) return;
    return window.profileManager.onUnlockError((message) => {
      setUnlockError(message);
      setIsBusy(false);
      setStartupPhase((current) => current === "unlocking" ? "locked" : current);
    });
  }, []);

  async function checkConfigAndInit(isCancelled?: () => boolean) {
    logRendererMilestoneOnce("startup_check_start", "checkConfigAndInit started");
    if (!window.profileManager) {
      if (!isCancelled?.()) {
        setUnlockError("当前环境未注入 Profile API，请通过 Electron 运行。");
        setStartupPhase("locked");
      }
      return;
    }

    try {
      const result = await resolveStartupCheckResult();
      if (isCancelled?.()) {
        return;
      }
      setHasEncryptedConfig(result.hasEncryptedConfig);
      setStartupPhase("locked");
      logRendererMilestoneOnce("startup_check_complete", "checkConfigAndInit completed", {
        hasEncryptedConfig: result.hasEncryptedConfig,
      });
    } catch (err) {
      if (isCancelled?.()) {
        return;
      }
      setUnlockError(err instanceof Error ? err.message : "初始化失败");
      setStartupPhase("locked");
    }
  }

  async function handleUnlock() {
    if (!window.profileManager) return;
    if (!passphrase) return;
    setIsBusy(true);
    setUnlockError(null);
    setStartupPhase("unlocking");
    logRendererEvent("unlock_submit", "Unlock submitted", {
      passphraseLength: passphrase.length,
      hasEncryptedConfig,
    });
    try {
      const unlockResult = await window.profileManager.unlock(passphrase);
      logRendererMilestoneOnce("bootstrap_start", "Bootstrap hydration started");
      const data = unlockResult.bootstrap
        ? applyBootstrapResult(unlockResult.bootstrap)
        : await loadBootstrapData();
      setInitialPreviewDeferred(true);
      markProfilesSessionsHydrated(null);
      clearProfilesSessionsState();
      syncEditorFromData(data);
      setIsUnlocked(true);
      setStartupPhase("ready");
      setPassphrase("");
      logRendererMilestoneOnce("bootstrap_ready", "Bootstrap hydration ready", {
        profileCount: data.profiles.length,
      });
      logRendererMilestoneOnce("unlock_success", "Unlock succeeded", {
        hasEncryptedConfig,
        profileCount: data.profiles.length,
      });
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "解锁失败");
      setStartupPhase("locked");
    } finally {
      setIsBusy(false);
    }
  }

  function markProfilesSessionsHydrated(provider: string | null, request: ListSessionsRequest | null = null) {
    profilesSessionsHydratedProviderRef.current = provider;
    profilesSessionsHydratedRequestRef.current = request;
    setProfilesSessionsHydratedRequest(request);
  }

  function normalizeListProfilesResult(result: {
    profiles: Profile[];
    state: LocalState;
    siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
    defaultWorkingDirectory?: string;
  }): HydratedProfilesResult {
    return {
      ...result,
      defaultWorkingDirectory: result.defaultWorkingDirectory ?? "",
    };
  }

  function normalizeBootstrapResult(result: BootstrapResult): HydratedProfilesResult {
    return {
      ...result,
      state: mergeBootstrapState(result.state),
      defaultWorkingDirectory: result.defaultWorkingDirectory ?? "",
    };
  }

  function applyHydratedProfilesResult(
    data: HydratedProfilesResult,
    options: { parameterSettingsHydrated: boolean },
  ): HydratedProfilesResult {
    setProfiles(data.profiles);
    setState(data.state);
    setSiteBalanceSessionsByBaseUrl(data.siteBalanceSessionsByBaseUrl);
    setDefaultWorkingDirectory(data.defaultWorkingDirectory);
    setHasHydratedParameterSettings(options.parameterSettingsHydrated);
    return data;
  }

  function applyBootstrapResult(result: BootstrapResult): HydratedProfilesResult {
    return applyHydratedProfilesResult(
      normalizeBootstrapResult(result),
      { parameterSettingsHydrated: false },
    );
  }

  async function loadBootstrapData(): Promise<HydratedProfilesResult> {
    if (!window.profileManager) {
      throw new Error("Profile API 不可用");
    }
    const result = await window.profileManager.bootstrap();
    return applyBootstrapResult(result);
  }

  async function loadData(): Promise<HydratedProfilesResult> {
    if (!window.profileManager) {
      throw new Error("Profile API 不可用");
    }
    const result = await window.profileManager.listProfiles();
    return applyHydratedProfilesResult(
      normalizeListProfilesResult(result as {
        profiles: Profile[];
        state: LocalState;
        siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
        defaultWorkingDirectory?: string;
      }),
      { parameterSettingsHydrated: true },
    );
  }

  async function refreshAll(syncEditor = false) {
    const data = await loadData();
    if (data && syncEditor) {
      syncEditorFromData(data);
    }
    return data;
  }

  function currentDraftSnapshot(): ProfileEditorDraft {
    return {
      name: draftName,
      url: draftUrl,
      key: draftKey,
      selectedModelId: draftModel,
      advancedModelMapping: draftAdvancedModelMapping,
      permissions: draftPermissions,
      balanceSessionSelection: draftBalanceSessionSelection,
      balanceSessionDraft: { ...draftBalanceSession },
      cwd: draftCwd,
      command_base: draftCommandBase,
      settings_file: draftSettingsFile,
      launch_mode: "new" as const,
      extra_env: { ...draftExtraEnv },
      extra_args: draftArgs,
      exclude_user_settings: draftExcludeUser,
    };
  }

  function applyDraftSnapshot(draft: ProfileEditorDraft) {
    setDraftName(draft.name);
    setDraftUrl(draft.url);
    setDraftKey(draft.key);
    setDraftModel(draft.selectedModelId);
    setDraftAdvancedModelMapping(draft.advancedModelMapping);
    setDraftPermissions(draft.permissions);
    setDraftBalanceSessionSelection(draft.balanceSessionSelection);
    setDraftBalanceSession({ ...draft.balanceSessionDraft });
    setDraftCwd(draft.cwd);
    setDraftCommandBase(draft.command_base);
    setDraftSettingsFile(draft.settings_file);
    setDraftArgs(draft.extra_args);
    setDraftExtraEnv({ ...draft.extra_env });
    setDraftExcludeUser(draft.exclude_user_settings);
  }

  function syncEditorFromData(data: HydratedProfilesResult) {
    const selectedKey = data.state.selected_profile_key;
    const selectedProfile = data.profiles.find((profile) => itemKey(profile) === selectedKey);
    const selectedSession = selectedProfile?.balance_session_id
      ? getSiteBalanceSessionsForBaseUrl(data.siteBalanceSessionsByBaseUrl, selectedProfile.url)
        .find((session) => session.id === selectedProfile.balance_session_id)
      : undefined;
    const snapshot = withDefaultWorkingDirectory(
      selectedProfile
        ? buildSelectedProfileDraft(
            selectedProfile,
            data.state.runtime_by_profile[selectedKey],
            data.state.selected_provider,
            selectedSession,
          )
        : buildNewProfileDraft(data.state.selected_provider),
      data.defaultWorkingDirectory || defaultWorkingDirectory,
    );

    setEditingKey(selectedProfile ? selectedKey : "");
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  useEffect(() => {
    if (draftBalanceSessionSelection === "new") {
      return;
    }
    if (draftBalanceSessionSelection === "auto") {
      setDraftBalanceSession(emptyBalanceSessionDraft());
      return;
    }

    const matched = draftSiteBalanceSessions.find((session) => session.id === draftBalanceSessionSelection);
    if (!matched) {
      setDraftBalanceSessionSelection("auto");
      setDraftBalanceSession(emptyBalanceSessionDraft());
      return;
    }

    const nextDraft = {
      label: matched.label,
      access_token: matched.access_token,
      user_id: matched.user_id,
    };
    setDraftBalanceSession(nextDraft);
  }, [
    draftBalanceSessionSelection,
    draftSiteBalanceSessions,
  ]);

  async function refreshPreviewForDraft(options: { source?: "initial_deferred" | "interactive" } = {}) {
    const requestSeq = ++previewRequestSeqRef.current;
    if (!window.profileManager || !state) {
      if (requestSeq === previewRequestSeqRef.current) {
        setPreview(emptyPreview());
      }
      return;
    }

    try {
      const draft = currentDraftSnapshot();
      const nextPreview = (await window.profileManager.previewForDraft(
        {
          provider: (state.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex",
          name: draft.name,
          url: draft.url,
          key: draft.key,
          selectedModelId: draft.selectedModelId,
          advancedModelMapping: draft.advancedModelMapping,
          permissions: draft.permissions ?? undefined,
        },
        buildRuntimeSettingsFromDraft(draft),
        undefined,
        undefined,
      )) as CommandPreview;
      if (requestSeq === previewRequestSeqRef.current) {
        setPreview(nextPreview);
        if (options.source === "initial_deferred") {
          logRendererMilestoneOnce("initial_preview_ready", "Initial deferred preview ready", {
            valid: nextPreview.valid,
            cwd: nextPreview.cwd,
          });
        }
      }
    } catch {
      if (requestSeq === previewRequestSeqRef.current) {
        setPreview(emptyPreview());
        if (options.source === "initial_deferred") {
          logRendererMilestoneOnce("initial_preview_ready", "Initial deferred preview ready", {
            valid: false,
            cwd: "",
          });
        }
      }
    } finally {
      if (options.source === "initial_deferred") {
        setInitialPreviewDeferred(false);
      }
    }
  }

  useEffect(() => {
    const draftSnapshot = currentDraftSnapshot();
    const shouldDeferInitialPreview = initialPreviewDeferred
      && editorBaseline
      && !hasProfileDraftChanges(draftSnapshot, editorBaseline);
    if (shouldDeferInitialPreview) {
      return;
    }
    if (initialPreviewDeferred) {
      setInitialPreviewDeferred(false);
    }
    const timeoutId = window.setTimeout(() => {
      void refreshPreviewForDraft({ source: "interactive" });
    }, DRAFT_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    initialPreviewDeferred,
    editorBaseline,
    state?.selected_provider,
    draftName,
    draftUrl,
    draftKey,
    draftModel,
    draftAdvancedModelMapping,
    draftCwd,
    draftCommandBase,
    draftSettingsFile,
    draftArgs,
    draftExcludeUser,
  ]);

  // 初始预览：ready 后立即计算（一次 IPC，实测约 2ms），不再 idle 延迟 600ms。
  // 否则命令预览区会先显示一行空态、随后撑开为完整预览，造成 unlock 后的布局抖动。
  useEffect(() => {
    if (!initialPreviewDeferred || startupPhase !== "ready" || !state || !editorBaseline) {
      return;
    }
    logRendererMilestoneOnce("initial_preview_start", "Initial preview started");
    void refreshPreviewForDraft({ source: "initial_deferred" });
  }, [
    initialPreviewDeferred,
    startupPhase,
    state?.selected_provider,
    state?.selected_profile_key,
    editorBaseline,
  ]);

  async function saveCurrentProfile(options: {
    snapshot?: ProfileEditorDraft;
    showSuccess?: boolean;
    treatEmptyNewBalanceSessionAsAuto?: boolean;
  } = {}): Promise<boolean> {
    if (!window.profileManager) return false;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const rawSnapshot = withDefaultWorkingDirectory(
        options.snapshot ?? currentDraftSnapshot(),
        defaultWorkingDirectory,
      );
      const snapshot = options.treatEmptyNewBalanceSessionAsAuto === false
        ? rawSnapshot
        : normalizeEmptyNewBalanceSessionDraft(rawSnapshot);
      const siteSessions = getSiteBalanceSessionsForBaseUrl(siteBalanceSessionsByBaseUrl, snapshot.url);
      let balanceSessionId: string | undefined;

      if (snapshot.balanceSessionSelection === "new") {
        const created = await window.profileManager.saveSiteBalanceSession(snapshot.url, {
          ...snapshot.balanceSessionDraft,
          label: "",
        });
        balanceSessionId = created.id;
      } else if (snapshot.balanceSessionSelection !== "auto") {
        const existingSession = siteSessions.find((session) => session.id === snapshot.balanceSessionSelection);
        if (!existingSession) {
          throw new Error("所绑定的后台会话已被删除，请重新选择");
        }
        if (
          existingSession.access_token !== snapshot.balanceSessionDraft.access_token
          || existingSession.user_id !== snapshot.balanceSessionDraft.user_id
        ) {
          const updated = await window.profileManager.saveSiteBalanceSession(snapshot.url, {
            id: existingSession.id,
            ...snapshot.balanceSessionDraft,
            label: "",
          });
          balanceSessionId = updated.id;
        } else {
          balanceSessionId = existingSession.id;
        }
      }

      const draft: Profile = {
        provider: (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex",
        name: snapshot.name,
        url: snapshot.url,
        key: snapshot.key,
        selectedModelId: snapshot.selectedModelId,
        advancedModelMapping: snapshot.advancedModelMapping,
        permissions: snapshot.permissions ?? undefined,
        balance_session_id: balanceSessionId,
      };
      await window.profileManager.saveProfile(
        editingKey,
        draft,
        buildRuntimeSettingsFromDraft(snapshot),
      );
      const data = await refreshAll(true);
      if (data && options.showSuccess !== false) {
        setSuccessMessage(`Profile "${draft.name}" 已保存`);
      }
      return true;
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存失败");
      return false;
    } finally {
      setIsBusy(false);
    }
  }

  async function persistCwdOnlyChange(snapshot = currentDraftSnapshot()): Promise<boolean> {
    if (!window.profileManager || !state?.selected_profile_key || !editingKey) {
      return false;
    }
    if (!hasOnlyProfileDraftCwdChange(snapshot, editorBaseline)) {
      return false;
    }
    return saveCurrentProfile({ snapshot, showSuccess: false });
  }

  async function persistCwdOnlyChangeAndRefreshSessions(snapshot = currentDraftSnapshot()): Promise<boolean> {
    const shouldRefreshSessions = activeTab === "profiles"
      && state
      && profilesSessionsHydratedProviderRef.current === state.selected_provider;
    const saved = await persistCwdOnlyChange(snapshot);
    if (
      saved
      && shouldRefreshSessions
      && state
    ) {
      await handleLoadProfilesSessions(state, snapshot.cwd, { source: "followup" });
    }
    return saved;
  }

  async function persistSelectedModelOnlyChange(snapshot = currentDraftSnapshot()): Promise<boolean> {
    if (!window.profileManager || !state?.selected_profile_key || !editingKey) {
      return false;
    }
    if (!hasOnlyProfileDraftSelectedModelIdChange(snapshot, editorBaseline)) {
      return false;
    }
    return saveCurrentProfile({ snapshot, showSuccess: false });
  }

  async function persistBalanceSessionOnlyChange(snapshot = currentDraftSnapshot()): Promise<boolean> {
    if (!window.profileManager || !state?.selected_profile_key || !editingKey) {
      return false;
    }
    if (!hasOnlyProfileDraftBalanceSessionChange(snapshot, editorBaseline)) {
      return false;
    }
    return saveCurrentProfile({ snapshot, showSuccess: false });
  }

  function clearHistoryState() {
    historyRequestSeqRef.current += 1;
    latestHistoryRequestRef.current = null;
    setHistorySessions([]);
    setHistorySelectedSessionId("");
    setHistoryPreview(emptyPreview());
    setHistoryIsLoading(false);
    setHistoryHasMore(false);
    setHistoryPrefetchedSessions([]);
    setHistoryPrefetchedHasMore(false);
    setHistoryIsPrefetching(false);
    latestHistoryPrefetchRequestRef.current = null;
    historyPrefetchedOffsetRef.current = null;
  }

  function clearProfilesSessionsState(options: { loading?: boolean; resetHydration?: boolean } = {}) {
    profilesSessionsRequestSeqRef.current += 1;
    latestProfilesSessionsRequestRef.current = null;
    if (options.resetHydration !== false) {
      markProfilesSessionsHydrated(null);
    }
    setProfilesSessions((current) => (current.length === 0 ? current : []));
    setProfilesSelectedSessionId((current) => (current ? "" : current));
    setProfilesSessionsLoading((current) => {
      const nextLoading = options.loading ?? false;
      return current === nextLoading ? current : nextLoading;
    });
  }

  async function resolveUnsavedProfileChanges(): Promise<boolean> {
    if (!window.profileManager) return false;
    const snapshot = currentDraftSnapshot();
    if (!hasProfileDraftChanges(snapshot, editorBaseline)) {
      return true;
    }
    if (hasOnlyProfileDraftCwdChange(snapshot, editorBaseline)) {
      return persistCwdOnlyChange(snapshot);
    }
    if (hasOnlyProfileDraftSelectedModelIdChange(snapshot, editorBaseline)) {
      return persistSelectedModelOnlyChange(snapshot);
    }
    if (hasOnlyProfileDraftBalanceSessionChange(snapshot, editorBaseline)) {
      return persistBalanceSessionOnlyChange(snapshot);
    }

    const action = await window.profileManager.promptUnsavedProfileAction();
    if (action === "cancel") {
      return false;
    }
    if (action === "discard") {
      return true;
    }
    return saveCurrentProfile();
  }

  // ---- Profile CRUD 操作 ----
  async function handleSaveProfile() {
    await saveCurrentProfile();
  }

  async function handleSaveBalanceSession() {
    const saved = await saveCurrentProfile({
      showSuccess: false,
      treatEmptyNewBalanceSessionAsAuto: false,
    });
    if (saved) {
      setSuccessMessage("后台会话已保存");
    }
  }

  async function handleSelectProfile(key: ProfileKey) {
    if (!window.profileManager || !state) return;
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    if (activeTab === "sessions") {
      clearHistoryState();
    } else if (activeTab === "profiles") {
      clearProfilesSessionsState();
    }
    await window.profileManager.selectProfile(state.selected_provider, key);
    const data = await refreshAll(true);
    if (data && activeTab === "sessions") {
      await handleLoadHistorySessions(data.state);
    }
  }

  async function handleNewProfile() {
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    const snapshot = withDefaultWorkingDirectory(
      buildNewProfileDraft(state?.selected_provider ?? PROVIDER_CLAUDE),
      defaultWorkingDirectory,
    );
    setEditingKey("");
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  function handleCancelProfileEdit() {
    setErrorMessage(null);
    setSuccessMessage(null);
    if (editorBaseline) {
      applyDraftSnapshot(editorBaseline);
      return;
    }
    const snapshot = withDefaultWorkingDirectory(
      buildNewProfileDraft(state?.selected_provider ?? PROVIDER_CLAUDE),
      defaultWorkingDirectory,
    );
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  function clearDraft() {
    applyDraftSnapshot(withDefaultWorkingDirectory(
      buildNewProfileDraft(state?.selected_provider ?? PROVIDER_CLAUDE),
      defaultWorkingDirectory,
    ));
  }

  async function handleCloneProfile() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    const targetProv = state.selected_provider === PROVIDER_CLAUDE ? PROVIDER_CODEX : PROVIDER_CLAUDE;
    setIsBusy(true);
    try {
      await window.profileManager.cloneProfile(state.selected_profile_key, targetProv);
      await refreshAll(true);
      setSuccessMessage("Profile 已克隆");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "克隆失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteProfile() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    if (!confirm("确定要删除此 Profile？")) return;
    setIsBusy(true);
    try {
      await window.profileManager.deleteProfile(state.selected_profile_key);
      clearDraft();
      setEditingKey("");
      await refreshAll(true);
      setSuccessMessage("Profile 已删除");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleDeleteSiteBalanceSession() {
    if (
      !window.profileManager
      || draftBalanceSessionSelection === "auto"
      || draftBalanceSessionSelection === "new"
    ) {
      return;
    }
    if (!confirm("确定要删除当前后台会话？")) {
      return;
    }

    setIsBusy(true);
    try {
      await window.profileManager.deleteSiteBalanceSession(draftUrl, draftBalanceSessionSelection);
      const data = await refreshAll(true);
      if (data) {
        setSuccessMessage("后台会话已删除");
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "删除后台会话失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleProviderSwitch(provider: string) {
    if (!window.profileManager) return;
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    if (activeTab === "sessions") {
      clearHistoryState();
    } else if (activeTab === "profiles") {
      clearProfilesSessionsState();
    }
    await window.profileManager.activateProvider(provider);
    const data = await refreshAll(true);
    if (data && activeTab === "sessions") {
      await handleLoadHistorySessions(data.state);
    }
  }

  async function handleSessionsViewSwitch(view: SessionsViewId) {
    if (view === "favorites") {
      setSessionsView("favorites");
      setHistorySelectedSessionId("");
      setHistoryPreview(emptyPreview());
      return;
    }
    setSessionsView(view);
    await handleProviderSwitch(view);
  }

  async function handleReorder(orderedKeys: ProfileKey[]) {
    if (!window.profileManager || !state) return;
    await window.profileManager.reorderProfiles(state.selected_provider, orderedKeys);
  }

  // ---- 启动操作 ----
  async function handleLaunch(
    mode: LaunchMode,
    sessionId?: string,
    permissionOverride?: PermissionPreset,
    sessionSource?: LaunchSessionSource,
  ) {
    if (!window.profileManager || !state || !state.selected_profile_key) return;
    if (mode === "resume_selected" && !sessionId) {
      setErrorMessage("请先选择会话");
      return;
    }
    let launchState = state;
    const snapshot = currentDraftSnapshot();
    if (hasProfileDraftChanges(snapshot, editorBaseline)) {
      if (hasOnlyProfileDraftCwdChange(snapshot, editorBaseline)) {
        const saved = await persistCwdOnlyChange(snapshot);
        if (!saved) {
          return;
        }
        const latest = await loadData();
        launchState = latest.state;
      } else if (hasOnlyProfileDraftSelectedModelIdChange(snapshot, editorBaseline)) {
        const saved = await persistSelectedModelOnlyChange(snapshot);
        if (!saved) {
          return;
        }
        const latest = await loadData();
        launchState = latest.state;
      } else {
        const action = await window.profileManager.promptLaunchWithUnsavedChanges();
        if (action === "cancel") {
          return;
        }
        if (action === "save_and_launch") {
          const saved = await saveCurrentProfile();
          if (!saved) {
            return;
          }
          const latest = await loadData();
          launchState = latest.state;
        } else if (editorBaseline) {
          applyDraftSnapshot(editorBaseline);
        }
      }
    }
    const runtime = launchState.runtime_by_profile[launchState.selected_profile_key]
      ?? defaultRuntimeSettings(launchState.selected_provider);
    const launchRuntime = {
      ...runtime,
      cwd: runtime.cwd.trim() || defaultWorkingDirectory,
    };

    const requestedTerminalMode = launchState.selected_provider === PROVIDER_CODEX
      ? profilesLaunchMonitorModeEnabled ? "monitored" : "direct"
      : undefined;
    const request: LaunchRequest = {
      profile_key: launchState.selected_profile_key,
      provider: launchState.selected_provider,
      runtime_settings: { ...launchRuntime, launch_mode: mode },
      terminal_mode: requestedTerminalMode,
      session_id: sessionId,
      session_source: sessionSource,
      permission_override: permissionOverride,
    };

    try {
      const launchResult = await window.profileManager.launch(request);
      const prefersMonitoredCodex = launchState.selected_provider === PROVIDER_CODEX
        && requestedTerminalMode === "monitored";
      if (launchResult?.monitoringActive) {
        setSuccessMessage("已打开受监控终端窗口。");
      } else if (prefersMonitoredCodex && launchResult?.terminalMode === "direct") {
        setSuccessMessage("监控终端不可用，已回退到系统直连启动。");
      }
      if (profilesSessionsHydratedProviderRef.current === launchState.selected_provider) {
        await handleLoadProfilesSessions(launchState, launchRuntime.cwd, { source: "followup" });
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "启动失败");
    }
  }

  async function handleTestBalance() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    const latest = await loadData();
    const key = latest.state.selected_profile_key;
    if (!key) {
      return;
    }
    setBalanceKey(key);
    try {
      await window.profileManager.testBalance(key);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "余额检测失败");
    }
  }

  async function handleClearBalanceState() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    const key = state.selected_profile_key;
    try {
      await window.profileManager.clearBalanceState?.(key);
      setBalanceState(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "清除余额检测结果失败");
    }
  }

  useEffect(() => {
    const selectedKey = state?.selected_profile_key ?? "";
    setBalanceKey(selectedKey);
    setBalanceState(getBalanceStateForProfile(state?.balance_checks_by_profile, selectedKey));
  }, [state?.selected_profile_key, state?.balance_checks_by_profile]);

  useEffect(() => {
    if (!window.profileManager) return;
    const unsub = window.profileManager.onBalanceProgress((key, st) => {
      if (key === balanceKey) {
        setBalanceState(st as BalanceCheckState);
      }
    });
    return unsub;
  }, [balanceKey]);

  // ---- 会话 ----
  function buildProfilesSessionsRequest(
    nextState: LocalState | null = state,
    cwdOverride?: string,
    options: { preferDraftCwd?: boolean } = {},
  ): ListSessionsRequest | null {
    if (!nextState?.selected_profile_key) {
      return null;
    }
    const runtime = nextState.runtime_by_profile[nextState.selected_profile_key];
    const preferredDraftCwd = options.preferDraftCwd === false ? "" : draftCwd.trim();
    const cwd = cwdOverride ?? (preferredDraftCwd || runtime?.cwd.trim() || defaultWorkingDirectory);
    if (!cwd.trim()) {
      return null;
    }
    return {
      provider: nextState.selected_provider,
      scope: "project",
      cwd,
      profile_key: nextState.selected_profile_key,
      limit: HISTORY_PAGE_SIZE,
      offset: 0,
    };
  }

  async function handleLoadProfilesSessions(
    nextState: LocalState | null = state,
    cwdOverride?: string,
    options: { source?: "manual" | "auto" | "followup" } = {},
  ) {
    if (!window.profileManager) {
      clearProfilesSessionsState();
      return;
    }
    const request = buildProfilesSessionsRequest(nextState, cwdOverride);
    if (!request) {
      clearProfilesSessionsState();
      return;
    }

    const shouldKeepExisting = sameSessionRequest(profilesSessionsHydratedRequestRef.current, request);
    if (options.source === "manual" || options.source === "auto" || !shouldKeepExisting) {
      markProfilesSessionsHydrated(request.provider, request);
    }
    if (options.source === "manual") {
      logRendererMilestoneOnce("profiles_sessions_manual_load_start", "Profiles sessions manual load started", {
        cwd: request.cwd,
      });
    }
    const requestSeq = ++profilesSessionsRequestSeqRef.current;
    latestProfilesSessionsRequestRef.current = request;
    if (!shouldKeepExisting) {
      setProfilesSessions([]);
      setProfilesSelectedSessionId("");
    }
    setProfilesSessionsLoading(true);

    try {
      const result = await window.profileManager.listSessions(request);
      if (
        requestSeq !== profilesSessionsRequestSeqRef.current
        || !sameSessionRequest(latestProfilesSessionsRequestRef.current, request)
      ) {
        return;
      }
      const nextSessions = result as SessionSummary[];
      setProfilesSessions(nextSessions);
      setProfilesSelectedSessionId((current) => (
        current && !nextSessions.some((session) => session.session_id === current) ? "" : current
      ));
      setProfilesSessionsLoading(false);
      if (options.source === "manual") {
        logRendererMilestoneOnce("profiles_sessions_manual_load_ready", "Profiles sessions manual load ready", {
          count: nextSessions.length,
          cwd: request.cwd,
        });
      }
    } catch (err) {
      if (
        requestSeq !== profilesSessionsRequestSeqRef.current
        || !sameSessionRequest(latestProfilesSessionsRequestRef.current, request)
      ) {
        return;
      }
      if (!shouldKeepExisting) {
        setProfilesSessions([]);
        setProfilesSelectedSessionId("");
      }
      setProfilesSessionsLoading(false);
      setErrorMessage(err instanceof Error ? err.message : "加载会话失败");
    }
  }

  function buildHistorySessionsRequest(nextState: LocalState, offset: number): ListSessionsRequest {
    return {
      provider: nextState.selected_provider,
      scope: "global_recent",
      profile_key: nextState.selected_profile_key,
      limit: HISTORY_PAGE_SIZE,
      offset,
    };
  }

  function clearHistoryPrefetchState() {
    setHistoryPrefetchedSessions([]);
    setHistoryPrefetchedHasMore(false);
    setHistoryIsPrefetching(false);
    latestHistoryPrefetchRequestRef.current = null;
    historyPrefetchedOffsetRef.current = null;
  }

  async function prefetchHistorySessions(nextState: LocalState | null = state, offset = historySessions.length) {
    if (!window.profileManager || !nextState || offset <= 0) {
      return;
    }
    if (historyPrefetchedOffsetRef.current === offset) {
      return;
    }

    const request = buildHistorySessionsRequest(nextState, offset);
    if (historyIsPrefetching && sameSessionRequest(latestHistoryPrefetchRequestRef.current, request)) {
      return;
    }
    latestHistoryPrefetchRequestRef.current = request;
    setHistoryIsPrefetching(true);

    try {
      const result = await window.profileManager.listSessions(request);
      if (!sameSessionRequest(latestHistoryPrefetchRequestRef.current, request)) {
        return;
      }
      const nextSessions = (result as SessionSummary[]).filter((session) => session.provider === request.provider);
      setHistoryPrefetchedSessions(nextSessions);
      setHistoryPrefetchedHasMore(nextSessions.length >= HISTORY_PAGE_SIZE);
      setHistoryHasMore(nextSessions.length > 0);
      setHistoryIsPrefetching(false);
      historyPrefetchedOffsetRef.current = offset;
    } catch {
      if (!sameSessionRequest(latestHistoryPrefetchRequestRef.current, request)) {
        return;
      }
      setHistoryPrefetchedSessions([]);
      setHistoryPrefetchedHasMore(false);
      setHistoryIsPrefetching(false);
      historyPrefetchedOffsetRef.current = null;
    }
  }

  async function handleLoadHistorySessions(
    nextState: LocalState | null = state,
    options: { append?: boolean; refresh?: boolean } = {},
  ) {
    if (!window.profileManager || !nextState) {
      setHistorySessions([]);
      setHistorySelectedSessionId("");
      setHistoryIsLoading(false);
      setHistoryHasMore(false);
      return;
    }

    const provider = nextState.selected_provider;
    const previousSessions = options.append ? historySessions : [];
    const request = buildHistorySessionsRequest(nextState, previousSessions.length);
    const requestSeq = ++historyRequestSeqRef.current;
    latestHistoryRequestRef.current = request;
    if (!options.append) {
      clearHistoryPrefetchState();
    }
    setHistoryIsLoading(true);

    try {
      if (options.refresh) {
        await window.profileManager.refreshSessions(provider);
      }
      const result = await window.profileManager.listSessions(request);
      if (requestSeq !== historyRequestSeqRef.current || !sameSessionRequest(latestHistoryRequestRef.current, request)) {
        return;
      }
      const nextSessions = (result as SessionSummary[]).filter((session) => session.provider === provider);
      const combinedSessions = [...previousSessions, ...nextSessions];
      setHistorySessions(combinedSessions);
      setHistoryHasMore(nextSessions.length >= HISTORY_PAGE_SIZE);
      setHistorySelectedSessionId((current) => (
        current && !combinedSessions.some((session) => getSessionFavoriteKey(session) === current) ? "" : current
      ));
      setHistoryIsLoading(false);
      if (nextSessions.length >= HISTORY_PAGE_SIZE) {
        void prefetchHistorySessions(nextState, combinedSessions.length);
      }
    } catch (err) {
      if (requestSeq !== historyRequestSeqRef.current || !sameSessionRequest(latestHistoryRequestRef.current, request)) {
        return;
      }
      setHistorySessions([]);
      setHistorySelectedSessionId("");
      setHistoryPreview(emptyPreview());
      setHistoryIsLoading(false);
      setHistoryHasMore(false);
      clearHistoryPrefetchState();
      setErrorMessage(err instanceof Error ? err.message : "加载会话失败");
    }
  }

  async function handleLoadMoreHistorySessions(nextState: LocalState | null = state) {
    if (!nextState) {
      return;
    }
    if (historyPrefetchedSessions.length > 0) {
      const combinedSessions = [...historySessions, ...historyPrefetchedSessions];
      setHistorySessions(combinedSessions);
      setHistoryHasMore(historyPrefetchedHasMore);
      setHistoryPrefetchedSessions([]);
      setHistoryPrefetchedHasMore(false);
      historyPrefetchedOffsetRef.current = null;
      latestHistoryPrefetchRequestRef.current = null;
      if (historyPrefetchedHasMore) {
        void prefetchHistorySessions(nextState, combinedSessions.length);
      }
      return;
    }
    await handleLoadHistorySessions(nextState, { append: true });
  }

  async function handleHistoryRestoreProfileChange(profileKey: ProfileKey) {
    if (!window.profileManager) {
      return;
    }
    await window.profileManager.updateSessionsTabState(historyRestoreProvider, {
      restore_profile_key: profileKey,
    });
  }

  async function refreshHistoryPreview() {
    if (!window.profileManager || !state || !selectedHistorySession || !historyRestoreProfileKey) {
      setHistoryPreview(emptyPreview());
      return;
    }

    const selectedProfile = profiles.find((profile) => itemKey(profile) === historyRestoreProfileKey);
    if (!selectedProfile) {
      setHistoryPreview(emptyPreview());
      return;
    }

    try {
      const runtime = state.runtime_by_profile[historyRestoreProfileKey]
        ?? defaultRuntimeSettings(selectedProfile.provider);
      const previewRuntime = {
        ...runtime,
        cwd: runtime.cwd.trim() || defaultWorkingDirectory,
      };
      const nextPreview = (await window.profileManager.previewForDraft(
        selectedProfile,
        {
          ...previewRuntime,
          launch_mode: "resume_selected",
        },
        undefined,
        selectedHistorySession.session_id,
      )) as CommandPreview;
      setHistoryPreview(nextPreview);
    } catch {
      setHistoryPreview(emptyPreview());
    }
  }

  async function handleHistoryRestoreLaunch() {
    if (!window.profileManager || !state || !selectedHistorySession) {
      return;
    }
    if (!historyRestoreProfileKey) {
      setErrorMessage("请先为该 Provider 选择用于恢复的 Profile。");
      return;
    }

    const selectedProfile = profiles.find((profile) => itemKey(profile) === historyRestoreProfileKey);
    if (!selectedProfile || selectedProfile.provider !== selectedHistorySession.provider) {
      setErrorMessage("恢复 Profile 与所选会话的 provider 不匹配。");
      return;
    }

    const runtime = state.runtime_by_profile[historyRestoreProfileKey]
      ?? defaultRuntimeSettings(selectedProfile.provider);
    const launchRuntime = {
      ...runtime,
      cwd: runtime.cwd.trim() || defaultWorkingDirectory,
    };
    if (!launchRuntime.cwd.trim()) {
      setErrorMessage("所选 Profile 当前未设置工作目录，请先设置后再恢复。");
      return;
    }

    const request = {
      profile_key: historyRestoreProfileKey,
      provider: selectedHistorySession.provider,
      runtime_settings: {
        ...launchRuntime,
        launch_mode: "resume_selected" as const,
      },
      session_id: selectedHistorySession.session_id,
      session_source: sessionSourceFromSummary(selectedHistorySession),
    };

    try {
      await window.profileManager.launch(request);
      await handleLoadHistorySessions(state);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "恢复会话失败");
    }
  }

  useEffect(() => {
    if (activeTab !== "profiles") {
      return;
    }
    if (!state?.selected_profile_key || !currentProfilesSessionsRequest) {
      if (profilesSessions.length > 0 || profilesSelectedSessionId || profilesSessionsLoading) {
        clearProfilesSessionsState();
      }
      return;
    }
    const loadSource = sameSessionRequest(profilesSessionsHydratedRequestRef.current, currentProfilesSessionsRequest)
      ? "followup"
      : "auto";
    if (loadSource === "auto" && (profilesSessions.length > 0 || profilesSelectedSessionId || !profilesSessionsLoading)) {
      clearProfilesSessionsState({ loading: true });
    }

    const run = () => void handleLoadProfilesSessions(state, currentProfilesSessionsRequest.cwd, { source: loadSource });
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(run, { timeout: 1500 });
      return () => window.cancelIdleCallback(id);
    }

    const id = window.setTimeout(run, 800);
    return () => window.clearTimeout(id);
  }, [
    activeTab,
    currentProfilesSessionsRequest?.cwd,
    currentProfilesSessionsRequest?.profile_key,
    currentProfilesSessionsRequest?.provider,
  ]);

  useEffect(() => {
    if (activeTab === "sessions" && sessionsView !== "favorites") {
      void handleLoadHistorySessions();
    }
  }, [
    activeTab,
    sessionsView,
    state?.selected_provider,
    state?.selected_profile_key,
  ]);

  useEffect(() => {
    if (activeTab === "sessions") {
      void refreshHistoryPreview();
    }
  }, [
    activeTab,
    state?.selected_provider,
    sessionsView,
    historySelectedSessionId,
    historyRestoreProfileKey,
    historySessions,
    state?.session_favorites,
    defaultWorkingDirectory,
  ]);

  useEffect(() => {
    if (activeTab === "settings" && !hasHydratedParameterSettings && !isHydratingParameterSettings) {
      void hydrateParameterSettings();
    }
  }, [activeTab, hasHydratedParameterSettings, isHydratingParameterSettings]);

  async function hydrateParameterSettings() {
    if (!window.profileManager || !state || hasHydratedParameterSettings || isHydratingParameterSettings) {
      return;
    }
    setIsHydratingParameterSettings(true);
    try {
      const parameterSettings = await window.profileManager.getParameterSettings();
      setState((current) => current ? {
        ...current,
        parameter_settings: parameterSettings,
      } : current);
      setHasHydratedParameterSettings(true);
    } catch (err) {
      setHasHydratedParameterSettings(true);
      setErrorMessage(err instanceof Error ? err.message : "加载参数设置失败");
    } finally {
      setIsHydratingParameterSettings(false);
    }
  }

  async function handlePickWorkingDirectory() {
    if (!window.profileManager) return;
    try {
      const picked = await window.profileManager.pickWorkingDirectory();
      if (picked !== undefined) {
        const snapshot = { ...currentDraftSnapshot(), cwd: picked };
        setDraftCwd(picked);
        await persistCwdOnlyChangeAndRefreshSessions(snapshot);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "选择工作目录失败");
    }
  }

  async function saveWorkingDirectoryFavorites(favorites: string[]) {
    if (!window.profileManager?.updateWorkingDirectoryFavorites) return;
    const normalizedFavorites = normalizeWorkingDirectoryFavorites(favorites);
    try {
      const savedFavorites = await window.profileManager.updateWorkingDirectoryFavorites(normalizedFavorites);
      setState((current) => current
        ? { ...current, working_directory_favorites: savedFavorites }
        : current);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存工作目录收藏失败");
    }
  }

  async function handleToggleWorkingDirectoryFavorite() {
    const cwd = draftCwd.trim();
    if (!cwd) return;

    const favorites = state?.working_directory_favorites ?? [];
    const nextFavorites = favorites.includes(cwd)
      ? favorites.filter((favorite) => favorite !== cwd)
      : [cwd, ...favorites.filter((favorite) => favorite !== cwd)];
    await saveWorkingDirectoryFavorites(nextFavorites);
  }

  async function handleSelectWorkingDirectoryFavorite(path: string) {
    const cwd = path.trim();
    if (!cwd) return;

    const snapshot = { ...currentDraftSnapshot(), cwd };
    setDraftCwd(cwd);
    await persistCwdOnlyChangeAndRefreshSessions(snapshot);
  }

  function favoriteFromSession(session: SessionSummary): FavoriteSessionSummary | null {
    return normalizeSessionFavorites([{
      ...session,
      favorite_key: getSessionFavoriteKey(session),
      favorited_at: new Date().toISOString(),
    }])[0] ?? null;
  }

  async function saveSessionFavorites(favorites: FavoriteSessionSummary[]) {
    if (!window.profileManager?.updateSessionFavorites) return;
    const normalizedFavorites = normalizeSessionFavorites(favorites);
    try {
      const savedFavorites = await window.profileManager.updateSessionFavorites(normalizedFavorites);
      setState((current) => current
        ? { ...current, session_favorites: savedFavorites }
        : current);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存会话收藏失败");
    }
  }

  async function handleToggleSessionFavorite(session: SessionSummary) {
    const favoriteKey = getSessionFavoriteKey(session);
    const favorites = state?.session_favorites ?? [];
    const isFavorite = favorites.some((favorite) => favorite.favorite_key === favoriteKey);
    if (isFavorite) {
      const nextFavorites = favorites.filter((favorite) => favorite.favorite_key !== favoriteKey);
      if (sessionsView === "favorites" && historySelectedSessionId === favoriteKey) {
        setHistorySelectedSessionId("");
        setHistoryPreview(emptyPreview());
      }
      await saveSessionFavorites(nextFavorites);
      return;
    }

    const favorite = favoriteFromSession(session);
    if (!favorite) {
      setErrorMessage("无法收藏该会话，缺少会话标识。");
      return;
    }
    await saveSessionFavorites([favorite, ...favorites]);
  }

  async function handleOpenBaseUrl() {
    if (!window.profileManager) return;
    try {
      await window.profileManager.openBaseUrl(draftUrl);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "打开 Base URL 失败");
    }
  }

  async function handleRuntimeCommit(field: string) {
    if (field === "cwd") {
      await persistCwdOnlyChangeAndRefreshSessions();
    }
  }

  async function handleDraftCommit(field: string, value?: string | boolean) {
    if (field === "selectedModelId") {
      const snapshot = typeof value === "string"
        ? { ...currentDraftSnapshot(), selectedModelId: value }
        : currentDraftSnapshot();
      await persistSelectedModelOnlyChange(snapshot);
    }
  }

  // ---- 全局设置 ----
  async function handleGlobalSettingsChange(settings: Partial<GlobalSettings>) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.updateGlobalSettings(settings);
      await refreshAll(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存设置失败");
    }
  }

  async function handleChangePassphrase(currentPassword: string, nextPassword: string) {
    if (!window.profileManager) return;
    const current = currentPassword.trim();
    const next = nextPassword.trim();
    if (!current) {
      setErrorMessage("当前密码不能为空");
      return;
    }
    if (!next) {
      setErrorMessage("新密码不能为空");
      return;
    }
    if (current === next) {
      setErrorMessage("新密码不能与当前密码相同");
      return;
    }
    setIsBusy(true);
    setErrorMessage(null);
    try {
      await window.profileManager.changePassphrase(current, next);
      setSuccessMessage("配置密码已修改");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "修改密码失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFetchSiteModels() {
    if (!window.profileManager || !state) return;
    const cacheKey = normalizeBalanceBaseUrl(draftUrl);
    setModelCatalogFetchByBaseUrl((current) => ({
      ...current,
      [cacheKey]: { busy: true, error: null },
    }));
    try {
      const result = await window.profileManager.fetchSiteModels({
        url: draftUrl,
        key: draftKey,
      });
      setModelCatalogByBaseUrl((current) => ({
        ...current,
        [cacheKey]: {
          models: result.models,
          fetchedAt: new Date().toLocaleString(),
        },
      }));
      setModelCatalogFetchByBaseUrl((current) => ({
        ...current,
        [cacheKey]: { busy: false, error: null },
      }));
    } catch (err) {
      setModelCatalogFetchByBaseUrl((current) => ({
        ...current,
        [cacheKey]: {
          busy: false,
          error: err instanceof Error ? err.message : "获取远端模型失败",
        },
      }));
    }
  }

  // ---- 参数设置 ----
  async function handleParameterSettingsChange(settings: Partial<ParameterSettings>) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.updateParameterSettings(settings);
      await refreshAll(false);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存参数失败");
    }
  }

  // ---- 计算属性 ----

  const orderedKeys = useMemo(() => {
    if (!state) return [];
    return state.profile_order_by_provider[state.selected_provider] ?? [];
  }, [state?.selected_provider, state?.profile_order_by_provider]);

  const balanceEntries = useMemo(() => {
    const result: Record<ProfileKey, ReturnType<typeof buildBalanceListEntry>> = {};
    if (!state?.balance_checks_by_profile) return result;
    for (const [key, balance] of Object.entries(state.balance_checks_by_profile)) {
      result[key] = buildBalanceListEntry(balance);
    }
    return result;
  }, [state?.balance_checks_by_profile]);

  const selectedProvider = (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex";
  const workingDirectoryFavorites = state?.working_directory_favorites ?? [];
  const profileDraft = useMemo(() => ({
    name: draftName,
    url: draftUrl,
    key: draftKey,
    selectedModelId: draftModel,
    advancedModelMapping: draftAdvancedModelMapping,
    permissions: draftPermissions,
  }), [
    draftAdvancedModelMapping,
    draftKey,
    draftModel,
    draftName,
    draftPermissions,
    draftUrl,
  ]);
  const profileRuntime = useMemo(() => ({
    cwd: draftCwd,
    command_base: draftCommandBase,
    settings_file: draftSettingsFile,
    extra_env: draftExtraEnv,
    extra_args: draftArgs,
    launch_mode: "new" as const,
    exclude_user_settings: draftExcludeUser,
  }), [
    draftArgs,
    draftCommandBase,
    draftCwd,
    draftExtraEnv,
    draftExcludeUser,
    draftSettingsFile,
  ]);
  const globalPermissions = useMemo(
    () => normalizeProfilePermissions(
      state?.global_settings.permissions ?? defaultProfilePermissions(selectedProvider),
      selectedProvider,
    ),
    [selectedProvider, state?.global_settings.permissions],
  );
  const modelCatalogCacheKey = normalizeBalanceBaseUrl(draftUrl);
  const modelCatalogCacheEntry = modelCatalogCacheKey
    ? modelCatalogByBaseUrl[modelCatalogCacheKey]
    : undefined;
  const modelCatalogFetchState = modelCatalogFetchByBaseUrl[modelCatalogCacheKey];
  const modelOptions = modelCatalogCacheEntry?.models ?? EMPTY_MODEL_OPTIONS;
  const modelFetchedAt = modelCatalogCacheEntry?.fetchedAt;
  const modelFetchBusy = modelCatalogFetchState?.busy ?? false;
  const modelFetchError = modelCatalogFetchState?.error ?? null;
  const modelFetchSuccess = modelCatalogCacheEntry
    ? `已获取${modelCatalogCacheEntry.models.length}个模型`
    : null;
  const handleProfileDraftChange = useCallback((field: string, val: string | boolean) => {
    switch (field) {
      case "name": setDraftName(val as string); break;
      case "url": {
        const nextUrl = val as string;
        setDraftUrl(nextUrl);
        setDraftAdvancedModelMapping((current) => applyClaudeAliasRecommendationForNewDraft({
          provider: selectedProvider,
          editingKey,
          current,
          url: nextUrl,
          selectedModelId: draftModel,
        }));
        break;
      }
      case "key": setDraftKey(val as string); break;
      case "selectedModelId": {
        const nextModel = val as string;
        setDraftModel(nextModel);
        setDraftAdvancedModelMapping((current) => applyClaudeAliasRecommendationForNewDraft({
          provider: selectedProvider,
          editingKey,
          current,
          url: draftUrl,
          selectedModelId: nextModel,
        }));
        break;
      }
    }
  }, [draftModel, draftUrl, editingKey, selectedProvider]);
  const handleBalanceSessionSelectionChange = useCallback((value: string) => {
    setDraftBalanceSessionSelection(value);
    if (value === "auto" || value === "new") {
      setDraftBalanceSession(emptyBalanceSessionDraft());
      return;
    }
    const matched = draftSiteBalanceSessions.find((session) => session.id === value);
    setDraftBalanceSession(matched ? {
      label: matched.label,
      access_token: matched.access_token,
      user_id: matched.user_id,
    } : emptyBalanceSessionDraft());
  }, [draftSiteBalanceSessions]);
  const handleBalanceSessionDraftChange = useCallback((field: "label" | "access_token" | "user_id", value: string) => {
    setDraftBalanceSession((current) => ({
      ...current,
      [field]: value,
    }));
  }, []);
  const handleProfileRuntimeChange = useCallback((field: string, val: string | boolean | Record<string, string>) => {
    switch (field) {
      case "cwd": setDraftCwd(val as string); break;
      case "command_base": setDraftCommandBase(val as string); break;
      case "settings_file": setDraftSettingsFile(val as string); break;
      case "extra_args": setDraftArgs(val as string); break;
      case "extra_env": setDraftExtraEnv(val as Record<string, string>); break;
      case "exclude_user_settings": setDraftExcludeUser(val as boolean); break;
    }
  }, []);

  const resetEmptyNewBalanceSessionDraft = useCallback(() => {
    if (!isEmptyNewBalanceSessionDraft(draftBalanceSessionSelection, draftBalanceSession)) {
      return;
    }
    setDraftBalanceSessionSelection("auto");
    setDraftBalanceSession(emptyBalanceSessionDraft());
    setErrorMessage(null);
  }, [draftBalanceSession, draftBalanceSessionSelection]);

  const stableSetActiveProfilesTab = useCallback(() => setActiveTab("profiles"), []);
  const stableSetActiveSkillsTab = useCallback(() => {
    resetEmptyNewBalanceSessionDraft();
    setActiveTab("skills");
  }, [resetEmptyNewBalanceSessionDraft]);
  const stableSetActiveSettingsTab = useCallback(() => {
    resetEmptyNewBalanceSessionDraft();
    setActiveTab("settings");
  }, [resetEmptyNewBalanceSessionDraft]);
  const stableSetGlobalSettingsSubTab = useCallback(() => setSettingsSubTab("global"), []);
  const stableSetParameterSettingsSubTab = useCallback(() => setSettingsSubTab("parameters"), []);
  const stableClearErrorMessage = useCallback(() => setErrorMessage(null), []);
  const stableClearSuccessMessage = useCallback(() => setSuccessMessage(null), []);
  const stableHandleProviderSwitch = useEventCallback(handleProviderSwitch);
  const stableHandleSessionsViewSwitch = useEventCallback(handleSessionsViewSwitch);
  const stableHandleSelectProfile = useEventCallback(handleSelectProfile);
  const stableHandleReorder = useEventCallback(handleReorder);
  const stableHandleNewProfile = useEventCallback(handleNewProfile);
  const stableHandleCancelProfileEdit = useEventCallback(handleCancelProfileEdit);
  const stableHandleCloneProfile = useEventCallback(handleCloneProfile);
  const stableHandleDeleteProfile = useEventCallback(handleDeleteProfile);
  const stableHandleTestBalance = useEventCallback(handleTestBalance);
  const stableHandleClearBalanceState = useEventCallback(handleClearBalanceState);
  const stableHandleSaveBalanceSession = useEventCallback(handleSaveBalanceSession);
  const stableHandleDeleteSiteBalanceSession = useEventCallback(handleDeleteSiteBalanceSession);
  const stableHandleDraftCommit = useEventCallback(handleDraftCommit);
  const stableHandleRuntimeCommit = useEventCallback(handleRuntimeCommit);
  const stableHandleFetchSiteModels = useEventCallback(handleFetchSiteModels);
  const stableHandleOpenBaseUrl = useEventCallback(handleOpenBaseUrl);
  const stableHandleSaveProfile = useEventCallback(handleSaveProfile);
  const stableHandlePickWorkingDirectory = useEventCallback(handlePickWorkingDirectory);
  const stableHandleToggleWorkingDirectoryFavorite = useEventCallback(handleToggleWorkingDirectoryFavorite);
  const stableHandleSelectWorkingDirectoryFavorite = useEventCallback(handleSelectWorkingDirectoryFavorite);
  const stableHandleLoadProfilesSessions = useEventCallback(handleLoadProfilesSessions);
  const stableHandleLaunch = useEventCallback(handleLaunch);
  const stableHandleLoadHistorySessions = useEventCallback(handleLoadHistorySessions);
  const stableHandleLoadMoreHistorySessions = useEventCallback(handleLoadMoreHistorySessions);
  const stableHandleHistoryRestoreProfileChange = useEventCallback(handleHistoryRestoreProfileChange);
  const stableHandleHistoryRestoreLaunch = useEventCallback(handleHistoryRestoreLaunch);
  const stableHandleToggleSessionFavorite = useEventCallback(handleToggleSessionFavorite);
  const stableHandleGlobalSettingsChange = useEventCallback(handleGlobalSettingsChange);
  const stableHandleChangePassphrase = useEventCallback(handleChangePassphrase);
  const stableHandleParameterSettingsChange = useEventCallback(handleParameterSettingsChange);
  const stableSetErrorMessage = useCallback((message: string) => setErrorMessage(message), []);
  const stableSetSuccessMessage = useCallback((message: string) => setSuccessMessage(message), []);
  const skillsStatusMessage = errorMessage
    ? { variant: "error" as const, text: errorMessage, onDismiss: stableClearErrorMessage }
    : successMessage
      ? { variant: "success" as const, text: successMessage, onDismiss: stableClearSuccessMessage }
      : null;
  const stableOpenSessionsTab = useCallback(() => {
    resetEmptyNewBalanceSessionDraft();
    setSessionsView(activeProvider);
    setActiveTab("sessions");
  }, [activeProvider, resetEmptyNewBalanceSessionDraft]);
  const stableSaveBalanceSessionAction = useCallback(() => void stableHandleSaveBalanceSession(), [stableHandleSaveBalanceSession]);
  const stableDeleteSiteBalanceSessionAction = useCallback(() => void stableHandleDeleteSiteBalanceSession(), [stableHandleDeleteSiteBalanceSession]);
  const stableDraftCommitAction = useCallback(
    (field: string, value?: string | boolean) => void stableHandleDraftCommit(field, value),
    [stableHandleDraftCommit],
  );
  const stableRuntimeCommitAction = useCallback(
    (field: string) => void stableHandleRuntimeCommit(field),
    [stableHandleRuntimeCommit],
  );
  const stableFetchModelsAction = useCallback(() => void stableHandleFetchSiteModels(), [stableHandleFetchSiteModels]);
  const stableOpenBaseUrlAction = useCallback(() => void stableHandleOpenBaseUrl(), [stableHandleOpenBaseUrl]);
  const stableSaveProfileAction = useCallback(() => void stableHandleSaveProfile(), [stableHandleSaveProfile]);
  const stableCancelProfileEditAction = useCallback(() => void stableHandleCancelProfileEdit(), [stableHandleCancelProfileEdit]);
  const stablePickWorkingDirectoryAction = useCallback(() => void stableHandlePickWorkingDirectory(), [stableHandlePickWorkingDirectory]);
  const stableToggleWorkingDirectoryFavoriteAction = useCallback(
    () => void stableHandleToggleWorkingDirectoryFavorite(),
    [stableHandleToggleWorkingDirectoryFavorite],
  );
  const stableSelectWorkingDirectoryFavoriteAction = useCallback(
    (path: string) => void stableHandleSelectWorkingDirectoryFavorite(path),
    [stableHandleSelectWorkingDirectoryFavorite],
  );
  const stableRefreshProfilesSessionsAction = useCallback(
    () => void stableHandleLoadProfilesSessions(state, undefined, { source: "manual" }),
    [stableHandleLoadProfilesSessions, state],
  );
  const stableDirectLaunchAction = useCallback(() => void stableHandleLaunch("new"), [stableHandleLaunch]);
  const stableContinueLaunchAction = useCallback(() => void stableHandleLaunch("continue_last"), [stableHandleLaunch]);
  const stableResumeLaunchAction = useCallback(
    () => void stableHandleLaunch(
      "resume_selected",
      profilesSelectedSessionId,
      undefined,
      sessionSourceFromSummary(profilesSessions.find((session) => session.session_id === profilesSelectedSessionId)),
    ),
    [profilesSelectedSessionId, profilesSessions, stableHandleLaunch],
  );
  const stableTemporaryReadonlyLaunchAction = useCallback(
    () => void stableHandleLaunch("new", undefined, "readonly"),
    [stableHandleLaunch],
  );
  const stableTemporaryFullAccessLaunchAction = useCallback(() => {
    if (window.confirm("确认以临时全权限模式启动？本次启动将跳过权限保护。")) {
      void stableHandleLaunch("new", undefined, "full_access");
    }
  }, [stableHandleLaunch]);
  const stableRefreshHistorySessionsAction = useCallback(
    () => void stableHandleLoadHistorySessions(state, { refresh: true }),
    [stableHandleLoadHistorySessions, state],
  );
  const stableLoadMoreHistorySessionsAction = useCallback(
    () => void stableHandleLoadMoreHistorySessions(state),
    [stableHandleLoadMoreHistorySessions, state],
  );
  const stableHistoryRestoreProfileChangeAction = useCallback(
    (profileKey: ProfileKey) => void stableHandleHistoryRestoreProfileChange(profileKey),
    [stableHandleHistoryRestoreProfileChange],
  );
  const stableHistoryRestoreLaunchAction = useCallback(() => void stableHandleHistoryRestoreLaunch(), [stableHandleHistoryRestoreLaunch]);
  const stableChangePassphraseAction = useCallback(
    (currentPassword: string, nextPassword: string) => void stableHandleChangePassphrase(currentPassword, nextPassword),
    [stableHandleChangePassphrase],
  );

  if (startupPhase === "checking") {
    return <StartupLoading message="正在准备解锁界面..." />;
  }

  if (startupPhase === "unlocking") {
    return <StartupLoading message="正在解锁并进入..." />;
  }

  // ---- 解锁界面 ----
  if (startupPhase === "locked") {
    return (
      <div className="unlock-screen">
        <div className="unlock-card">
          <h1>{APP_NAME}</h1>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleUnlock();
            }}
            placeholder="输入密码"
            autoFocus
            disabled={isBusy}
          />
          <button type="button" onClick={handleUnlock} disabled={isBusy || !passphrase}>
            {hasEncryptedConfig ? "解锁" : "创建并进入"}
          </button>
          {unlockError && <div className="banner error">{unlockError}</div>}
        </div>
      </div>
    );
  }

  // ---- 主界面 ----
  return (
    <div className="app-shell-v2">
      <header className="hero-v2">
        <div>
          <h1>AI CLI 工具统一管理</h1>
        </div>
        <nav className="tab-bar">
          <button
            type="button"
            className={`tab-btn ${activeTab === "profiles" ? "active" : ""}`}
            onClick={stableSetActiveProfilesTab}
          >
            Profiles
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "skills" ? "active" : ""}`}
            onClick={stableSetActiveSkillsTab}
          >
            Skills
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
            onClick={stableOpenSessionsTab}
          >
            会话
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={stableSetActiveSettingsTab}
          >
            设置
          </button>
        </nav>
      </header>

      {errorMessage && activeTab !== "skills" && (
        <div className="banner error" onClick={stableClearErrorMessage}>
          {errorMessage}
        </div>
      )}
      {successMessage && activeTab !== "skills" && (
        <div className="banner success" onClick={stableClearSuccessMessage}>
          {successMessage}
        </div>
      )}

      {/* ===== PROFILES Tab ===== */}
      {activeTab === "profiles" && (
        <Suspense fallback={<StartupLoading message="正在加载 Profiles 页面..." />}>
          <ProfilesPageComponent
            providerSwitchProps={{
              activeProvider: state?.selected_provider ?? PROVIDER_CLAUDE,
              onSwitch: stableHandleProviderSwitch,
              disabled: isBusy,
            }}
            profileListProps={{
              profiles,
              activeProvider: selectedProvider,
              selectedKey: state?.selected_profile_key ?? "",
              orderedKeys,
              balanceEntries,
              onSelect: stableHandleSelectProfile,
              onReorder: stableHandleReorder,
              onCreate: stableHandleNewProfile,
              onClone: stableHandleCloneProfile,
              onDelete: stableHandleDeleteProfile,
              disabled: isBusy,
            }}
            siteBalanceSessionProps={{
              siteBalanceSessions: draftSiteBalanceSessions,
              balanceSessionSelection: draftBalanceSessionSelection,
              balanceSessionDraft: draftBalanceSession,
              onBalanceSessionSelectionChange: handleBalanceSessionSelectionChange,
              onBalanceSessionDraftChange: handleBalanceSessionDraftChange,
              onSaveBalanceSession: stableSaveBalanceSessionAction,
              onDeleteSiteBalanceSession: stableDeleteSiteBalanceSessionAction,
              disabled: isBusy,
            }}
            balanceTestProps={{
              state: balanceState,
              onTest: stableHandleTestBalance,
              onClear: stableHandleClearBalanceState,
              disabled: isBusy || !state?.selected_profile_key,
              sessionHint: savedBalanceSessionHint,
            }}
            profileEditProps={{
              draft: profileDraft,
              globalPermissions,
              runtime: profileRuntime,
              provider: selectedProvider,
              modelOptions,
              modelFetchedAt,
              modelFetchBusy,
              modelFetchError,
              modelFetchSuccess,
              workingDirectoryFavorites,
              onChange: handleProfileDraftChange,
              onAdvancedModelMappingChange: setDraftAdvancedModelMapping,
              onPermissionsChange: setDraftPermissions,
              onDraftCommit: stableDraftCommitAction,
              onRuntimeChange: handleProfileRuntimeChange,
              onRuntimeCommit: stableRuntimeCommitAction,
              onFetchModels: stableFetchModelsAction,
              onOpenBaseUrl: stableOpenBaseUrlAction,
              onSave: stableSaveProfileAction,
              onCancel: stableCancelProfileEditAction,
              onPickCwd: stablePickWorkingDirectoryAction,
              onToggleWorkingDirectoryFavorite: stableToggleWorkingDirectoryFavoriteAction,
              onSelectWorkingDirectoryFavorite: stableSelectWorkingDirectoryFavoriteAction,
              disabled: isBusy,
            }}
            launchPanelProps={{
              provider: activeProvider,
              preview: launchPanelPreview,
              monitorModeEnabled: profilesLaunchMonitorModeEnabled,
              onMonitorModeChange: setProfilesLaunchMonitorModeEnabled,
              disabled: isBusy || !state?.selected_profile_key,
              resumeDisabled: !profilesSelectedSessionId,
              sessions: profilesSessions,
              sessionsLoading: profilesSessionsLoading || profilesSessionsUninitialized,
              sessionsUninitialized: profilesSessionsUninitialized,
              selectedSessionId: profilesSelectedSessionId,
              onSelectSession: setProfilesSelectedSessionId,
              onRefreshSessions: stableRefreshProfilesSessionsAction,
              onDirectLaunch: stableDirectLaunchAction,
              onContinueLaunch: stableContinueLaunchAction,
              onResumeLaunch: stableResumeLaunchAction,
              onTemporaryReadonlyLaunch: stableTemporaryReadonlyLaunchAction,
              onTemporaryFullAccessLaunch: stableTemporaryFullAccessLaunchAction,
            }}
          />
        </Suspense>
      )}

      {/* ===== SKILLS Tab ===== */}
      {activeTab === "skills" && (
        <Suspense fallback={<StartupLoading message="正在加载 Skills 页面..." />}>
          <SkillsPanelComponent
            onError={stableSetErrorMessage}
            onSuccess={stableSetSuccessMessage}
            statusMessage={skillsStatusMessage}
          />
        </Suspense>
      )}

      {/* ===== SESSIONS Tab ===== */}
      {activeTab === "sessions" && (
        <Suspense fallback={<StartupLoading message="正在加载会话页面..." />}>
          <SessionsPageComponent
            sessionViewSwitchProps={{
              activeView: sessionsView,
              onSwitch: stableHandleSessionsViewSwitch,
              disabled: isBusy,
            }}
            sessionListProps={{
              provider: sessionsView === "favorites" ? "收藏" : activeProvider,
              sessions: visibleHistorySessions,
              selectedId: historySelectedSessionId,
              getSessionKey: getSessionFavoriteKey,
              favoriteSessionKeys: sessionFavoriteKeys,
              restoreProfiles: historyRestoreProfiles,
              selectedRestoreProfileKey: historyRestoreProfileKey,
              restoreHint: historyRestoreHint,
              restoreDisabled: historyRestoreDisabled,
              preview: historyPreview,
              onSelect: setHistorySelectedSessionId,
              onRefresh: stableRefreshHistorySessionsAction,
              onLoadMore: sessionsView === "favorites" ? undefined : stableLoadMoreHistorySessionsAction,
              onSelectRestoreProfile: stableHistoryRestoreProfileChangeAction,
              onRestore: stableHistoryRestoreLaunchAction,
              onToggleFavorite: stableHandleToggleSessionFavorite,
              showRefresh: sessionsView !== "favorites",
              disabled: isBusy,
              isLoading: sessionsView === "favorites" ? false : historyIsLoading,
              hasMoreSessions: sessionsView === "favorites" ? false : historyHasMore,
              emptyMessage: sessionsView === "favorites" ? "暂无收藏会话" : "暂无会话记录",
            }}
          />
        </Suspense>
      )}

      {/* ===== SETTINGS Tab ===== */}
      {activeTab === "settings" && (
        <Suspense fallback={<StartupLoading message="正在加载设置页面..." />}>
          {hasHydratedParameterSettings ? (
             <SettingsPageComponent
              settingsSubTab={settingsSubTab}
              onSelectGlobal={stableSetGlobalSettingsSubTab}
              onSelectParameters={stableSetParameterSettingsSubTab}
              globalSettingsProps={{
                settings: state?.global_settings ?? {} as GlobalSettings,
                onChange: stableHandleGlobalSettingsChange,
                onChangePassphrase: stableChangePassphraseAction,
                disabled: isBusy,
              }}
              parameterSettingsProps={{
                settings: state?.parameter_settings ?? {} as ParameterSettings,
                onChange: stableHandleParameterSettingsChange,
                disabled: isBusy,
              }}
            />
          ) : (
            <StartupLoading message="正在加载设置页面..." />
          )}
        </Suspense>
      )}
    </div>
  );
}

export default App;
