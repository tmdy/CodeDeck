import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AdvancedModelMapping, Profile, ProfileKey, GlobalSettings, LaunchMode } from "./shared/profile/types.js";
import type { LocalState } from "./shared/state/local-state.js";
import type { CommandPreview } from "./shared/launcher/types.js";
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
  balanceSessionDraftsEqual,
  hasProfileDraftChanges,
  hasOnlyProfileDraftBalanceSessionChange,
  hasOnlyProfileDraftCwdChange,
  hasOnlyProfileDraftSelectedModelIdChange,
  type ProfileEditorDraft,
} from "./shared/profile-editor-state.js";

// Components
import { ProfilesPage } from "./components/app/ProfilesPage.jsx";
import { SessionsPage } from "./components/app/SessionsPage.jsx";
import { SettingsPage } from "./components/app/SettingsPage.jsx";
import { SkillsPanel } from "./components/skills/SkillsPanel.jsx";
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

type TabId = "skills" | "profiles" | "sessions" | "settings";
type SettingsSubTab = "global" | "parameters";
type BalanceSessionDraftState = {
  label: string;
  access_token: string;
  user_id: string;
};
type ListProfilesResult = {
  profiles: Profile[];
  state: LocalState;
  siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
};
type ModelCatalogCacheEntry = {
  models: string[];
  fetchedAt: string;
};

const EMPTY_MODEL_OPTIONS: string[] = [];
const DRAFT_PREVIEW_DEBOUNCE_MS = 300;

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

function emptyPreview(): CommandPreview {
  return {
    command: "",
    cwd: "",
    env: [],
    valid: false,
  };
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
    && (left.profile_key ?? "") === (right.profile_key ?? "");
}

