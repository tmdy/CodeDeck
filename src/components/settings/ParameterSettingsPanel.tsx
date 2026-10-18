// ParameterSettingsPanel 参数设置面板

import { useEffect, useState } from "react";
import { GlassCard } from "../common/GlassCard.jsx";
import type { ParameterSettings } from "../../shared/parameter/types.js";
import type { Profile } from "../../shared/profile/types.js";
import { itemKey } from "../../shared/profile/keys-internal.js";

interface ParameterSettingsPanelProps {
  settings: ParameterSettings;
  onChange: (settings: Partial<ParameterSettings>) => void;
  profiles?: Profile[];
  disabled?: boolean;
}

function parseAutoContinueKeywords(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[,，\r\n]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  ));
}

function AutoContinueKeywordsInput({
  keywords,
  onChange,
  disabled,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
  disabled?: boolean;
}) {
  const [value, setValue] = useState(() => keywords.join(", "));

  useEffect(() => {
    const incoming = keywords.join(", ");
    if (parseAutoContinueKeywords(value).join(", ") !== incoming) {
      setValue(incoming);
    }
  }, [keywords, value]);

  return (
    <input
      value={value}
      onChange={(event) => {
        setValue(event.target.value);
        onChange(parseAutoContinueKeywords(event.target.value));
      }}
      onBlur={() => setValue(parseAutoContinueKeywords(value).join(", "))}
      placeholder="high demand, temporary errors, rate limit"
      disabled={disabled}
    />
  );
}

