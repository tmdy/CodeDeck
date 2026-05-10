// ParameterSettingsPanel 参数设置面板

import { GlassCard } from "../common/GlassCard.jsx";
import type { ParameterSettings } from "../../shared/parameter/types.js";

interface ParameterSettingsPanelProps {
  settings: ParameterSettings;
  onChange: (settings: Partial<ParameterSettings>) => void;
  disabled?: boolean;
}

export function ParameterSettingsPanel({
  settings,
  onChange,
  disabled,
}: ParameterSettingsPanelProps) {
  return (
    <div className="parameter-settings">
      <GlassCard title="超时设置">
        <label>
          启动超时 (毫秒)
          <input
            type="number"
            value={settings.launch_timeout_ms ?? 30000}
            onChange={(e) =>
              onChange({ launch_timeout_ms: parseInt(e.target.value, 10) || 30000 })
            }
            disabled={disabled}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.inherit_global_capabilities ?? true}
            onChange={(e) =>
              onChange({ inherit_global_capabilities: e.target.checked })
            }
            disabled={disabled}
          />
          启动时继承全局 MCP 和 Skills
        </label>
        <label>
          余额检测超时 (毫秒)
          <input
            type="number"
            value={settings.connectivity_test_timeout_ms ?? 60000}
            onChange={(e) =>
              onChange({
                connectivity_test_timeout_ms: parseInt(e.target.value, 10) || 60000,
              })
            }
            disabled={disabled}
          />
        </label>
      </GlassCard>

      <GlassCard title="启动模式参数模板">
        <label>
          直接启动
          <input
            value={settings.launch_mode_args?.new ?? ""}
            onChange={(e) =>
              onChange({
                launch_mode_args: {
                  ...settings.launch_mode_args,
                  new: e.target.value,
                },
              })
            }
            placeholder="直接启动模式的额外参数"
            disabled={disabled}
          />
        </label>
        <label>
          继续上次
          <input
            value={settings.launch_mode_args?.continue_last ?? ""}
            onChange={(e) =>
              onChange({
                launch_mode_args: {
                  ...settings.launch_mode_args,
                  continue_last: e.target.value,
                },
              })
            }
            disabled={disabled}
          />
        </label>
        <label>
          恢复选中
          <input
            value={settings.launch_mode_args?.resume_selected ?? ""}
            onChange={(e) =>
              onChange({
                launch_mode_args: {
                  ...settings.launch_mode_args,
                  resume_selected: e.target.value,
                },
              })
            }
            disabled={disabled}
          />
        </label>
      </GlassCard>

      <GlassCard title="Claude CLI 特定设置">
        <label>
          Setting Sources
          <input
            value={settings.cli_settings?.claude?.setting_sources ?? "project,local"}
            onChange={(e) =>
              onChange({
                cli_settings: {
                  ...settings.cli_settings,
                  claude: {
                    ...settings.cli_settings?.claude,
                    setting_sources: e.target.value,
                  },
                },
              })
            }
            disabled={disabled}
          />
        </label>
        <label>
          权限模式
          <input
            value={settings.cli_settings?.claude?.permission_mode ?? "acceptEdits"}
            onChange={(e) =>
              onChange({
                cli_settings: {
                  ...settings.cli_settings,
                  claude: {
                    ...settings.cli_settings?.claude,
                    permission_mode: e.target.value,
                  },
                },
              })
            }
            disabled={disabled}
          />
        </label>
      </GlassCard>

      <GlassCard title="Codex CLI 特定设置">
        <label>
          Wire API
          <input
            value={settings.cli_settings?.codex?.wire_api ?? "responses"}
            onChange={(e) =>
              onChange({
                cli_settings: {
                  ...settings.cli_settings,
                  codex: {
                    ...settings.cli_settings?.codex,
                    wire_api: e.target.value,
                  },
                },
              })
            }
            disabled={disabled}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.cli_settings?.codex?.skip_git_repo_check ?? false}
            onChange={(e) =>
              onChange({
                cli_settings: {
                  ...settings.cli_settings,
                  codex: {
                    ...settings.cli_settings?.codex,
                    skip_git_repo_check: e.target.checked,
                  },
                },
              })
            }
            disabled={disabled}
          />
          跳过 Git 仓库检查
        </label>
      </GlassCard>

      <GlassCard title="环境变量注入">
        <p className="muted">以下键值对将在启动时注入到 CLI 环境变量中。</p>
        {Object.entries(settings.extra_env ?? {}).map(([k, v]) => (
          <div key={k} className="env-row">
            <input
              value={k}
              onChange={(e) => {
                const newEnv = { ...settings.extra_env };
                delete newEnv[k];
                newEnv[e.target.value] = v;
                onChange({ extra_env: newEnv });
              }}
              disabled={disabled}
            />
            <input
              value={v}
              onChange={(e) =>
                onChange({
                  extra_env: { ...settings.extra_env, [k]: e.target.value },
                })
              }
              disabled={disabled}
            />
            <button
              type="button"
              className="secondary-button small"
              onClick={() => {
                const newEnv = { ...settings.extra_env };
                delete newEnv[k];
                onChange({ extra_env: newEnv });
              }}
              disabled={disabled}
            >
              删除
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            onChange({
              extra_env: { ...settings.extra_env, "": "" },
            });
          }}
          disabled={disabled}
        >
          添加环境变量
        </button>
      </GlassCard>
    </div>
  );
}
