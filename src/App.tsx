import { useEffect, useMemo, useState } from "react";
import type { Profile, ProfileKey, RuntimeSettings, GlobalSettings, LaunchMode } from "./shared/profile/types.js";
import type { LocalState } from "./shared/state/local-state.js";
import type { CommandPreview } from "./shared/launcher/types.js";
import type { ConnectivityTestState } from "./shared/connectivity/types.js";
import type { ModelMappingEntry } from "./shared/model-mapping/types.js";
import type { ParameterSettings } from "./shared/parameter/types.js";
import type { SessionSummary } from "./shared/services/session-service.js";
import { itemKey } from "./shared/profile/keys-internal.js";
import { PROVIDER_CLAUDE, PROVIDER_CODEX, defaultRuntimeSettings } from "./shared/profile/types.js";

// Components
import { ProviderSwitch } from "./components/profiles/ProviderSwitch.jsx";
import { ProfileListPanel } from "./components/profiles/ProfileListPanel.jsx";
import { ProfileEditForm } from "./components/profiles/ProfileEditForm.jsx";
import { LaunchControls } from "./components/launcher/LaunchControls.jsx";
import { CmdPreview } from "./components/launcher/CommandPreview.jsx";
import { SessionList } from "./components/launcher/SessionList.jsx";
import { ConnectivityTestButton } from "./components/connectivity/ConnectivityTestButton.jsx";
import { GlobalSettingsPanel } from "./components/settings/GlobalSettingsPanel.jsx";
import { ModelMappingPanel } from "./components/settings/ModelMappingPanel.jsx";
import { ParameterSettingsPanel } from "./components/settings/ParameterSettingsPanel.jsx";
import { SkillsPanel } from "./components/skills/SkillsPanel.jsx";

type TabId = "skills" | "profiles" | "sessions" | "settings";
type SettingsSubTab = "global" | "model-mapping" | "parameters";

