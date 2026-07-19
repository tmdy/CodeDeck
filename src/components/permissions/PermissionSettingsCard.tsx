import { memo, useCallback, useMemo } from "react";
import {
  CLAUDE_PERMISSION_MODES,
  defaultProfilePermissions,
  normalizeProfilePermissions,
  type CodexApprovalPolicy,
  type CodexSandboxMode,
  type ClaudePermissionMode,
  type ProfilePermissions,
  type ProfilePermissionsInput,
} from "../../shared/profile/permissions.js";
import type { ProviderID } from "../../shared/profile/types.js";
import { GlassCard } from "../common/GlassCard.jsx";

const claudeModeDescriptions: Record<ClaudePermissionMode, string> = {
  plan: "只读/规划",
  manual: "手动确认，安全默认",
  acceptEdits: "自动接受编辑",
  dontAsk: "不询问",
  bypassPermissions: "跳过权限检查",
};

const codexPermissionOptions: Array<{
  sandboxMode: CodexSandboxMode;
  approvalPolicy: CodexApprovalPolicy;
  description: string;
}> = [
  { sandboxMode: "read-only", approvalPolicy: "on-request", description: "只读/规划" },
  { sandboxMode: "workspace-write", approvalPolicy: "on-request", description: "安全默认" },
  { sandboxMode: "workspace-write", approvalPolicy: "untrusted", description: "仅信任命令自动执行" },
  { sandboxMode: "workspace-write", approvalPolicy: "never", description: "工作区可写但不询问" },
  { sandboxMode: "danger-full-access", approvalPolicy: "never", description: "全权限" },
];

interface PermissionSettingsCardProps {
  title: string;
  provider: ProviderID;
  permissions: ProfilePermissions;
  onChange: (permissions: ProfilePermissions) => void;
  disabled?: boolean;
  inheritedSummary?: string;
  inherit?: boolean;
  onInheritChange?: (inherit: boolean) => void;
}

export const PermissionSettingsCard = memo(function PermissionSettingsCard({
  title,
  provider,
  permissions,
  onChange,
  disabled,
  inheritedSummary,
  inherit,
  onInheritChange,
}: PermissionSettingsCardProps) {
  const normalized = useMemo(
    () => normalizeProfilePermissions(permissions, provider),
    [permissions, provider],
  );
  const controlsDisabled = disabled || inherit === true;
  const permissionValue = useMemo(() => {
    if (normalized.provider === "codex") {
      return `${normalized.sandboxMode}|${normalized.approvalPolicy}`;
    }
    return normalized.mode;
  }, [normalized]);

  const fullAccessSelected = normalized.provider === "codex"
    ? normalized.sandboxMode === "danger-full-access"
    : normalized.mode === "bypassPermissions";

  const update = useCallback((next: ProfilePermissionsInput) => {
    onChange(normalizeProfilePermissions({ ...normalized, ...next } as ProfilePermissionsInput, provider));
  }, [normalized, onChange, provider]);

  const updateCommon = useCallback((field: keyof ProfilePermissions["common"], value: boolean | string[]) => {
    update({
      common: {
        ...normalized.common,
        [field]: value,
      },
    });
  }, [normalized.common, update]);

  return (
    <GlassCard title={title} subtitle={inheritedSummary} className="permission-settings-card">
      {onInheritChange && (
        <div className="segmented-control" role="group" aria-label="权限继承方式">
          <button
            type="button"
            className={inherit ? "active" : ""}
            aria-pressed={inherit === true}
            onClick={() => onInheritChange(true)}
            disabled={disabled}
          >
            继承全局
          </button>
          <button
            type="button"
            className={!inherit ? "active" : ""}
            aria-pressed={inherit !== true}
            onClick={() => onInheritChange(false)}
            disabled={disabled}
          >
            自定义
          </button>
        </div>
      )}

      <label>
        {provider === "codex" ? "Codex sandbox / approval" : "Claude Code permission-mode"}
        <select
          value={permissionValue}
          onChange={(e) => {
            if (provider === "codex") {
              const [sandboxMode, approvalPolicy] = e.target.value.split("|") as [CodexSandboxMode, CodexApprovalPolicy];
              update({
                sandboxMode,
                approvalPolicy,
                fullAccessConfirmed: sandboxMode === "danger-full-access" ? false : normalized.fullAccessConfirmed,
              });
              return;
            }
            const mode = e.target.value as ClaudePermissionMode;
            update({
              mode,
              fullAccessConfirmed: mode === "bypassPermissions" ? false : normalized.fullAccessConfirmed,
            });
          }}
          disabled={controlsDisabled}
        >
          {provider === "codex"
            ? codexPermissionOptions.map((option) => {
              const value = `${option.sandboxMode}|${option.approvalPolicy}`;
              return (
                <option key={value} value={value}>
                  {option.sandboxMode} + {option.approvalPolicy}（{option.description}）
                </option>
              );
            })
            : CLAUDE_PERMISSION_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {mode}（{claudeModeDescriptions[mode]}）
              </option>
            ))}
        </select>
      </label>

      {fullAccessSelected && (
        <label className="checkbox-label danger-text">
          <input
            type="checkbox"
            checked={normalized.fullAccessConfirmed ?? false}
            onChange={(e) => update({ fullAccessConfirmed: e.target.checked })}
            disabled={controlsDisabled}
          />
          我确认启用全权限模式
        </label>
      )}

      <div className="permission-common-grid">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={normalized.common.denyEnvFiles}
            onChange={(e) => updateCommon("denyEnvFiles", e.target.checked)}
            disabled={controlsDisabled}
          />
          禁读 env/key 文件
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={normalized.common.denyGitPush}
            onChange={(e) => updateCommon("denyGitPush", e.target.checked)}
            disabled={controlsDisabled}
          />
          禁止 git push
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={normalized.common.denyDangerousDelete}
            onChange={(e) => updateCommon("denyDangerousDelete", e.target.checked)}
            disabled={controlsDisabled}
          />
          禁止危险删除
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={normalized.common.allowNetwork}
            onChange={(e) => updateCommon("allowNetwork", e.target.checked)}
            disabled={controlsDisabled}
          />
          允许联网
        </label>
      </div>

      <label>
        额外可写目录
        <input
          value={normalized.common.additionalWritableRoots.join("; ")}
          onChange={(e) => updateCommon("additionalWritableRoots", e.target.value.split(";"))}
          placeholder="例如 C:/shared; D:/workspace"
          disabled={controlsDisabled}
        />
      </label>
    </GlassCard>
  );
});

export function emptyPermissionsForProvider(provider: ProviderID): ProfilePermissions {
  return defaultProfilePermissions(provider);
}
