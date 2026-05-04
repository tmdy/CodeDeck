// GlobalSettingsPanel 全局设置面板

import { GlassCard } from "../common/GlassCard.jsx";
import type { GlobalSettings } from "../../shared/profile/types.js";

interface GlobalSettingsPanelProps {
  settings: GlobalSettings;
  onChange: (settings: Partial<GlobalSettings>) => void;
  disabled?: boolean;
}

export function GlobalSettingsPanel({ settings, onChange, disabled }: GlobalSettingsPanelProps) {
  return (
    <GlassCard title="全局设置">
      <label>
        代理
        <input
          value={settings.proxy ?? ""}
          onChange={(e) => onChange({ proxy: e.target.value })}
          placeholder="HTTP 代理（可选）"
          disabled={disabled}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.disable_telemetry ?? true}
          onChange={(e) => onChange({ disable_telemetry: e.target.checked })}
          disabled={disabled}
        />
        禁用遥测
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.disable_error_reporting ?? true}
          onChange={(e) => onChange({ disable_error_reporting: e.target.checked })}
          disabled={disabled}
        />
        禁用错误报告
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.disable_nonessential_traffic ?? true}
          onChange={(e) => onChange({ disable_nonessential_traffic: e.target.checked })}
          disabled={disabled}
        />
        禁用非必要网络流量
      </label>
      <label>
        权限预设
        <input
          value={settings.permissions_preset ?? ""}
          onChange={(e) => onChange({ permissions_preset: e.target.value })}
          placeholder="全部允许（推荐）"
          disabled={disabled}
        />
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={settings.include_co_authored_by ?? false}
          onChange={(e) => onChange({ include_co_authored_by: e.target.checked })}
          disabled={disabled}
        />
        包含 Co-authored-by 标记
      </label>
    </GlassCard>
  );
}