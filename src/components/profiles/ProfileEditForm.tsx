// ProfileEditForm 编辑表单

import type { LaunchMode } from "../../shared/profile/types.js";
import { GlassCard } from "../common/GlassCard.jsx";

interface ProfileEditFormProps {
  draft: {
    name: string;
    url: string;
    key: string;
  };
  runtime: {
    model: string;
    cwd: string;
    extra_args: string;
    launch_mode: LaunchMode;
    proxy: string;
    exclude_user_settings: boolean;
  };
  onChange: (field: string, value: string | boolean) => void;
  onRuntimeChange: (field: string, value: string | boolean) => void;
  onSave: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

export function ProfileEditForm({
  draft,
  runtime,
  onChange,
  onRuntimeChange,
  onSave,
  onCancel,
  disabled,
}: ProfileEditFormProps) {
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
          <input
            value={draft.url}
            onChange={(e) => onChange("url", e.target.value)}
            placeholder="https://api.example.com"
            disabled={disabled}
          />
        </label>
        <label>
          API Key / Token
          <input
            type="password"
            value={draft.key}
            onChange={(e) => onChange("key", e.target.value)}
            placeholder="输入 API Key"
            disabled={disabled}
          />
        </label>
      </GlassCard>

      <GlassCard title="运行时设置">
        <label>
          模型
          <input
            value={runtime.model}
            onChange={(e) => onRuntimeChange("model", e.target.value)}
            placeholder="模型名称（留空使用默认）"
            disabled={disabled}
          />
        </label>
        <label>
          工作目录
          <input
            value={runtime.cwd}
            onChange={(e) => onRuntimeChange("cwd", e.target.value)}
            placeholder="留空使用系统默认"
            disabled={disabled}
          />
        </label>
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
            <option value="direct">直接启动</option>
            <option value="continue">继续最近会话 (--continue)</option>
            <option value="resume_selected">恢复选中会话 (--resume)</option>
          </select>
        </label>
        <label>
          代理
          <input
            value={runtime.proxy}
            onChange={(e) => onRuntimeChange("proxy", e.target.value)}
            placeholder="HTTP 代理（可选）"
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
}