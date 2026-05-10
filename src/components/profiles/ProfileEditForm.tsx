// ProfileEditForm 编辑表单

import { memo, useCallback, useMemo, useState } from "react";
import type {
  AdvancedModelMapping,
  ClaudeModelAliasMode,
  LaunchMode,
  ProviderID,
} from "../../shared/profile/types.js";
import {
  resolveClaudeModelAliasMode,
  shouldRecommendClaudeSingleModelCompatibility,
} from "../../shared/profile/types.js";
import { defaultProfilePermissions, normalizeProfilePermissions, type ProfilePermissions } from "../../shared/profile/permissions.js";
import type { SiteBalanceSession } from "../../shared/balance/site-balance-sessions.js";
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
  siteBalanceSessions: SiteBalanceSession[];
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    user_id: string;
  };
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
  onChange: (field: string, value: string | boolean) => void;
  onPermissionsChange?: (permissions: ProfilePermissions | null) => void;
  onBalanceSessionSelectionChange: (value: string) => void;
  onBalanceSessionDraftChange: (
    field: "label" | "access_token" | "user_id",
    value: string,
  ) => void;
  onSaveBalanceSession?: () => void;
  onDeleteSiteBalanceSession: () => void;
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
  siteBalanceSessions,
  balanceSessionSelection,
  balanceSessionDraft,
  runtime,
  provider,
  globalPermissions,
  modelOptions,
  modelFetchedAt,
  modelFetchBusy,
  modelFetchError,
  modelFetchSuccess,
  onChange,
  onPermissionsChange,
  onBalanceSessionSelectionChange,
  onBalanceSessionDraftChange,
  onSaveBalanceSession,
  onDeleteSiteBalanceSession,
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
  const advancedMapping = draft.advancedModelMapping;
  const claudeAliasMode = resolveClaudeModelAliasMode(advancedMapping);
  const customPermissions = draft.permissions != null;
  const shouldRecommendSingleModelCompat = provider === "claude"
    && shouldRecommendClaudeSingleModelCompatibility(draft.url, draft.selectedModelId)
    && claudeAliasMode !== "single_model_compat";
  const effectiveOnPermissionsChange = onPermissionsChange ?? noopPermissionsChange;
  const displayedPermissions = useMemo(
    () => customPermissions
      ? normalizeProfilePermissions(draft.permissions ?? undefined, provider)
      : normalizeProfilePermissions(globalPermissions, provider),
    [customPermissions, draft.permissions, globalPermissions, provider],
  );
  const editingExistingBalanceSession = useMemo(
    () => Boolean(
      balanceSessionSelection
      && balanceSessionSelection !== "auto"
      && balanceSessionSelection !== "new",
    ),
    [balanceSessionSelection],
  );
  const editingBalanceSession = editingExistingBalanceSession || balanceSessionSelection === "new";
  const modelFetchStatus = useMemo(
    () => [
      modelFetchedAt ? `最近获取：${modelFetchedAt}` : "",
      modelFetchSuccess ?? "",
    ].filter(Boolean).join("，"),
    [modelFetchedAt, modelFetchSuccess],
  );

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
  }, [onChange, onDraftCommit]);

  return (
    <div className="profile-edit-form">
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

      <GlassCard title="模型配置">
        <label>
          <span className="field-title-with-help">
            <span>当前模型 ID</span>
            <span className="field-help">
              当前模型 ID 可选。填写后会按原始 model id 启动 CLI；留空时不注入模型参数，交给 CLI 默认配置处理。
            </span>
          </span>
          <input
            list={`profile-model-options-${provider}`}
            value={draft.selectedModelId}
            onChange={(e) => {
              const nextValue = e.target.value;
              onChange("selectedModelId", nextValue);
              if (modelOptions.includes(nextValue)) {
                onDraftCommit?.("selectedModelId", nextValue);
              }
            }}
            onBlur={() => onDraftCommit?.("selectedModelId")}
            placeholder="可选：站点返回什么 model id，这里就填什么 model id"
            disabled={disabled}
          />
          <datalist id={`profile-model-options-${provider}`}>
            {modelOptions.map((item) => (
              <option key={`${provider}-${item}`} value={item} />
            ))}
          </datalist>
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

      <GlassCard title="站点后台会话" subtitle="仅用于管理面板类站点的余额检测">
        <label>
          后台会话
          <select
            value={balanceSessionSelection}
            onChange={(e) => onBalanceSessionSelectionChange(e.target.value)}
            disabled={disabled}
          >
            <option value="auto">自动</option>
            {siteBalanceSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.label}
              </option>
            ))}
            <option value="new">新建会话</option>
          </select>
        </label>
        {siteBalanceSessions.length === 0 && balanceSessionSelection === "auto" && (
          <p className="muted">
            当前站点还没有后台会话。选择“新建会话”后填写 Access Token / Session 和 User ID。
          </p>
        )}
        {editingBalanceSession && (
          <>
            <div className="mapping-grid">
              <label>
                Access Token / Session
                <input
                  type="password"
                  value={balanceSessionDraft.access_token}
                  onChange={(e) => onBalanceSessionDraftChange("access_token", e.target.value)}
                  placeholder="输入后台 Access Token 或 Session"
                  disabled={disabled}
                />
              </label>
              <label>
                User ID
                <input
                  value={balanceSessionDraft.user_id}
                  onChange={(e) => onBalanceSessionDraftChange("user_id", e.target.value)}
                  placeholder="输入后台 User ID"
                  disabled={disabled}
                />
              </label>
            </div>
            <div className="inline-actions balance-session-actions">
              <button
                type="button"
                className="secondary-button small"
                onClick={() => onSaveBalanceSession?.()}
                disabled={disabled || !onSaveBalanceSession}
              >
                保存会话
              </button>
              {editingExistingBalanceSession && (
                <button
                  type="button"
                  className="secondary-button small danger"
                  onClick={onDeleteSiteBalanceSession}
                  disabled={disabled}
                >
                  删除当前会话
                </button>
              )}
            </div>
          </>
        )}
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

      <GlassCard title="当前配置专属运行时设置">
        <p className="muted">以下字段仅作用于当前配置。代理请在“全局设置”中维护。</p>
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
        <label>
          启动模式
          <select
            value={runtime.launch_mode}
            onChange={(e) => onRuntimeChange("launch_mode", e.target.value)}
            disabled={disabled}
          >
            <option value="new">直接启动（新会话）</option>
            <option value="continue_last">继续当前目录最近会话</option>
            <option value="resume_selected">恢复指定会话</option>
          </select>
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

      {provider === "claude" && (
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
      )}

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
