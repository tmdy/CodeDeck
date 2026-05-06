import {
  PERMISSION_PRESETS,
  defaultProfilePermissions,
  normalizeProfilePermissions,
  toClaudePermissionMode,
  toCodexPermissionConfig,
  type PermissionPreset,
  type ProfilePermissions,
} from "../../shared/profile/permissions.js";
import type { ProviderID } from "../../shared/profile/types.js";
import { GlassCard } from "../common/GlassCard.jsx";

const presetLabels: Record<PermissionPreset, string> = {
  readonly: "只读",
  safe: "安全默认",
  auto_edit: "自动编辑",
  strict_whitelist: "严格白名单",
  full_access: "全权限",
};

const presetDescriptions: Record<PermissionPreset, string> = {
  readonly: "只允许规划或只读访问",
  safe: "允许工作区内编辑，敏感操作需要确认",
  auto_edit: "自动接受普通编辑，敏感操作仍受保护",
  strict_whitelist: "不询问并限制在安全白名单内",
  full_access: "跳过权限保护，需二次确认",
};

function formatPresetOption(preset: PermissionPreset): string {
  return `${presetLabels[preset]}（${presetDescriptions[preset]}）`;
}

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

export function PermissionSettingsCard({
  title,
  provider,
  permissions,
  onChange,
  disabled,
  inheritedSummary,
  inherit,
  onInheritChange,
}: PermissionSettingsCardProps) {
  const normalized = normalizeProfilePermissions(permissions, provider);
  const controlsDisabled = disabled || inherit === true;
  const codexConfig = toCodexPermissionConfig(normalized.preset);
  const providerMapping = provider === "codex"
    ? `Codex: ${codexConfig.sandboxMode} + ${codexConfig.approvalPolicy}`
    : `Claude: ${toClaudePermissionMode(normalized.preset)}`;

  function update(next: Partial<ProfilePermissions>) {
    onChange(normalizeProfilePermissions({ ...normalized, ...next }, provider));
  }

  function updateCommon(field: keyof ProfilePermissions["common"], value: boolean | string[]) {
    update({
      common: {
        ...normalized.common,
        [field]: value,
      },
    });
  }

  return (
    <GlassCard title={title} subtitle={inheritedSummary}>
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
        权限预设
        <select
          value={normalized.preset}
          onChange={(e) => {
            const preset = e.target.value as PermissionPreset;
            update({
              preset,
              fullAccessConfirmed: preset === "full_access" ? false : normalized.fullAccessConfirmed,
            });
          }}
          disabled={controlsDisabled}
        >
          {PERMISSION_PRESETS.map((preset) => (
            <option key={preset} value={preset}>
              {formatPresetOption(preset)}
            </option>
          ))}
        </select>
      </label>
      <p className="session-meta">转换结果：{providerMapping}</p>

      {normalized.preset === "full_access" && (
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
}

export function emptyPermissionsForProvider(provider: ProviderID): ProfilePermissions {
  return defaultProfilePermissions(provider);
}
