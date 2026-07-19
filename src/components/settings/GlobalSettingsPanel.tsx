// GlobalSettingsPanel 全局设置面板

import type { FormEvent } from "react";
import { GlassCard } from "../common/GlassCard.jsx";
import type { GlobalSettings } from "../../shared/profile/types.js";
import {
  normalizeGlobalPermissions,
  type ClaudeProfilePermissions,
  type CodexProfilePermissions,
} from "../../shared/profile/permissions.js";
import { PermissionSettingsCard } from "../permissions/PermissionSettingsCard.jsx";
import { normalizeThemeMode, type ThemeMode } from "../../shared/theme.js";

interface GlobalSettingsPanelProps {
  settings: GlobalSettings;
  onChange: (settings: Partial<GlobalSettings>) => void;
  onChangePassphrase?: (currentPassword: string, nextPassword: string) => void;
  disabled?: boolean;
}

export function GlobalSettingsPanel({
  settings,
  onChange,
  onChangePassphrase,
  disabled,
}: GlobalSettingsPanelProps) {
  const themeMode = normalizeThemeMode(settings.theme_mode);
  const permissions = normalizeGlobalPermissions(settings.permissions);

  function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!onChangePassphrase) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const nextPassword = String(data.get("nextPassword") ?? "");
    const confirmPassword = String(data.get("confirmPassword") ?? "");
    if (nextPassword !== confirmPassword) {
      return;
    }
    onChangePassphrase(currentPassword, nextPassword);
    form.reset();
  }

  return (
    <>
      <GlassCard title="全局设置">
        <div className="theme-mode-field">
          <span>外观模式</span>
          <div className="segmented-control" role="group" aria-label="外观模式">
            {([
              ["system", "跟随系统"],
              ["light", "日间"],
              ["dark", "夜间"],
            ] as const).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                className={themeMode === mode ? "active" : ""}
                onClick={() => onChange({ theme_mode: mode as ThemeMode })}
                disabled={disabled}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <label>
          全局代理
          <input
            value={settings.proxy ?? ""}
            onChange={(e) => onChange({ proxy: e.target.value })}
            placeholder="HTTP 代理（作用于所有配置，可选）"
            disabled={disabled}
          />
        </label>
      </GlassCard>
      <PermissionSettingsCard
        title="Claude Code 默认权限"
        provider="claude"
        permissions={permissions.claude}
        onChange={(claude) => onChange({ permissions: { ...permissions, claude: claude as ClaudeProfilePermissions } })}
        disabled={disabled}
      />
      <PermissionSettingsCard
        title="Codex 默认权限"
        provider="codex"
        permissions={permissions.codex}
        onChange={(codex) => onChange({ permissions: { ...permissions, codex: codex as CodexProfilePermissions } })}
        disabled={disabled}
      />
      <GlassCard title="修改配置密码" subtitle="用于解锁加密保存的 Profile 配置">
        <form className="password-change-form" onSubmit={handlePasswordSubmit}>
          <label>
            当前密码
            <input
              type="password"
              name="currentPassword"
              autoComplete="current-password"
              disabled={disabled || !onChangePassphrase}
            />
          </label>
          <label>
            新密码
            <input
              type="password"
              name="nextPassword"
              autoComplete="new-password"
              disabled={disabled || !onChangePassphrase}
            />
          </label>
          <label>
            确认新密码
            <input
              type="password"
              name="confirmPassword"
              autoComplete="new-password"
              disabled={disabled || !onChangePassphrase}
            />
          </label>
          <button type="submit" className="secondary-button" disabled={disabled || !onChangePassphrase}>
            修改密码
          </button>
        </form>
      </GlassCard>
    </>
  );
}
