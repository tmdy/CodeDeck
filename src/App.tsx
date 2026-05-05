import { useEffect, useMemo, useState } from "react";
import type { Profile, ProfileKey, GlobalSettings, LaunchMode } from "./shared/profile/types.js";
import type { LocalState } from "./shared/state/local-state.js";
import type { CommandPreview } from "./shared/launcher/types.js";
import type { ConnectivityTestState } from "./shared/connectivity/types.js";
import type { ParameterSettings } from "./shared/parameter/types.js";
import type { SessionSummary } from "./shared/services/session-service.js";
import { itemKey } from "./shared/profile/keys-internal.js";
import { PROVIDER_CLAUDE, PROVIDER_CODEX, defaultRuntimeSettings } from "./shared/profile/types.js";
import {
  buildNewProfileDraft,
  buildRuntimeSettingsFromDraft,
  buildSelectedProfileDraft,
  hasProfileDraftChanges,
  hasOnlyProfileDraftCwdChange,
  hasOnlyProfileDraftSelectedModelIdChange,
  type ProfileEditorDraft,
} from "./shared/profile-editor-state.js";

// Components
import { ProviderSwitch } from "./components/profiles/ProviderSwitch.jsx";
import { ProfileListPanel } from "./components/profiles/ProfileListPanel.jsx";
import { ProfileEditForm } from "./components/profiles/ProfileEditForm.jsx";
import { SessionList } from "./components/launcher/SessionList.jsx";
import { ConnectivityTestButton } from "./components/connectivity/ConnectivityTestButton.jsx";
import { GlobalSettingsPanel } from "./components/settings/GlobalSettingsPanel.jsx";
import { ParameterSettingsPanel } from "./components/settings/ParameterSettingsPanel.jsx";
import { ProfilesLaunchPanel } from "./components/profiles/ProfilesLaunchPanel.jsx";
import { SkillsPanel } from "./components/skills/SkillsPanel.jsx";

type TabId = "skills" | "profiles" | "sessions" | "settings";
type SettingsSubTab = "global" | "parameters";
type ListProfilesResult = { profiles: Profile[]; state: LocalState };

function emptyPreview(): CommandPreview {
  return {
    command: "",
    cwd: "",
    env: [],
    valid: false,
  };
}