function App() {
  // ---- Tab 状态 ----
  const [activeTab, setActiveTab] = useState<TabId>("profiles");

  // ---- Profile 状态 ----
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<LocalState | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [showUnlockInput, setShowUnlockInput] = useState(false);

  // 编辑状态
  const [editingKey, setEditingKey] = useState<ProfileKey>("");
  const [draftName, setDraftName] = useState("");
  const [draftUrl, setDraftUrl] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [draftModel, setDraftModel] = useState("");
  const [draftCwd, setDraftCwd] = useState("");
  const [draftArgs, setDraftArgs] = useState("");
  const [draftMode, setDraftMode] = useState<LaunchMode>("direct");
  const [draftProxy, setDraftProxy] = useState("");
  const [draftExcludeUser, setDraftExcludeUser] = useState(true);

  // 命令预览 & 连接测试
  const [previewCmd, setPreviewCmd] = useState("");
  const [previewValid, setPreviewValid] = useState(false);
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
      if (hasConfig) {
        setShowUnlockInput(true);
      } else {
        // 无加密配置，直接跳过
        await window.profileManager.initializeEncryption("");
        await loadData();
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
      await loadData();
      setIsUnlocked(true);
      setShowUnlockInput(false);
    } catch (err) {
      setUnlockError(err instanceof Error ? err.message : "解锁失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleSkipUnlock() {
    setShowUnlockInput(false);
    setIsUnlocked(true);
    // 尝试加载
    try {
      await loadData();
    } catch {
      // 忽略
    }
  }

  async function loadData() {
    if (!window.profileManager) return;
    const result = await window.profileManager.listProfiles();
    const data = result as { profiles: Profile[]; state: LocalState };
    setProfiles(data.profiles);
    setState(data.state);
  }

  async function refreshAll() {
    await loadData();
    refreshPreview();
  }

  // ---- 命令预览刷新 ----
  async function refreshPreview() {
    if (!window.profileManager || !state?.selected_profile_key) {
      setPreviewCmd("");
      setPreviewValid(false);
      return;
    }

    try {
      const preview = (await window.profileManager.previewForProfile(
        state.selected_profile_key,
      )) as CommandPreview;
      setPreviewCmd(preview.command);
      setPreviewValid(preview.valid);
    } catch {
      setPreviewCmd("");
      setPreviewValid(false);
    }
  }

  useEffect(() => {
    refreshPreview();
  }, [state?.selected_profile_key, state?.runtime_by_profile]);

  // ---- Profile CRUD 操作 ----
  async function handleSaveProfile() {
    if (!window.profileManager) return;
    setIsBusy(true);
    setErrorMessage(null);
    try {
      const draft: Profile = {
        provider: (state?.selected_provider ?? PROVIDER_CLAUDE) as "claude" | "codex",
        name: draftName,
        url: draftUrl,
        key: draftKey,
      };
      const runtime: RuntimeSettings = {
        proxy: draftProxy,
        cwd: draftCwd,
        command_base: state?.selected_provider === PROVIDER_CODEX ? "codex" : "claude",
        model: draftModel,
        launch_mode: draftMode,
        extra_args: draftArgs,
        exclude_user_settings: draftExcludeUser,
      };
      await window.profileManager.saveProfile(editingKey, draft, runtime);
      await refreshAll();
      setSuccessMessage(`Profile "${draftName}" 已保存`);
      // 清空新建状态
      if (!editingKey) {
        setEditingKey("");
        clearDraft();
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存失败");
    } finally {
      setIsBusy(false);
    }
  }

  function handleSelectProfile(key: ProfileKey) {
    if (!window.profileManager || !state) return;
    window.profileManager.selectProfile(state.selected_provider, key);

    // 填充编辑表单
    const profile = profiles.find((p) => itemKey(p) === key);
    if (profile) {
      setEditingKey(key);
      setDraftName(profile.name);
      setDraftUrl(profile.url);
      setDraftKey(profile.key);
    }

    const runtime = state.runtime_by_profile[key];
    if (runtime) {
      setDraftModel(runtime.model);
      setDraftCwd(runtime.cwd);
      setDraftArgs(runtime.extra_args);
      setDraftMode(runtime.launch_mode);
      setDraftProxy(runtime.proxy);
      setDraftExcludeUser(runtime.exclude_user_settings);
    } else {
      const defaults = defaultRuntimeSettings(state.selected_provider);
      setDraftModel(defaults.model);
      setDraftCwd(defaults.cwd);
      setDraftArgs(defaults.extra_args);
      setDraftMode(defaults.launch_mode);
      setDraftProxy(defaults.proxy);
      setDraftExcludeUser(defaults.exclude_user_settings);
    }
  }

  function handleNewProfile() {
    clearDraft();
    setEditingKey("");
    const defaults = defaultRuntimeSettings(state?.selected_provider ?? PROVIDER_CLAUDE);
    setDraftModel(defaults.model);
    setDraftCwd(defaults.cwd);
    setDraftArgs(defaults.extra_args);
    setDraftMode(defaults.launch_mode);
    setDraftProxy(defaults.proxy);
    setDraftExcludeUser(defaults.exclude_user_settings);
  }

  function clearDraft() {
    setDraftName("");
    setDraftUrl("");
    setDraftKey("");
    setDraftModel("");
    setDraftCwd("");
    setDraftArgs("");
    setDraftMode("direct");
    setDraftProxy("");
    setDraftExcludeUser(true);
  }

  async function handleCloneProfile() {
    if (!window.profileManager || !state?.selected_profile_key) return;
    const targetProv = state.selected_provider === PROVIDER_CLAUDE ? PROVIDER_CODEX : PROVIDER_CLAUDE;
    setIsBusy(true);
    try {
      await window.profileManager.cloneProfile(state.selected_profile_key, targetProv);
      await refreshAll();
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
      await refreshAll();
      setSuccessMessage("Profile 已删除");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "删除失败");
    } finally {
      setIsBusy(false);
    }
  }

  async function handleProviderSwitch(provider: string) {
    if (!window.profileManager) return;
    await window.profileManager.activateProvider(provider);
    await refreshAll();
  }

  async function handleReorder(orderedKeys: ProfileKey[]) {
    if (!window.profileManager || !state) return;
    await window.profileManager.reorderProfiles(state.selected_provider, orderedKeys);
  }

  // ---- 启动操作 ----
  async function handleLaunch(mode: LaunchMode, sessionId?: string) {
    if (!window.profileManager || !state || !state.selected_profile_key) return;
    const runtime = state.runtime_by_profile[state.selected_profile_key] ?? defaultRuntimeSettings(state.selected_provider);

    const request = {
      profile_key: state.selected_profile_key,
      provider: state.selected_provider,
      runtime_settings: { ...runtime, launch_mode: mode },
      session_id: sessionId,
    };

    try {
      await window.profileManager.launch(request);
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
  async function handleLoadSessions() {
    if (!window.profileManager || !state) return;
    const runtime = state.runtime_by_profile[state.selected_profile_key];
    const cwd = runtime?.cwd ?? "";
    try {
      const result = await window.profileManager.listSessions(state.selected_provider, cwd);
      setSessions(result as SessionSummary[]);
    } catch {
      // 忽略
    }
  }

  useEffect(() => {
    if (activeTab === "sessions") {
      handleLoadSessions();
    }
  }, [activeTab]);

  // ---- 全局设置 ----
  async function handleGlobalSettingsChange(settings: Partial<GlobalSettings>) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.updateGlobalSettings(settings);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "保存设置失败");
    }
  }

  // ---- 模型映射 ----
  async function handleAddMapping(entry: Omit<ModelMappingEntry, "id">) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.addModelMapping(entry);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "添加映射失败");
    }
  }

  async function handleUpdateMapping(id: string, update: Partial<ModelMappingEntry>) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.updateModelMapping(id, update);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "更新映射失败");
    }
  }

  async function handleDeleteMapping(id: string) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.deleteModelMapping(id);
      await refreshAll();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "删除映射失败");
    }
  }

  // ---- 参数设置 ----
  async function handleParameterSettingsChange(settings: Partial<ParameterSettings>) {
    if (!window.profileManager) return;
    try {
      await window.profileManager.updateParameterSettings(settings);
      await refreshAll();
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
          <p className="eyebrow">请输入配置密码以解锁 Profile 管理功能</p>
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
            解锁
          </button>
          <button type="button" className="secondary-button" onClick={handleSkipUnlock} disabled={isBusy}>
            跳过（使用空配置）
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
              draft={{ name: draftName, url: draftUrl, key: draftKey }}
              runtime={{
                model: draftModel,
                cwd: draftCwd,
                extra_args: draftArgs,
                launch_mode: draftMode,
                proxy: draftProxy,
                exclude_user_settings: draftExcludeUser,
              }}
              onChange={(field, val) => {
                switch (field) {
                  case "name": setDraftName(val as string); break;
                  case "url": setDraftUrl(val as string); break;
                  case "key": setDraftKey(val as string); break;
                }
              }}
              onRuntimeChange={(field, val) => {
                switch (field) {
                  case "model": setDraftModel(val as string); break;
                  case "cwd": setDraftCwd(val as string); break;
                  case "extra_args": setDraftArgs(val as string); break;
                  case "launch_mode": setDraftMode(val as LaunchMode); break;
                  case "proxy": setDraftProxy(val as string); break;
                  case "exclude_user_settings": setDraftExcludeUser(val as boolean); break;
                }
              }}
              onSave={handleSaveProfile}
              onCancel={handleNewProfile}
              disabled={isBusy}
            />
          </div>

          <div className="profiles-right">
            <LaunchControls
              onDirectLaunch={() => handleLaunch("direct")}
              onContinueLaunch={() => handleLaunch("continue")}
              onResumeLaunch={() => handleLaunch("resume_selected", selectedSessionId)}
              disabled={isBusy || !state?.selected_profile_key}
            />
            <CmdPreview command={previewCmd} valid={previewValid} />
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
              className={`tab-btn ${settingsSubTab === "model-mapping" ? "active" : ""}`}
              onClick={() => setSettingsSubTab("model-mapping")}
            >
              模型映射
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

          {settingsSubTab === "model-mapping" && (
            <ModelMappingPanel
              mappings={state?.model_mappings ?? []}
              onAdd={handleAddMapping}
              onUpdate={handleUpdateMapping}
              onDelete={handleDeleteMapping}
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
