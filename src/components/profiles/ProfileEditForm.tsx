// ProfileEditForm 编辑表单

import { memo, type ReactNode, useCallback, useMemo, useState } from "react";
import type {
  AdvancedModelMapping,
  ClaudeModelAliasMode,
  DeepSeekReasoningEffort,
  LaunchMode,
  ProviderID,
} from "../../shared/profile/types.js";
import {
  resolveClaudeModelAliasMode,
  shouldRecommendClaudeSingleModelCompatibility,
} from "../../shared/profile/types.js";
import { defaultProfilePermissions, normalizeProfilePermissions, type ProfilePermissions } from "../../shared/profile/permissions.js";
import { GlassCard } from "../common/GlassCard.jsx";
import { PermissionSettingsCard } from "../permissions/PermissionSettingsCard.jsx";

interface ProfileEditFormProps {
  draft: {
    name: string;
    url: string;
    key: string;
    selectedModelId: string;
    advancedModelMapping: AdvancedModelMapping;
    permissions?: ProfilePermissions | null;
  };
  globalPermissions?: ProfilePermissions;
  runtime: {
    cwd: string;
    command_base: string;
    settings_file: string;
    extra_args: string;
    launch_mode: LaunchMode;
    exclude_user_settings: boolean;
  };
  provider: ProviderID;
  modelOptions: string[];
  modelFetchedAt?: string;
  modelFetchBusy?: boolean;
  modelFetchError?: string | null;
  modelFetchSuccess?: string | null;
  commandPreview?: ReactNode;
  onChange: (field: string, value: string | boolean) => void;
  onPermissionsChange?: (permissions: ProfilePermissions | null) => void;
  onDraftCommit?: (field: string, value?: string | boolean) => void;
  onAdvancedModelMappingChange: (next: AdvancedModelMapping) => void;
  onRuntimeChange: (field: string, value: string | boolean) => void;
  onRuntimeCommit?: (field: string) => void;
  onFetchModels: () => void;
  onOpenBaseUrl?: () => void;
  onPickCwd: () => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

const noopPermissionsChange = () => {};
const noopOpenBaseUrl = () => {};

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
  onChange,
  onPermissionsChange,
  onDraftCommit,
  onAdvancedModelMappingChange,
  onRuntimeChange,
  onRuntimeCommit,
  onFetchModels,
  onOpenBaseUrl = noopOpenBaseUrl,
  onPickCwd,
  onSave,
  onCancel,
  disabled,
}: ProfileEditFormProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const advancedMapping = draft.advancedModelMapping;
  const claudeAliasMode = resolveClaudeModelAliasMode(advancedMapping);
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
      modelFetchedAt ? `最近获取：${modelFetchedAt}` : "",
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

  const updateDeepSeekReasoningEffort = useCallback((deepseekReasoningEffort: DeepSeekReasoningEffort) => {
    onAdvancedModelMappingChange({
      ...advancedMapping,
      claude: {
        ...advancedMapping.claude,
        deepseekReasoningEffort,
      },
      codex: {
        ...advancedMapping.codex,
      },
    });
  }, [advancedMapping, onAdvancedModelMappingChange]);

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
    <GlassCard title="Claude 模型兼容设置" subtitle="用于第三方 Anthropic-compatible 网关的 Claude 内部模型别名覆盖">
      <p className="session-meta">主会话模型：{draft.selectedModelId.trim() || "(未设置)"}</p>
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
      <label>
        <span className="field-title-with-help">
          <span>DeepSeek 推理强度</span>
          <span className="field-help">用于 DeepSeek Claude Code 兼容接口，会注入 CLAUDE_CODE_EFFORT_LEVEL。</span>
        </span>
        <select
          value={advancedMapping.claude?.deepseekReasoningEffort ?? "default"}
          onChange={(e) => updateDeepSeekReasoningEffort(e.target.value as DeepSeekReasoningEffort)}
          disabled={disabled}
        >
          <option value="default">默认</option>
          <option value="high">High</option>
          <option value="max">Max</option>
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
                disabled={disabled}
              />
            </label>
            <label>
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
            </label>
            <label>
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
            </label>
          </GlassCard>

          <PermissionSettingsCard
            title="权限"
            provider={provider}
            permissions={displayedPermissions}
            inheritedSummary={customPermissions ? "当前 Profile 使用自定义权限" : "当前 Profile 继承全局默认权限"}
            inherit={!customPermissions}
            onInheritChange={handlePermissionsInheritChange}
            onChange={handlePermissionsChange}
            disabled={disabled}
          />

          {claudeCompatibilityCard}

          {provider === "codex" && (
            <GlassCard title="高级选项" subtitle="默认关闭，仅在确实需要覆盖 Codex 命令行模型时启用">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={advancedMapping.enabled}
                  onChange={(e) => updateAdvancedMapping({ enabled: e.target.checked })}
                  disabled={disabled}
                />
                启用高级模型别名映射
              </label>
              <label>
                Codex 命令行模型覆盖
                <input
                  value={advancedMapping.codex?.commandLineModelOverride ?? ""}
                  onChange={(e) => updateAdvancedMapping({ enabled: true, codex: { commandLineModelOverride: e.target.value } })}
                  placeholder="可选：仅在需要显式追加 --model 时填写"
                  disabled={disabled || !advancedMapping.enabled}
                />
              </label>
            </GlassCard>
          )}
        </div>

        <div className="profile-edit-column profile-edit-column-secondary">
          <GlassCard title="模型配置" className="model-config-card">
            <label>
              <span className="field-title-with-help">
                <span>当前模型 ID</span>
                <span className="field-help">
                  当前模型 ID 可选。填写后会按原始 model id 启动 CLI；留空时不注入模型参数，交给 CLI 默认配置处理。
                </span>
              </span>
              <div className="model-picker">
                <input
                  value={draft.selectedModelId}
                  onChange={(e) => {
                    handleSelectedModelChange(e.target.value);
                    setModelPickerOpen(true);
                  }}
                  onFocus={() => {
                    if (!disabled && modelOptions.length > 0) {
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
                  disabled={disabled}
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
            <div className="inline-actions" style={{flexWrap: "nowrap"}}>
              <button type="button" className="secondary-button small" onClick={onFetchModels} disabled={disabled || modelFetchBusy}>
                {modelFetchBusy ? "获取中..." : "获取模型列表"}
              </button>
              {draft.selectedModelId && (
                <button type="button" className="secondary-button small" onClick={handleClearSelectedModel} disabled={disabled}>
                  清除
                </button>
              )}
              {modelFetchStatus && <span className="muted" style={{whiteSpace: "nowrap"}}>{modelFetchStatus}</span>}
            </div>
            {modelFetchError && <div className="banner error">{modelFetchError}</div>}
          </GlassCard>

          <GlassCard title="当前配置专属运行时设置">
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
            {provider === "claude" && (
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
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={runtime.exclude_user_settings}
                onChange={(e) => onRuntimeChange("exclude_user_settings", e.target.checked)}
                disabled={disabled}
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