function App() {
  const isUnlockWindow = window.location.hash.includes("/unlock");

  // ---- Tab 状态 ----
  const [activeTab, setActiveTab] = useState<TabId>("profiles");

  // ---- Profile 状态 ----
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<LocalState | null>(null);
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
  const [draftCwd, setDraftCwd] = useState("");
  const [draftCommandBase, setDraftCommandBase] = useState("");
  const [draftSettingsFile, setDraftSettingsFile] = useState("");
  const [draftArgs, setDraftArgs] = useState("");
  const [draftMode, setDraftMode] = useState<LaunchMode>("new");
  const [draftExcludeUser, setDraftExcludeUser] = useState(true);
  const [editorBaseline, setEditorBaseline] = useState<ProfileEditorDraft | null>(null);
  const [fetchedModelsByProvider, setFetchedModelsByProvider] = useState<Partial<Record<"claude" | "codex", string[]>>>({});
  const [lastFetchedAtByProvider, setLastFetchedAtByProvider] = useState<Partial<Record<"claude" | "codex", string>>>({});
  const [modelCatalogBusy, setModelCatalogBusy] = useState(false);
  const [modelCatalogError, setModelCatalogError] = useState<string | null>(null);
  const [modelCatalogSuccess, setModelCatalogSuccess] = useState<string | null>(null);

  // 命令预览 & 连接测试
  const [preview, setPreview] = useState<CommandPreview>(emptyPreview());
  const [connectivityState, setConnectivityState] = useState<ConnectivityTestState | null>(null);
  const [connectivityKey, setConnectivityKey] = useState<ProfileKey>("");

  // 会话
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // 设置
  const [settingsSubTab, setSettingsSubTab] = useState<SettingsSubTab>("global");
  const [isBusy, setIsBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
    const data = result as { profiles: Profile[]; state: LocalState };
    setProfiles(data.profiles);
    setState(data.state);
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
    const snapshot = selectedProfile
      ? buildSelectedProfileDraft(
          selectedProfile,
          data.state.runtime_by_profile[selectedKey],
          data.state.selected_provider,
        )
      : buildNewProfileDraft(data.state.selected_provider);

    setEditingKey(selectedProfile ? selectedKey : "");
    applyDraftSnapshot(snapshot);
    setEditorBaseline(snapshot);
  }

  async function refreshPreviewForDraft() {
    if (!window.profileManager || !state) {
      setPreview(emptyPreview());
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
        draft.launch_mode === "resume_selected" ? selectedSessionId : undefined,
      )) as CommandPreview;
      setPreview(nextPreview);
    } catch {
      setPreview(emptyPreview());
    }
  }

  useEffect(() => {
    void refreshPreviewForDraft();
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
    selectedSessionId,
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
      const draft: Profile = {
        provider: (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex",
        name: snapshot.name,
        url: snapshot.url,
        key: snapshot.key,
        selectedModelId: snapshot.selectedModelId,
        advancedModelMapping: snapshot.advancedModelMapping,
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

  async function persistSelectedModelOnlyChange(snapshot = currentDraftSnapshot()): Promise<boolean> {
    if (!window.profileManager || !state?.selected_profile_key || !editingKey) {
      return false;
    }
    if (!hasOnlyProfileDraftSelectedModelIdChange(snapshot, editorBaseline)) {
      return false;
    }
    return saveCurrentProfile({ snapshot, showSuccess: false });
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

  async function handleSelectProfile(key: ProfileKey) {
    if (!window.profileManager || !state) return;
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    await window.profileManager.selectProfile(state.selected_provider, key);
    const data = await refreshAll(true);
    if (data && activeTab === "sessions") {
      await handleLoadSessions(data.state);
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

  async function handleProviderSwitch(provider: string) {
    if (!window.profileManager) return;
    if (!(await resolveUnsavedProfileChanges())) {
      return;
    }
    await window.profileManager.activateProvider(provider);
    const data = await refreshAll(true);
    if (data && activeTab === "sessions") {
      await handleLoadSessions(data.state);
    }
  }

  async function handleReorder(orderedKeys: ProfileKey[]) {
    if (!window.profileManager || !state) return;
    await window.profileManager.reorderProfiles(state.selected_provider, orderedKeys);
  }

  // ---- 启动操作 ----
  async function handleLaunch(mode: LaunchMode, sessionId?: string) {
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
    };

    try {
      await window.profileManager.launch(request);
      await handleLoadSessions(launchState, runtime.cwd);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "启动失败");
    }
  }

  // ---- 连接测试 ----
  async function handleTestConnection() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    const key = state.selected_profile_key;
    setConnectivityKey(key);
    try {
      await window.profileManager.testConnection(key);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "连接测试失败");
    }
  }

  useEffect(() => {
    if (!window.profileManager) return;
    const unsub = window.profileManager.onConnectivityProgress((key, st) => {
      if (key === connectivityKey) {
        setConnectivityState(st as ConnectivityTestState);
      }
    });
    return unsub;
  }, [connectivityKey]);

  // ---- 会话 ----
  async function handleLoadSessions(nextState: LocalState | null = state, cwdOverride?: string) {
    if (!window.profileManager || !nextState?.selected_profile_key) {
      setSessions([]);
      setSelectedSessionId("");
      return;
    }
    const runtime = nextState.runtime_by_profile[nextState.selected_profile_key];
    const cwd = cwdOverride ?? draftCwd ?? runtime?.cwd ?? "";
    if (!cwd.trim()) {
      setSessions([]);
      setSelectedSessionId("");
      return;
    }
    try {
      const result = await window.profileManager.listSessions(nextState.selected_provider, cwd);
      const nextSessions = result as SessionSummary[];
      setSessions(nextSessions);
      if (selectedSessionId && !nextSessions.some((session) => session.session_id === selectedSessionId)) {
        setSelectedSessionId("");
      }
    } catch (err) {
      setSessions([]);
      setSelectedSessionId("");
      setErrorMessage(err instanceof Error ? err.message : "加载会话失败");
    }
  }

  useEffect(() => {
    if (activeTab === "profiles" || activeTab === "sessions") {
      void handleLoadSessions();
    }
  }, [activeTab, state?.selected_provider, state?.selected_profile_key, draftCwd]);

  async function handlePickWorkingDirectory() {
    if (!window.profileManager) return;
    try {
      const picked = await window.profileManager.pickWorkingDirectory();
      if (picked !== undefined) {
        const snapshot = { ...currentDraftSnapshot(), cwd: picked };
        setDraftCwd(picked);
        await persistCwdOnlyChange(snapshot);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "选择工作目录失败");
    }
  }

  async function handleRuntimeCommit(field: string) {
    if (field === "cwd") {
      await persistCwdOnlyChange();
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

  async function handleFetchSiteModels() {
    if (!window.profileManager || !state) return;
    const provider = (state.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex";
    setModelCatalogBusy(true);
    setModelCatalogError(null);
    setModelCatalogSuccess(null);
    try {
      const result = await window.profileManager.fetchSiteModels({
        url: draftUrl,
        key: draftKey,
      });
      setFetchedModelsByProvider((current) => ({
        ...current,
        [provider]: result.models,
      }));
      setLastFetchedAtByProvider((current) => ({
        ...current,
        [provider]: new Date().toLocaleString(),
      }));
      setModelCatalogSuccess("已更新当前站点模型列表");
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

  const connectivityStates = useMemo(() => {
    const result: Record<ProfileKey, string> = {};
    if (!state?.connectivity_tests_by_profile) return result;
    for (const [k, ts] of Object.entries(state.connectivity_tests_by_profile)) {
      if (ts.running) result[k] = "pending";
      else if (ts.success) result[k] = "success";
      else if (ts.message) result[k] = "fail";
      else result[k] = "";
    }
    return result;
  }, [state?.connectivity_tests_by_profile]);

  // ---- 解锁界面 ----
  if (showUnlockInput) {
    return (
      <div className="unlock-screen">
        <div className="unlock-card">
          <h1>Skills Manager</h1>
          <p className="eyebrow">
            {hasEncryptedConfig
              ? "请输入配置密码以解锁 Profile 管理功能"
              : "首次使用请先设置配置密码，后续打开时将先解锁"}
          </p>
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
          <p className="eyebrow">Skills Manager V2</p>
          <h1>AI CLI 工具统一管理</h1>
        </div>
        <nav className="tab-bar">
          <button
            type="button"
            className={`tab-btn ${activeTab === "profiles" ? "active" : ""}`}
            onClick={() => setActiveTab("profiles")}
          >
            Profiles
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "skills" ? "active" : ""}`}
            onClick={() => setActiveTab("skills")}
          >
            Skills
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "sessions" ? "active" : ""}`}
            onClick={() => {
              setActiveTab("sessions");
              handleLoadSessions();
            }}
          >
            会话
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === "settings" ? "active" : ""}`}
            onClick={() => setActiveTab("settings")}
          >
            设置
          </button>
        </nav>
      </header>

      {errorMessage && (
        <div className="banner error" onClick={() => setErrorMessage(null)}>
          {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="banner success" onClick={() => setSuccessMessage(null)}>
          {successMessage}
        </div>
      )}

      {/* ===== PROFILES Tab ===== */}
      {activeTab === "profiles" && (
        <div className="profiles-layout">
          <div className="profiles-left">
            <ProviderSwitch
              activeProvider={state?.selected_provider ?? PROVIDER_CLAUDE}
              onSwitch={handleProviderSwitch}
              disabled={isBusy}
            />
            <ProfileListPanel
              profiles={profiles}
              activeProvider={(state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex"}
              selectedKey={state?.selected_profile_key ?? ""}
              orderedKeys={orderedKeys}
              connectivityStates={connectivityStates}
              onSelect={handleSelectProfile}
              onReorder={handleReorder}
              onCreate={handleNewProfile}
              onClone={handleCloneProfile}
              onDelete={handleDeleteProfile}
              disabled={isBusy}
            />
            <ConnectivityTestButton
              isRunning={connectivityState?.running ?? false}
              success={connectivityState?.success ?? false}
              message={connectivityState?.message ?? ""}
              onTest={handleTestConnection}
              disabled={isBusy}
            />
          </div>

          <div className="profiles-center">
            <ProfileEditForm
              draft={{
                name: draftName,
                url: draftUrl,
                key: draftKey,
                selectedModelId: draftModel,
                advancedModelMapping: draftAdvancedModelMapping,
              }}
              runtime={{
                cwd: draftCwd,
                command_base: draftCommandBase,
                settings_file: draftSettingsFile,
                extra_args: draftArgs,
                launch_mode: draftMode,
                exclude_user_settings: draftExcludeUser,
              }}
              provider={(state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex"}
              modelOptions={fetchedModelsByProvider[(state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex"] ?? []}
              modelFetchedAt={lastFetchedAtByProvider[(state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex"]}
              modelFetchBusy={modelCatalogBusy}
              modelFetchError={modelCatalogError}
              modelFetchSuccess={modelCatalogSuccess}
              onChange={(field, val) => {
                switch (field) {
                  case "name": setDraftName(val as string); break;
                  case "url": setDraftUrl(val as string); break;
                  case "key": setDraftKey(val as string); break;
                  case "selectedModelId": setDraftModel(val as string); break;
                }
              }}
              onAdvancedModelMappingChange={setDraftAdvancedModelMapping}
              onDraftCommit={(field, value) => void handleDraftCommit(field, value)}
              onRuntimeChange={(field, val) => {
                switch (field) {
                  case "cwd": setDraftCwd(val as string); break;
                  case "command_base": setDraftCommandBase(val as string); break;
                  case "settings_file": setDraftSettingsFile(val as string); break;
                  case "extra_args": setDraftArgs(val as string); break;
                  case "launch_mode": setDraftMode(val as LaunchMode); break;
                  case "exclude_user_settings": setDraftExcludeUser(val as boolean); break;
                }
              }}
              onRuntimeCommit={(field) => void handleRuntimeCommit(field)}
              onFetchModels={() => void handleFetchSiteModels()}
              onSave={() => void handleSaveProfile()}
              onCancel={() => void handleNewProfile()}
              onPickCwd={() => void handlePickWorkingDirectory()}
              disabled={isBusy}
            />
          </div>

          <div className="profiles-right">
            <ProfilesLaunchPanel
              preview={preview}
              disabled={isBusy || !state?.selected_profile_key}
              resumeDisabled={!selectedSessionId}
              sessions={sessions}
              selectedSessionId={selectedSessionId}
              onSelectSession={setSelectedSessionId}
              onRefreshSessions={() => void handleLoadSessions()}
              onDirectLaunch={() => void handleLaunch("new")}
              onContinueLaunch={() => void handleLaunch("continue_last")}
              onResumeLaunch={() => void handleLaunch("resume_selected", selectedSessionId)}
            />
          </div>
        </div>
      )}

      {/* ===== SKILLS Tab ===== */}
      {activeTab === "skills" && (
        <SkillsPanel
          onError={setErrorMessage}
          onSuccess={setSuccessMessage}
        />
      )}

      {/* ===== SESSIONS Tab ===== */}
      {activeTab === "sessions" && (
        <div className="sessions-layout">
          <SessionList
            sessions={sessions}
            selectedId={selectedSessionId}
            onSelect={setSelectedSessionId}
            onRefresh={handleLoadSessions}
            disabled={isBusy}
          />
        </div>
      )}

      {/* ===== SETTINGS Tab ===== */}
      {activeTab === "settings" && (
        <div className="settings-layout">
          <nav className="settings-sub-tabs">
            <button
              type="button"
              className={`tab-btn ${settingsSubTab === "global" ? "active" : ""}`}
              onClick={() => setSettingsSubTab("global")}
            >
              全局设置
            </button>
            <button
              type="button"
              className={`tab-btn ${settingsSubTab === "parameters" ? "active" : ""}`}
              onClick={() => setSettingsSubTab("parameters")}
            >
              参数设置
            </button>
          </nav>

          {settingsSubTab === "global" && (
            <GlobalSettingsPanel
              settings={state?.global_settings ?? {} as GlobalSettings}
              onChange={handleGlobalSettingsChange}
              disabled={isBusy}
            />
          )}

          {settingsSubTab === "parameters" && (
            <ParameterSettingsPanel
              settings={state?.parameter_settings ?? {} as ParameterSettings}
              onChange={handleParameterSettingsChange}
              disabled={isBusy}
            />
          )}
        </div>
      )}
    </div>
  );
}

export default App;
