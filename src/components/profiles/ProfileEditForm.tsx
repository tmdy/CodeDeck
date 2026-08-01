// ProfileEditForm 编辑表单

import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import type {
  AdvancedModelMapping,
  ClaudeModelAliasMode,
  ClaudeReasoningEffort,
  CodexReasoningEffort,
  LaunchMode,
  ProfileChannel,
  ProviderID,
} from "../../shared/profile/types.js";
import {
  CLAUDE_REASONING_EFFORTS,
  CODEX_REASONING_EFFORTS,
  normalizeClaudeReasoningEffort,
  normalizeCodexReasoningEffort,
  resolveClaudeModelAliasMode,
  shouldRecommendClaudeSingleModelCompatibility,
  isOfficialNativeProfile,
} from "../../shared/profile/types.js";
import { parseRuntimeEnvText } from "../../shared/profile/runtime-env.js";
import { defaultProfilePermissions, normalizeProfilePermissions, type ProfilePermissions } from "../../shared/profile/permissions.js";
import { GlassCard } from "../common/GlassCard.jsx";
import { PermissionSettingsCard } from "../permissions/PermissionSettingsCard.jsx";

interface ProfileEditFormProps {
  draft: {
    name: string;
    url: string;
    key: string;
    selectedModelId: string;
    channels?: ProfileChannel[];
    activeChannelId?: string;
    advancedModelMapping: AdvancedModelMapping;
    permissions?: ProfilePermissions | null;
  };
  globalPermissions?: ProfilePermissions;
  runtime: {
    cwd: string;
    command_base: string;
    settings_file: string;
    extra_args: string;
    extra_env?: Record<string, string>;
    launch_mode: LaunchMode;
    exclude_user_settings: boolean;
    startup_mode?: "managed" | "native";
  };
  provider: ProviderID;
  modelOptions: string[];
  modelFetchedAt?: string;
  modelFetchBusy?: boolean;
  modelFetchError?: string | null;
  modelFetchSuccess?: string | null;
  commandPreview?: ReactNode;
  workingDirectoryFavorites?: string[];
  onChange: (field: string, value: string | boolean) => void;
  onChannelsChange?: (channels: ProfileChannel[], activeChannelId: string) => void;
  onPermissionsChange?: (permissions: ProfilePermissions | null) => void;
  onDraftCommit?: (field: string, value?: string | boolean) => void;
  onAdvancedModelMappingChange: (next: AdvancedModelMapping) => void;
  onRuntimeChange: (field: string, value: string | boolean | Record<string, string>) => void;
  onRuntimeCommit?: (field: string) => void;
  onFetchModels: () => void;
  onOpenBaseUrl?: () => void;
  onPickCwd: () => void;
  onToggleWorkingDirectoryFavorite?: () => void;
  onSelectWorkingDirectoryFavorite?: (path: string) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

const noopPermissionsChange = () => {};
const noopOpenBaseUrl = () => {};
const noopToggleWorkingDirectoryFavorite = () => {};
const noopSelectWorkingDirectoryFavorite = () => {};
const beijingDateTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

export const ProfileEditForm = memo(function ProfileEditForm({
  draft,
  runtime,
  provider,
  globalPermissions,
  modelOptions,
  modelFetchedAt,
  modelFetchBusy,
  modelFetchError,
  modelFetchSuccess,
  commandPreview,
  workingDirectoryFavorites = [],
  onChange,
  onChannelsChange,
  onPermissionsChange,
  onDraftCommit,
  onAdvancedModelMappingChange,
  onRuntimeChange,
  onRuntimeCommit,
  onFetchModels,
  onOpenBaseUrl = noopOpenBaseUrl,
  onPickCwd,
  onToggleWorkingDirectoryFavorite = noopToggleWorkingDirectoryFavorite,
  onSelectWorkingDirectoryFavorite = noopSelectWorkingDirectoryFavorite,
  onSave,
  onCancel,
  disabled,
}: ProfileEditFormProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [bulkEnvOpen, setBulkEnvOpen] = useState(false);
  const [bulkEnvText, setBulkEnvText] = useState("");
  const [bulkEnvStatus, setBulkEnvStatus] = useState("");
  const advancedMapping = draft.advancedModelMapping;
  const isNativeStartup = isOfficialNativeProfile({ provider, name: draft.name });
  const claudeAliasMode = resolveClaudeModelAliasMode(advancedMapping);
  const reasoningEffort = provider === "claude"
    ? normalizeClaudeReasoningEffort(advancedMapping.claude?.reasoningEffort)
    : normalizeCodexReasoningEffort(advancedMapping.codex?.reasoningEffort);
  const reasoningEffortOptions = provider === "claude"
    ? CLAUDE_REASONING_EFFORTS
    : CODEX_REASONING_EFFORTS;
  const customPermissions = draft.permissions != null;
  const shouldRecommendSingleModelCompat = provider === "claude"
    && shouldRecommendClaudeSingleModelCompatibility(draft.url, draft.selectedModelId)
    && claudeAliasMode === "none";
  const effectiveOnPermissionsChange = onPermissionsChange ?? noopPermissionsChange;
  const displayedPermissions = useMemo(
    () => customPermissions
      ? normalizeProfilePermissions(draft.permissions ?? undefined, provider)
      : normalizeProfilePermissions(globalPermissions, provider),
    [customPermissions, draft.permissions, globalPermissions, provider],
  );
  const modelFetchStatus = useMemo(
    () => [
      modelFetchedAt ? `最近获取：${formatBeijingDateTime(modelFetchedAt)}` : "",
      modelFetchSuccess ?? "",
    ].filter(Boolean).join("，"),
    [modelFetchedAt, modelFetchSuccess],
  );
  const modelPickerListId = `profile-model-picker-${provider}`;
  const filteredModelOptions = useMemo(() => {
    const keyword = draft.selectedModelId.trim().toLowerCase();
    if (!keyword) {
      return modelOptions;
    }
    return modelOptions.filter((item) => item.toLowerCase().includes(keyword));
  }, [draft.selectedModelId, modelOptions]);
  const showModelPicker = modelPickerOpen && !disabled && modelOptions.length > 0;
  const runtimeEnv = runtime.extra_env ?? {};
  const runtimeEnvEntries = Object.entries(runtimeEnv);
  const normalizedCwd = runtime.cwd.trim();
  const cwdIsFavorite = normalizedCwd
    ? workingDirectoryFavorites.includes(normalizedCwd)
    : false;
  const favoriteButtonLabel = cwdIsFavorite ? "取消收藏当前工作目录" : "收藏当前工作目录";
  const channels = draft.channels?.length
    ? draft.channels
    : [{ id: "default", name: "默认渠道", key: draft.key, selectedModelId: draft.selectedModelId }];
  const activeChannelId = draft.activeChannelId ?? channels[0]?.id ?? "default";
  const activeChannel = channels.find((channel) => channel.id === activeChannelId)
    ?? channels[0];

  const selectChannel = useCallback((channelId: string) => {
    onChannelsChange?.(channels, channelId);
  }, [channels, onChannelsChange]);

  const addChannel = useCallback(() => {
    const channel: ProfileChannel = {
      id: createChannelId(),
      name: `渠道 ${channels.length + 1}`,
      key: "",
    };
    onChannelsChange?.([...channels, channel], channel.id);
  }, [channels, onChannelsChange]);

  const renameActiveChannel = useCallback((name: string) => {
    if (!activeChannel) return;
    onChannelsChange?.(
      channels.map((channel) => channel.id === activeChannel.id
        ? { ...channel, name }
        : channel),
      activeChannel.id,
    );
  }, [activeChannel, channels, onChannelsChange]);

  const removeActiveChannel = useCallback(() => {
    if (!activeChannel || channels.length <= 1) return;
    const nextChannels = channels.filter((channel) => channel.id !== activeChannel.id);
    onChannelsChange?.(nextChannels, nextChannels[0]?.id ?? "");
  }, [activeChannel, channels, onChannelsChange]);

  const updateRuntimeEnvKey = useCallback((currentKey: string, nextKey: string, value: string) => {
    const nextEnv = { ...runtimeEnv };
    delete nextEnv[currentKey];
    nextEnv[nextKey] = value;
    onRuntimeChange("extra_env", nextEnv);
  }, [onRuntimeChange, runtimeEnv]);

  const updateRuntimeEnvValue = useCallback((key: string, value: string) => {
    onRuntimeChange("extra_env", {
      ...runtimeEnv,
      [key]: value,
    });
  }, [onRuntimeChange, runtimeEnv]);

  const addRuntimeEnv = useCallback(() => {
    onRuntimeChange("extra_env", {
      ...runtimeEnv,
      "": "",
    });
  }, [onRuntimeChange, runtimeEnv]);

  const removeRuntimeEnv = useCallback((key: string) => {
    const nextEnv = { ...runtimeEnv };
    delete nextEnv[key];
    onRuntimeChange("extra_env", nextEnv);
  }, [onRuntimeChange, runtimeEnv]);

  const cancelBulkEnvImport = useCallback(() => {
    setBulkEnvOpen(false);
    setBulkEnvText("");
    setBulkEnvStatus("");
  }, []);

  const importBulkRuntimeEnv = useCallback(() => {
    const parsed = parseRuntimeEnvText(bulkEnvText);
    const importedCount = Object.keys(parsed.values).length;

    if (importedCount > 0) {
      onRuntimeChange("extra_env", {
        ...runtimeEnv,
        ...parsed.values,
      });
    }

    if (parsed.invalidLineNumbers.length > 0) {
      const prefix = importedCount > 0 ? `已导入 ${importedCount} 项，` : "未导入任何项目，";
      setBulkEnvStatus(`${prefix}已跳过第 ${parsed.invalidLineNumbers.join("、")} 行。`);
      return;
    }

    setBulkEnvOpen(false);
    setBulkEnvText("");
    setBulkEnvStatus("");
  }, [bulkEnvText, onRuntimeChange, runtimeEnv]);

  const updateAdvancedMapping = useCallback((changes: Partial<AdvancedModelMapping>) => {
    onAdvancedModelMappingChange({
      ...advancedMapping,
      ...changes,
      claude: {
        ...advancedMapping.claude,
        ...(changes.claude ?? {}),
      },
      codex: {
        ...advancedMapping.codex,
        ...(changes.codex ?? {}),
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange]);

  const updateClaudeAliasMode = useCallback((aliasMode: ClaudeModelAliasMode) => {
    onAdvancedModelMappingChange({
      ...advancedMapping,
      enabled: aliasMode !== "none" || (provider === "codex" && advancedMapping.enabled),
      claude: {
        ...advancedMapping.claude,
        aliasMode,
      },
      codex: {
        ...advancedMapping.codex,
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange, provider]);

  const updateClaudeAliasTarget = useCallback((field: "defaultTarget" | "opusTarget" | "sonnetTarget" | "haikuTarget" | "subagentTarget", value: string) => {
    onAdvancedModelMappingChange({
      ...advancedMapping,
      enabled: true,
      claude: {
        ...advancedMapping.claude,
        aliasMode: "custom",
        [field]: value,
      },
      codex: {
        ...advancedMapping.codex,
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange]);

  const updateReasoningEffort = useCallback((value: string) => {
    if (provider === "claude") {
      onAdvancedModelMappingChange({
        ...advancedMapping,
        claude: {
          ...advancedMapping.claude,
          reasoningEffort: normalizeClaudeReasoningEffort(value) as ClaudeReasoningEffort | "",
        },
        codex: {
          ...advancedMapping.codex,
        },
      });
      return;
    }

    onAdvancedModelMappingChange({
      ...advancedMapping,
      claude: {
        ...advancedMapping.claude,
      },
      codex: {
        ...advancedMapping.codex,
        reasoningEffort: normalizeCodexReasoningEffort(value) as CodexReasoningEffort | "",
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange, provider]);

  const applyRecommendedClaudeCompatibility = useCallback(() => {
    onAdvancedModelMappingChange({
      ...advancedMapping,
      enabled: true,
      claude: {
        ...advancedMapping.claude,
        aliasMode: "single_model_compat",
      },
      codex: {
        ...advancedMapping.codex,
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange]);

  const handlePermissionsInheritChange = useCallback((inherit: boolean) => {
    effectiveOnPermissionsChange(
      inherit
        ? null
        : normalizeProfilePermissions(
          draft.permissions ?? globalPermissions ?? defaultProfilePermissions(provider),
          provider,
        ),
    );
  }, [draft.permissions, effectiveOnPermissionsChange, globalPermissions, provider]);

  const handlePermissionsChange = useCallback((permissions: ProfilePermissions) => {
    effectiveOnPermissionsChange(permissions);
  }, [effectiveOnPermissionsChange]);

  const handleClearSelectedModel = useCallback(() => {
    onChange("selectedModelId", "");
    onDraftCommit?.("selectedModelId", "");
    setModelPickerOpen(false);
  }, [onChange, onDraftCommit]);

  const handleSelectedModelChange = useCallback((value: string) => {
    onChange("selectedModelId", value);
    if (modelOptions.includes(value)) {
      onDraftCommit?.("selectedModelId", value);
    }
  }, [modelOptions, onChange, onDraftCommit]);

  const handleModelOptionSelect = useCallback((value: string) => {
    onChange("selectedModelId", value);
    onDraftCommit?.("selectedModelId", value);
    setModelPickerOpen(false);
  }, [onChange, onDraftCommit]);

  const claudeCompatibilityCard = provider === "claude" ? (
    <GlassCard title="Claude 模型兼容设置">
      {shouldRecommendSingleModelCompat && (
        <div className="banner warning">
          当前模型 {draft.selectedModelId.trim()} 看起来是第三方模型。Claude Code 内部子代理可能仍调用 haiku/sonnet/opus alias，建议开启“第三方单模型兼容模式”。
          <div className="inline-actions">
            <button
              type="button"
              className="secondary-button small"
              onClick={applyRecommendedClaudeCompatibility}
              disabled={disabled}
            >
              应用推荐设置
            </button>
          </div>
        </div>
      )}
      <label>
        模型别名模式
        <select
          value={claudeAliasMode}
          onChange={(e) => updateClaudeAliasMode(e.target.value as ClaudeModelAliasMode)}
          disabled={disabled}
        >
          <option value="none">无覆盖</option>
          <option value="single_model_compat">第三方单模型兼容模式</option>
          <option value="custom">高级自定义</option>
        </select>
      </label>
      {claudeAliasMode === "custom" && (
        <div className="mapping-grid">
          <label>
            Default alias
            <input
              value={advancedMapping.claude?.defaultTarget ?? ""}
              onChange={(e) => updateClaudeAliasTarget("defaultTarget", e.target.value)}
              placeholder="可选：覆盖 ANTHROPIC_MODEL"
              disabled={disabled}
            />
          </label>
          <label>
            Opus alias
            <input
              value={advancedMapping.claude?.opusTarget ?? ""}
              onChange={(e) => updateClaudeAliasTarget("opusTarget", e.target.value)}
              placeholder={draft.selectedModelId || "例如 glm-5.1"}
              disabled={disabled}
            />
          </label>
          <label>
            Sonnet alias
            <input
              value={advancedMapping.claude?.sonnetTarget ?? ""}
              onChange={(e) => updateClaudeAliasTarget("sonnetTarget", e.target.value)}
              placeholder={draft.selectedModelId || "例如 glm-5.1"}
              disabled={disabled}
            />
          </label>
          <label>
            Haiku alias
            <input
              value={advancedMapping.claude?.haikuTarget ?? ""}
              onChange={(e) => updateClaudeAliasTarget("haikuTarget", e.target.value)}
              placeholder={draft.selectedModelId || "例如 glm-5.1-fast"}
              disabled={disabled}
            />
          </label>
          <label>
            Subagent
            <input
              value={advancedMapping.claude?.subagentTarget ?? ""}
              onChange={(e) => updateClaudeAliasTarget("subagentTarget", e.target.value)}
              placeholder={draft.selectedModelId || "例如 glm-5.1"}
              disabled={disabled}
            />
          </label>
        </div>
      )}
    </GlassCard>
  ) : null;

  return (
    <div className="profile-edit-form">
      <div className="profile-edit-main-grid">
        <div className="profile-edit-column profile-edit-column-primary">
          <GlassCard title="Profile 信息">
            <label>
              名称
              <input
                value={draft.name}
                onChange={(e) => onChange("name", e.target.value)}
                placeholder="输入 Profile 名称"
                disabled={disabled || isNativeStartup}
              />
            </label>
            {!isNativeStartup && <label>
              Base URL
              <div className="path-field">
                <input
                  value={draft.url}
                  onChange={(e) => onChange("url", e.target.value)}
                  placeholder="https://api.example.com"
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onOpenBaseUrl}
                  disabled={disabled || !draft.url.trim()}
                >
                  打开
                </button>
              </div>
            </label>}
            {!isNativeStartup && <div className="profile-channel-editor">
              <label>
                当前渠道
                <div className="path-field">
                  <select
                    value={activeChannel?.id ?? ""}
                    onChange={(event) => selectChannel(event.target.value)}
                    disabled={disabled}
                    aria-label="当前渠道"
                  >
                    {channels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name || "未命名渠道"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={addChannel}
                    disabled={disabled}
                    aria-label="添加渠道"
                    title="添加渠道"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="secondary-button icon-button"
                    onClick={removeActiveChannel}
                    disabled={disabled || channels.length <= 1}
                    aria-label="删除当前渠道"
                    title="删除当前渠道"
                  >
                    ×
                  </button>
                </div>
              </label>
              <label>
                渠道名称
                <input
                  value={activeChannel?.name ?? ""}
                  onChange={(event) => renameActiveChannel(event.target.value)}
                  placeholder="输入渠道名称"
                  disabled={disabled}
                />
              </label>
            </div>}
            {!isNativeStartup && <label>
              API Key / Token
              <div className="secret-field">
                <input
                  type={showApiKey ? "text" : "password"}
                  value={draft.key}
                  onChange={(e) => onChange("key", e.target.value)}
                  placeholder="输入 API Key"
                  disabled={disabled}
                />
                <button
                  type="button"
                  className="secondary-button secret-toggle"
                  aria-label={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  title={showApiKey ? "隐藏 API Key" : "显示 API Key"}
                  onClick={() => setShowApiKey((visible) => !visible)}
                  disabled={disabled}
                >
                  {showApiKey ? "◉" : "◎"}
                </button>
              </div>
            </label>}
          </GlassCard>

          {!isNativeStartup && <PermissionSettingsCard
            title="权限"
            provider={provider}
            permissions={displayedPermissions}
            inheritedSummary={customPermissions ? "当前 Profile 使用自定义权限" : "当前 Profile 继承全局默认权限"}
            inherit={!customPermissions}
            onInheritChange={handlePermissionsInheritChange}
            onChange={handlePermissionsChange}
            disabled={disabled}
          />}

          {!isNativeStartup && claudeCompatibilityCard}

          {!isNativeStartup && provider === "codex" && (
            <GlassCard title="Codex 子代理模型映射" subtitle="默认关闭；启用后仅覆盖 Codex 内置 worker 子代理的模型">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={advancedMapping.enabled}
                  onChange={(e) => updateAdvancedMapping({ enabled: e.target.checked })}
                  disabled={disabled}
                />
                启用子代理模型映射
              </label>
              <label>
                子代理模型
                <input
                  value={advancedMapping.codex?.subagentTarget ?? ""}
                  onChange={(e) => updateAdvancedMapping({ enabled: true, codex: { subagentTarget: e.target.value } })}
                  placeholder={draft.selectedModelId || "例如 gpt-5.6-terra"}
                  disabled={disabled || !advancedMapping.enabled}
                />
              </label>
            </GlassCard>
          )}
        </div>

        <div className="profile-edit-column profile-edit-column-secondary">
          {!isNativeStartup && <GlassCard title="模型配置" className="model-config-card">
            <label>
              <span>当前模型 ID</span>
              <div className="model-picker">
                <input
                  value={draft.selectedModelId}
                  onChange={(e) => {
                    handleSelectedModelChange(e.target.value);
                    setModelPickerOpen(true);
                  }}
                  onFocus={() => {
                    if (!disabled && !isNativeStartup && modelOptions.length > 0) {
                      setModelPickerOpen(true);
                    }
                  }}
                  onBlur={() => {
                    onDraftCommit?.("selectedModelId");
                    setModelPickerOpen(false);
                  }}
                  role="combobox"
                  aria-expanded={showModelPicker}
                  aria-controls={modelPickerListId}
                  aria-autocomplete="list"
                  placeholder="可选：站点返回什么 model id，这里就填什么 model id"
                  disabled={disabled || isNativeStartup}
                />
                {showModelPicker && (
                  <div
                    id={modelPickerListId}
                    className="model-picker-list"
                    role="listbox"
                    aria-label="模型 ID 候选列表"
                  >
                    {filteredModelOptions.length > 0 ? (
                      filteredModelOptions.map((item) => (
                        <button
                          key={`${provider}-${item}`}
                          type="button"
                          className="model-picker-option"
                          role="option"
                          aria-selected={item === draft.selectedModelId}
                          title={item}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            handleModelOptionSelect(item);
                          }}
                        >
                          {item}
                        </button>
                      ))
                    ) : (
                      <div className="model-picker-empty">无匹配模型，可继续手动输入</div>
                    )}
                  </div>
                )}
              </div>
            </label>
            <label>
              思考等级
              <select
                value={reasoningEffort}
                onChange={(e) => updateReasoningEffort(e.target.value)}
                disabled={disabled || isNativeStartup}
              >
                <option value="">沿用默认</option>
                {reasoningEffortOptions.map((item) => (
                  <option key={`${provider}-reasoning-${item}`} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <div className="inline-actions model-fetch-actions">
              <button type="button" className="secondary-button small" onClick={onFetchModels} disabled={disabled || isNativeStartup || modelFetchBusy}>
                {modelFetchBusy ? "获取中..." : "获取模型列表"}
              </button>
              {draft.selectedModelId && (
                <button type="button" className="secondary-button small" onClick={handleClearSelectedModel} disabled={disabled || isNativeStartup}>
                  清除
                </button>
              )}
              {modelFetchStatus && <span className="muted model-fetch-status">{modelFetchStatus}</span>}
            </div>
            {modelFetchError && <div className="banner error">{modelFetchError}</div>}
          </GlassCard>}

          <GlassCard title="当前配置专属运行时设置" className="profile-runtime-card">
            <label>
              工作目录
              <div className="path-field">
                <input
                  value={runtime.cwd}
                  onChange={(e) => onRuntimeChange("cwd", e.target.value)}
                  onBlur={() => onRuntimeCommit?.("cwd")}
                  placeholder="默认使用下载目录"
                  disabled={disabled}
                />
                <button
                  type="button"
                  className={`secondary-button icon-button ${cwdIsFavorite ? "active" : ""}`}
                  aria-label={favoriteButtonLabel}
                  title={favoriteButtonLabel}
                  onClick={onToggleWorkingDirectoryFavorite}
                  disabled={disabled || !normalizedCwd}
                >
                  {cwdIsFavorite ? "★" : "☆"}
                </button>
                {workingDirectoryFavorites.length > 0 && (
                  <select
                    aria-label="选择收藏的工作目录"
                    value=""
                    onChange={(event) => {
                      const selectedPath = event.target.value;
                      if (selectedPath) {
                        onSelectWorkingDirectoryFavorite(selectedPath);
                      }
                    }}
                    disabled={disabled}
                  >
                    <option value="">收藏</option>
                    {workingDirectoryFavorites.map((path) => (
                      <option key={path} value={path}>
                        {path}
                      </option>
                    ))}
                  </select>
                )}
                <button type="button" className="secondary-button" onClick={onPickCwd} disabled={disabled}>
                  选择
                </button>
              </div>
            </label>
            <label>
              命令基座
              <input
                value={runtime.command_base}
                onChange={(e) => onRuntimeChange("command_base", e.target.value)}
                placeholder="例如 claude 或 codex"
                disabled={disabled}
              />
            </label>
            {provider === "claude" && !isNativeStartup && (
              <label>
                自定义 Claude settings 文件
                <input
                  value={runtime.settings_file}
                  onChange={(e) => onRuntimeChange("settings_file", e.target.value)}
                  placeholder="可选：例如 C:/Users/you/.claude/settings.local.json"
                  disabled={disabled}
                />
              </label>
            )}
            <label>
              额外参数
              <input
                value={runtime.extra_args}
                onChange={(e) => onRuntimeChange("extra_args", e.target.value)}
                placeholder="其他 CLI 参数"
                disabled={disabled}
              />
            </label>
            <div className="profile-runtime-env-section">
              <span>环境变量</span>
              {runtimeEnvEntries.length > 0 && (
                <div className="profile-runtime-env-list">
                  {runtimeEnvEntries.map(([key, value]) => (
                    <div key={key} className="profile-runtime-env-row">
                      <input
                        value={key}
                        onChange={(e) => updateRuntimeEnvKey(key, e.target.value, value)}
                        placeholder="变量名"
                        disabled={disabled}
                      />
                      <input
                        value={value}
                        onChange={(e) => updateRuntimeEnvValue(key, e.target.value)}
                        placeholder="变量值"
                        disabled={disabled}
                      />
                      <button
                        type="button"
                        className="secondary-button small"
                        onClick={() => removeRuntimeEnv(key)}
                        disabled={disabled}
                      >
                        删除
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="profile-runtime-env-actions">
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={addRuntimeEnv}
                  disabled={disabled}
                >
                  添加环境变量
                </button>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => {
                    setBulkEnvOpen(true);
                    setBulkEnvStatus("");
                  }}
                  disabled={disabled || bulkEnvOpen}
                >
                  批量粘贴
                </button>
              </div>
              {bulkEnvOpen && (
                <div className="profile-runtime-env-import">
                  <label>
                    批量内容
                    <textarea
                      value={bulkEnvText}
                      onChange={(event) => {
                        setBulkEnvText(event.target.value);
                        setBulkEnvStatus("");
                      }}
                      placeholder={"HTTP_PROXY=http://127.0.0.1:10808\nHTTPS_PROXY=http://127.0.0.1:10808"}
                      autoFocus
                      disabled={disabled}
                    />
                  </label>
                  {bulkEnvStatus && (
                    <p className="profile-runtime-env-import-status" role="status">
                      {bulkEnvStatus}
                    </p>
                  )}
                  <div className="profile-runtime-env-import-actions">
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={cancelBulkEnvImport}
                      disabled={disabled}
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      className="small"
                      onClick={importBulkRuntimeEnv}
                      disabled={disabled || !bulkEnvText.trim()}
                    >
                      导入
                    </button>
                  </div>
                </div>
              )}
            </div>
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={runtime.exclude_user_settings}
                onChange={(e) => onRuntimeChange("exclude_user_settings", e.target.checked)}
                disabled={disabled || isNativeStartup}
              />
              排除用户级设置
            </label>
          </GlassCard>
          {commandPreview}
        </div>
      </div>

      <div className="form-actions">
        <button type="button" onClick={onSave} disabled={disabled}>
          保存
        </button>
        <button type="button" className="secondary-button" onClick={onCancel} disabled={disabled}>
          取消
        </button>
      </div>
    </div>
  );
});

function createChannelId(): string {
  return globalThis.crypto?.randomUUID?.()
    ?? `channel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatBeijingDateTime(value: string): string {
  const normalized = value.trim();
  const legacyMatch = normalized.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})[T ](\d{1,2}):(\d{1,2}):(\d{1,2})(?:\.\d+)?$/,
  );
  if (legacyMatch) {
    const [year, month, day, hour, minute, second] = legacyMatch.slice(1).map(Number);
    const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    const valid = candidate.getUTCFullYear() === year
      && candidate.getUTCMonth() === month - 1
      && candidate.getUTCDate() === day
      && candidate.getUTCHours() === hour
      && candidate.getUTCMinutes() === minute
      && candidate.getUTCSeconds() === second;
    if (valid) {
      return `${year}年${padDatePart(month)}月${padDatePart(day)}日 ${padDatePart(hour)}:${padDatePart(minute)}:${padDatePart(second)}`;
    }
  }

  const timestamp = Date.parse(normalized);
  if (!Number.isFinite(timestamp)) {
    return value;
  }
  const parts = Object.fromEntries(
    beijingDateTimeFormatter.formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]),
  );
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}:${parts.second}`;
}

function padDatePart(value: number): string {
  return value.toString().padStart(2, "0");
}