export function ParameterSettingsPanel({
  settings,
  onChange,
  profiles = [],
  disabled,
}: ParameterSettingsPanelProps) {
  return (
    <div className="parameter-settings">
      <GlassCard title="超时设置">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.inherit_global_capabilities ?? true}
            onChange={(e) =>
              onChange({ inherit_global_capabilities: e.target.checked })
            }
            disabled={disabled}
          />
          Claude 启动时继承全局 MCP 和 Skills
        </label>
        <p className="settings-hint">Codex 始终直接使用用户 Codex Home 中的 MCP、Plugins 和 Skills。</p>
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

      <GlassCard title="终端与监控设置">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.terminal?.auto_continue_on_failure ?? true}
            onChange={(e) =>
              onChange({
                terminal: {
                  ...settings.terminal,
                  auto_continue_on_failure: e.target.checked,
                },
              })
            }
            disabled={disabled}
          />
          高峰失败时自动输入继续
        </label>
        <div className="auto-continue-settings-row">
          <label className="auto-continue-compact-field">
            自动继续累计上限
            <input
              type="number"
              min={-1}
              value={settings.terminal?.auto_continue_limit ?? 1}
              onChange={(e) =>
                onChange({
                  terminal: {
                    ...settings.terminal,
                    auto_continue_limit: parseInt(e.target.value, 10) || 1,
                  },
                })
              }
              disabled={disabled}
            />
          </label>
          <label className="auto-continue-compact-field">
            间隔模式
            <select
              value={settings.terminal?.auto_continue_interval_mode ?? "fixed"}
              onChange={(e) =>
                onChange({
                  terminal: {
                    ...settings.terminal,
                    auto_continue_interval_mode: e.target.value === "normal" ? "normal" : "fixed",
                  },
                })
              }
              disabled={disabled}
            >
              <option value="fixed">固定间隔</option>
              <option value="normal">随机间隔</option>
            </select>
          </label>
          <label className="auto-continue-compact-field">
            {settings.terminal?.auto_continue_interval_mode === "normal" ? "均值 (秒)" : "固定间隔 (秒)"}
            <input
              type="number"
              min={0}
              step={0.1}
              value={(settings.terminal?.auto_continue_interval_ms ?? 0) / 1000}
              onChange={(e) =>
                onChange({
                  terminal: {
                    ...settings.terminal,
                    auto_continue_interval_ms: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 1000)),
                  },
                })
              }
              disabled={disabled}
            />
          </label>
          {settings.terminal?.auto_continue_interval_mode === "normal" && (
            <label className="auto-continue-compact-field">
              标准差 (秒)
              <input
                type="number"
                min={0}
                step={0.1}
                value={(settings.terminal?.auto_continue_interval_stddev_ms ?? 1_000) / 1000}
                onChange={(e) =>
                  onChange({
                    terminal: {
                      ...settings.terminal,
                      auto_continue_interval_stddev_ms: Math.max(0, Math.round((parseFloat(e.target.value) || 0) * 1000)),
                    },
                  })
                }
                disabled={disabled}
              />
            </label>
          )}
          <label className="auto-continue-prompt-field">
            自动继续输入文本
            <input
              value={settings.terminal?.auto_continue_prompt ?? "继续"}
              onChange={(e) =>
                onChange({
                  terminal: {
                    ...settings.terminal,
                    auto_continue_prompt: e.target.value,
                  },
                })
              }
              disabled={disabled}
            />
          </label>
          <label className="auto-continue-keywords-field">
            自动继续关键词（英文逗号分隔）
            <AutoContinueKeywordsInput
              keywords={settings.terminal?.auto_continue_keywords ?? []}
              onChange={(keywords) =>
                onChange({
                  terminal: {
                    ...settings.terminal,
                    auto_continue_keywords: keywords,
                  },
                })
              }
              disabled={disabled}
            />
          </label>
        </div>
      </GlassCard>

      <GlassCard title="本地 AI 委托接口">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={settings.agent_bridge?.enabled ?? false}
            onChange={(e) =>
              onChange({
                agent_bridge: {
                  ...settings.agent_bridge,
                  enabled: e.target.checked,
                },
              })
            }
            disabled={disabled}
          />
          允许本机 AI 调用 Profile
        </label>
        <small className="muted-text">
          命令行可按任务覆盖模型与推理强度，并选择隐藏或显示受监控终端。父会话可异步启动子任务；子终端会独立存活，完成后按 once、continuous 或 manual 策略安全回传，父子双方还可用 ESC 中断对方当前轮次。
        </small>
        <label>
          最大并发任务
          <input
            type="number"
            min={1}
            max={32}
            value={settings.agent_bridge?.max_concurrent_tasks ?? 4}
            onChange={(e) =>
              onChange({
                agent_bridge: {
                  ...settings.agent_bridge,
                  max_concurrent_tasks: Math.max(
                    1,
                    Math.min(32, parseInt(e.target.value, 10) || 4),
                  ),
                },
              })
            }
            disabled={disabled}
          />
        </label>
        {profiles.length > 0 && (
          <div className="parameter-profile-blacklist-section">
            <div className="parameter-profile-blacklist-hint">
              <span>Profile 黑名单</span>
              <small>点击方框切换，灰色表示禁止调用</small>
            </div>
            <div className="parameter-profile-blacklist" role="group" aria-label="Profile 黑名单">
              {profiles.map((profile) => {
                const profileKey = itemKey(profile);
                const blocked = settings.agent_bridge?.blocked_profile_keys?.includes(profileKey) ?? false;
                return (
                  <button
                    type="button"
                    className="parameter-profile-blacklist-option"
                    key={profileKey}
                    aria-pressed={blocked}
                    title={blocked ? "点击移出黑名单" : "点击加入黑名单"}
                    onClick={() => {
                      const current = new Set(settings.agent_bridge?.blocked_profile_keys ?? []);
                      if (blocked) {
                        current.delete(profileKey);
                      } else {
                        current.add(profileKey);
                      }
                      onChange({
                        agent_bridge: {
                          ...settings.agent_bridge,
                          blocked_profile_keys: [...current],
                        },
                      });
                    }}
                    disabled={disabled}
                  >
                    <span>{profile.name}</span>
                    <small>{profile.provider}</small>
                  </button>
                );
              })}
            </div>
          </div>
        )}
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