function App() {
  const isUnlockWindow = window.location.hash.includes("/unlock");

  // ---- Tab 状态 ----
  const [activeTab, setActiveTab] = useState<TabId>("profiles");

  // ---- Profile 状态 ----
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<LocalState | null>(null);
  const [siteBalanceSessionsByBaseUrl, setSiteBalanceSessionsByBaseUrl] = useState<SiteBalanceSessionsByBaseUrl>({});
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [showUnlockInput, setShowUnlockInput] = useState(isUnlockWindow);
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
  const [draftMode, setDraftMode] = useState<LaunchMode>("new");
  const [draftExcludeUser, setDraftExcludeUser] = useState(true);
  const [editorBaseline, setEditorBaseline] = useState<ProfileEditorDraft | null>(null);
  const [modelCatalogByBaseUrl, setModelCatalogByBaseUrl] = useState<Record<string, ModelCatalogCacheEntry>>({});
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);

  // 命令预览 & 余额检测
  const [preview, setPreview] = useState<CommandPreview>(emptyPreview());
  const [balanceState, setBalanceState] = useState<BalanceCheckState | null>(null);
  const [balanceKey, setBalanceKey] = useState<ProfileKey>("");

  // 会话
  const [profilesSessions, setProfilesSessions] = useState<SessionSummary[]>([]);
  const [profilesSelectedSessionId, setProfilesSelectedSessionId] = useState<string>("");
  const [historySessions, setHistorySessions] = useState<SessionSummary[]>([]);
  const [historySelectedSessionId, setHistorySelectedSessionId] = useState<string>("");
  const [historyPreview, setHistoryPreview] = useState<CommandPreview>(emptyPreview());
  const latestHistoryRequestRef = useRef<ListSessionsRequest | null>(null);
  const historyRequestSeqRef = useRef(0);
  const previewRequestSeqRef = useRef(0);

  // 设置
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>("global");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeProvider = (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex";
  const historyRestoreProfileKey = resolveHistoryRestoreProfileKey(state, profiles, activeProvider);
  const historyRestoreProfiles = useMemo(
    () =>
      listProfilesForProvider(profiles, activeProvider).map((profile) => {
        const key = itemKey(profile);
        return {
          key,
          label: profile.name,
          cwd: state?.runtime_by_profile[key]?.cwd ?? "",
        };
      }),
    [activeProvider, profiles, state?.runtime_by_profile],
  );
  const visibleHistorySessions = useMemo(
    () => historySessions.filter((session) => session.provider === activeProvider),
    [activeProvider, historySessions],
  );
  const selectedHistorySession = visibleHistorySessions.find((session) => session.session_id === historySelectedSessionId);
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

  // ---- 初始化 ----
  useEffect(() => {
    checkConfigAndInit();
  }, []);

  useEffect(() => {
    document.body.classList.toggle("unlock-route", isUnlockWindow);
    return () => {
      document.body.classList.remove("unlock-route");
    };
  }, [isUnlockWindow]);

  // 监听 profile state 变更事件
  useEffect(() => {
    if (!window.profileManager) return;
    const unsub = window.profileManager.onStateChanged((newState) => {
      setState(newState as LocalState);
    });
    return unsub;
  }, [isUnlocked]);

  async function checkConfigAndInit() {
    if (!window.profileManager) {
      setErrorMessage("当前环境未注入 Profile API，请通过 Electron 运行。");
      return;
    }

    try {
      const hasConfig = await window.profileManager.checkEncryptedConfig();
      setHasEncryptedConfig(hasConfig);
      if (isUnlockWindow) {
        setShowUnlockInput(true);
        return;
      } else {
        const data = await loadData();
        syncEditorFromData(data);
        setIsUnlocked(true);
        setShowUnlockInput(false);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "初始化失败");
    }
  }

  async function handleUnlock() {
    if (!window.profileManager) return;
    setIsBusy(true);
    setUnlockError(null);
    try {
      await window.profileManager.unlock(passphrase);
      if (isUnlockWindow) {
        return;
      }
      const data = await loadData();
      syncEditorFromData(data);
      setIsUnlocked(true);
      setShowUnlockInput(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function loadData(): Promise<ListProfilesResult> {
    if (!window.profileManager) {
      throw new Error("Profile API 不可用");
    }
    const result = await window.profileManager.listProfiles();
    const data = result as {
      profiles: Profile[];
      state: LocalState;
      siteBalanceSessionsByBaseUrl: SiteBalanceSessionsByBaseUrl;
    };
    setProfiles(data.profiles);
    setState(data.state);
    setSiteBalanceSessionsByBaseUrl(data.siteBalanceSessionsByBaseUrl);
    return data;
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
      launch_mode: draftMode,
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
    setDraftMode(draft.launch_mode);
    setDraftArgs(draft.extra_args);
    setDraftExcludeUser(draft.exclude_user_settings);
  }

  function syncEditorFromData(data: ListProfilesResult) {
    const selectedKey = data.state.selected_profile_key;
    const selectedProfile = data.profiles.find((profile) => itemKey(profile) === selectedKey);
    const selectedSession = selectedProfile?.balance_session_id
      ? getSiteBalanceSessionsForBaseUrl(data.siteBalanceSessionsByBaseUrl, selectedProfile.url)
        .find((session) => session.id === selectedProfile.balance_session_id)
      : undefined;
    const snapshot = selectedProfile
      ? buildSelectedProfileDraft(
          selectedProfile,
          data.state.runtime_by_profile[selectedKey],
          data.state.selected_provider,
          selectedSession,
        )
      : buildNewProfileDraft(data.state.selected_provider);

    setEditingKey(selectedProfile ? selectedKey : "");
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  useEffect(() => {
    if (draftBalanceSessionSelection === "new") {
      return;
    }
    if (draftBalanceSessionSelection === "auto") {
      if (
        draftBalanceSession.label
        || draftBalanceSession.access_token
        || draftBalanceSession.user_id
      ) {
        setDraftBalanceSession(emptyBalanceSessionDraft());
      }
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
    if (!balanceSessionDraftsEqual(nextDraft, draftBalanceSession)) {
      setDraftBalanceSession(nextDraft);
    }
  }, [
    draftBalanceSession,
    draftBalanceSessionSelection,
    draftSiteBalanceSessions,
  ]);

  async function refreshPreviewForDraft() {
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
        },
        buildRuntimeSettingsFromDraft(draft),
        undefined,
        draft.launch_mode === "resume_selected" ? profilesSelectedSessionId : undefined,
      )) as CommandPreview;
      if (requestSeq === previewRequestSeqRef.current) {
        setPreview(nextPreview);
      }
    } catch {
      if (requestSeq === previewRequestSeqRef.current) {
        setPreview(emptyPreview());
      }
    }
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshPreviewForDraft();
    }, DRAFT_PREVIEW_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
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
    draftMode,
    draftExcludeUser,
    profilesSelectedSessionId,
  ]);

  async function saveCurrentProfile(options: {
    snapshot?: ProfileEditorDraft;
    showSuccess?: boolean;
  } = {}): Promise<boolean> {
    if (!window.profileManager) return false;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const snapshot = options.snapshot ?? currentDraftSnapshot();
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
    const saved = await persistCwdOnlyChange(snapshot);
    if (saved && activeTab === "profiles") {
      await handleLoadProfilesSessions(state, snapshot.cwd);
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
    const saved = await saveCurrentProfile({ showSuccess: false });
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
    const snapshot = buildNewProfileDraft(state?.selected_provider ?? PROVIDER_CLAUDE);
    setEditingKey("");
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  function clearDraft() {
    applyDraftSnapshot(buildNewProfileDraft(state?.selected_provider ?? PROVIDER_CLAUDE));
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
    }
    await window.profileManager.activateProvider(provider);
    const data = await refreshAll(true);
    if (data && activeTab === "sessions") {
      await handleLoadHistorySessions(data.state);
    }
  }

  async function handleReorder(orderedKeys: ProfileKey[]) {
    if (!window.profileManager || !state) return;
    await window.profileManager.reorderProfiles(state.selected_provider, orderedKeys);
  }

  // ---- 启动操作 ----
  async function handleLaunch(mode: LaunchMode, sessionId?: string, permissionOverride?: PermissionPreset) {
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

    const request = {
      profile_key: launchState.selected_profile_key,
      provider: launchState.selected_provider,
      runtime_settings: { ...runtime, launch_mode: mode },
      session_id: sessionId,
      permission_override: permissionOverride,
    };

    try {
      await window.profileManager.launch(request);
      await handleLoadProfilesSessions(launchState, runtime.cwd);
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
  async function handleLoadProfilesSessions(nextState: LocalState | null = state, cwdOverride?: string) {
    if (!window.profileManager || !nextState?.selected_profile_key) {
      setProfilesSessions([]);
      setProfilesSelectedSessionId("");
      return;
    }
    const runtime = nextState.runtime_by_profile[nextState.selected_profile_key];
    const cwd = cwdOverride ?? draftCwd ?? runtime?.cwd ?? "";
    if (!cwd.trim()) {
      setProfilesSessions([]);
      setProfilesSelectedSessionId("");
      return;
    }

    const request: ListSessionsRequest = {
      provider: nextState.selected_provider,
      scope: "project",
      cwd,
      profile_key: nextState.selected_profile_key,
    };

    try {
      const result = await window.profileManager.listSessions(request);
      const nextSessions = result as SessionSummary[];
      setProfilesSessions(nextSessions);
      setProfilesSelectedSessionId((current) => (
        current && !nextSessions.some((session) => session.session_id === current) ? "" : current
      ));
    } catch (err) {
      setProfilesSessions([]);
      setProfilesSelectedSessionId("");
      setErrorMessage(err instanceof Error ? err.message : "加载会话失败");
    }
  }

  async function handleLoadHistorySessions(nextState: LocalState | null = state) {
    if (!window.profileManager || !nextState) {
      setHistorySessions([]);
      setHistorySelectedSessionId("");
      return;
    }

    const provider = nextState.selected_provider;
    const request: ListSessionsRequest = {
      provider,
      scope: "global_recent",
      profile_key: nextState.selected_profile_key,
    };
    const requestSeq = ++historyRequestSeqRef.current;
    latestHistoryRequestRef.current = request;

    try {
      const result = await window.profileManager.listSessions(request);
      if (requestSeq !== historyRequestSeqRef.current || !sameSessionRequest(latestHistoryRequestRef.current, request)) {
        return;
      }
      const nextSessions = (result as SessionSummary[]).filter((session) => session.provider === provider);
      setHistorySessions(nextSessions);
      setHistorySelectedSessionId((current) => (
        current && !nextSessions.some((session) => session.session_id === current) ? "" : current
      ));
    } catch (err) {
      if (requestSeq !== historyRequestSeqRef.current || !sameSessionRequest(latestHistoryRequestRef.current, request)) {
        return;
      }
      setHistorySessions([]);
      setHistorySelectedSessionId("");
      setHistoryPreview(emptyPreview());
      setErrorMessage(err instanceof Error ? err.message : "加载会话失败");
    }
  }

  async function handleHistoryRestoreProfileChange(profileKey: ProfileKey) {
    if (!window.profileManager) {
      return;
    }
    await window.profileManager.updateSessionsTabState(activeProvider, {
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
      const nextPreview = (await window.profileManager.previewForDraft(
        selectedProfile,
        {
          ...runtime,
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
    if (!runtime.cwd.trim()) {
      setErrorMessage("所选 Profile 当前未设置工作目录，请先设置后再恢复。");
      return;
    }

    const request = {
      profile_key: historyRestoreProfileKey,
      provider: selectedHistorySession.provider,
      runtime_settings: {
        ...runtime,
        launch_mode: "resume_selected" as const,
      },
      session_id: selectedHistorySession.session_id,
    };

    try {
      await window.profileManager.launch(request);
      await handleLoadHistorySessions(state);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "恢复会话失败");
    }
  }

  useEffect(() => {
    if (activeTab === "profiles") {
      void handleLoadProfilesSessions();
    }
  }, [activeTab, state?.selected_provider, state?.selected_profile_key]);

  useEffect(() => {
    if (activeTab === "sessions") {
      void handleLoadHistorySessions();
    }
  }, [
    activeTab,
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
    historySelectedSessionId,
    historyRestoreProfileKey,
    historySessions,
  ]);

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
    setModelCatalogBusy(true);
    setModelCatalogError(null);
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
    } catch (err) {
      setModelCatalogError(err instanceof Error ? err.message : "获取远端模型失败");
    } finally {
      setModelCatalogBusy(false);
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
    extra_args: draftArgs,
    launch_mode: draftMode,
    exclude_user_settings: draftExcludeUser,
  }), [
    draftArgs,
    draftCommandBase,
    draftCwd,
    draftExcludeUser,
    draftMode,
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
  const modelOptions = modelCatalogCacheEntry?.models ?? EMPTY_MODEL_OPTIONS;
  const modelFetchedAt = modelCatalogCacheEntry?.fetchedAt;
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
  const handleProfileRuntimeChange = useCallback((field: string, val: string | boolean) => {
    switch (field) {
      case "cwd": setDraftCwd(val as string); break;
      case "command_base": setDraftCommandBase(val as string); break;
      case "settings_file": setDraftSettingsFile(val as string); break;
      case "extra_args": setDraftArgs(val as string); break;
      case "launch_mode": setDraftMode(val as LaunchMode); break;
      case "exclude_user_settings": setDraftExcludeUser(val as boolean); break;
    }
  }, []);
  const stableSetActiveProfilesTab = useCallback(() => setActiveTab("profiles"), []);
  const stableSetActiveSkillsTab = useCallback(() => setActiveTab("skills"), []);
  const stableSetActiveSettingsTab = useCallback(() => setActiveTab("settings"), []);
  const stableSetGlobalSettingsSubTab = useCallback(() => setSettingsSubTab("global"), []);
  const stableSetParameterSettingsSubTab = useCallback(() => setSettingsSubTab("parameters"), []);
  const stableClearErrorMessage = useCallback(() => setErrorMessage(null), []);
  const stableClearSuccessMessage = useCallback(() => setSuccessMessage(null), []);
  const stableHandleProviderSwitch = useEventCallback(handleProviderSwitch);
  const stableHandleSelectProfile = useEventCallback(handleSelectProfile);
  const stableHandleReorder = useEventCallback(handleReorder);
  const stableHandleNewProfile = useEventCallback(handleNewProfile);
  const stableHandleCloneProfile = useEventCallback(handleCloneProfile);
  const stableHandleDeleteProfile = useEventCallback(handleDeleteProfile);
  const stableHandleTestBalance = useEventCallback(handleTestBalance);
  const stableHandleSaveBalanceSession = useEventCallback(handleSaveBalanceSession);
  const stableHandleDeleteSiteBalanceSession = useEventCallback(handleDeleteSiteBalanceSession);
  const stableHandleDraftCommit = useEventCallback(handleDraftCommit);
  const stableHandleRuntimeCommit = useEventCallback(handleRuntimeCommit);
  const stableHandleFetchSiteModels = useEventCallback(handleFetchSiteModels);
  const stableHandleOpenBaseUrl = useEventCallback(handleOpenBaseUrl);
  const stableHandleSaveProfile = useEventCallback(handleSaveProfile);
  const stableHandlePickWorkingDirectory = useEventCallback(handlePickWorkingDirectory);
  const stableHandleLoadProfilesSessions = useEventCallback(handleLoadProfilesSessions);
  const stableHandleLaunch = useEventCallback(handleLaunch);
  const stableHandleLoadHistorySessions = useEventCallback(handleLoadHistorySessions);
  const stableHandleHistoryRestoreProfileChange = useEventCallback(handleHistoryRestoreProfileChange);
  const stableHandleHistoryRestoreLaunch = useEventCallback(handleHistoryRestoreLaunch);
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
    setActiveTab("sessions");
    void stableHandleLoadHistorySessions();
  }, [stableHandleLoadHistorySessions]);
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
  const stableCancelProfileEditAction = useCallback(() => void stableHandleNewProfile(), [stableHandleNewProfile]);
  const stablePickWorkingDirectoryAction = useCallback(() => void stableHandlePickWorkingDirectory(), [stableHandlePickWorkingDirectory]);
  const stableRefreshProfilesSessionsAction = useCallback(() => void stableHandleLoadProfilesSessions(), [stableHandleLoadProfilesSessions]);
  const stableDirectLaunchAction = useCallback(() => void stableHandleLaunch("new"), [stableHandleLaunch]);
  const stableContinueLaunchAction = useCallback(() => void stableHandleLaunch("continue_last"), [stableHandleLaunch]);
  const stableResumeLaunchAction = useCallback(
    () => void stableHandleLaunch("resume_selected", profilesSelectedSessionId),
    [profilesSelectedSessionId, stableHandleLaunch],
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
  const stableRefreshHistorySessionsAction = useCallback(() => void stableHandleLoadHistorySessions(), [stableHandleLoadHistorySessions]);
  const stableHistoryRestoreProfileChangeAction = useCallback(
    (profileKey: ProfileKey) => void stableHandleHistoryRestoreProfileChange(profileKey),
    [stableHandleHistoryRestoreProfileChange],
  );
  const stableHistoryRestoreLaunchAction = useCallback(() => void stableHandleHistoryRestoreLaunch(), [stableHandleHistoryRestoreLaunch]);
  const stableChangePassphraseAction = useCallback(
    (currentPassword: string, nextPassword: string) => void stableHandleChangePassphrase(currentPassword, nextPassword),
    [stableHandleChangePassphrase],
  );

  // ---- 解锁界面 ----
  if (showUnlockInput) {
    return (
      <div className="unlock-screen">
        <div className="unlock-card">
          <h1>Skills Manager</h1>
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
        <ProfilesPage
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
          balanceTestProps={{
            state: balanceState,
            onTest: stableHandleTestBalance,
            disabled: isBusy || !state?.selected_profile_key,
            sessionHint: savedBalanceSessionHint,
          }}
          profileEditProps={{
            draft: profileDraft,
            globalPermissions,
            siteBalanceSessions: draftSiteBalanceSessions,
            balanceSessionSelection: draftBalanceSessionSelection,
            balanceSessionDraft: draftBalanceSession,
            runtime: profileRuntime,
            provider: selectedProvider,
            modelOptions,
            modelFetchedAt,
            modelFetchBusy: modelCatalogBusy,
            modelFetchError: modelCatalogError,
            modelFetchSuccess,
            onChange: handleProfileDraftChange,
            onBalanceSessionSelectionChange: handleBalanceSessionSelectionChange,
            onBalanceSessionDraftChange: handleBalanceSessionDraftChange,
            onSaveBalanceSession: stableSaveBalanceSessionAction,
            onDeleteSiteBalanceSession: stableDeleteSiteBalanceSessionAction,
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
            disabled: isBusy,
          }}
          launchPanelProps={{
            preview,
            disabled: isBusy || !state?.selected_profile_key,
            resumeDisabled: !profilesSelectedSessionId,
            sessions: profilesSessions,
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
      )}

      {/* ===== SKILLS Tab ===== */}
      {activeTab === "skills" && (
        <SkillsPanel
          onError={stableSetErrorMessage}
          onSuccess={stableSetSuccessMessage}
          statusMessage={skillsStatusMessage}
        />
      )}

      {/* ===== SESSIONS Tab ===== */}
      {activeTab === "sessions" && (
        <SessionsPage
          providerSwitchProps={{
            activeProvider,
            onSwitch: stableHandleProviderSwitch,
            disabled: isBusy,
          }}
          sessionListProps={{
            provider: activeProvider,
            sessions: visibleHistorySessions,
            selectedId: historySelectedSessionId,
            restoreProfiles: historyRestoreProfiles,
            selectedRestoreProfileKey: historyRestoreProfileKey,
            restoreHint: historyRestoreHint,
            restoreDisabled: historyRestoreDisabled,
            preview: historyPreview,
            onSelect: setHistorySelectedSessionId,
            onRefresh: stableRefreshHistorySessionsAction,
            onSelectRestoreProfile: stableHistoryRestoreProfileChangeAction,
            onRestore: stableHistoryRestoreLaunchAction,
            disabled: isBusy,
          }}
        />
      )}

      {/* ===== SETTINGS Tab ===== */}
      {activeTab === "settings" && (
        <SettingsPage
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
      )}
    </div>
  );
}

export default App;
