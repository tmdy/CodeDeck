// CommandPreview 命令预览组件

import { GlassCard } from "../common/GlassCard.jsx";
import type { CommandPreview } from "../../shared/launcher/types.js";

interface CommandPreviewProps {
  preview: CommandPreview;
}

export function CmdPreview({ preview }: CommandPreviewProps) {
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(preview.command);
    } catch {
      // fallback
    }
  }

  if (!preview.command && !preview.cwd && preview.env.length === 0) {
    return (
      <GlassCard title="命令预览">
        <p className="muted">选择 Profile 以预览命令</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard
      title="命令预览"
      subtitle={preview.valid ? "就绪" : (preview.error ?? "未就绪")}
    >
      <div className="command-preview-section">
        <p className="session-picker-heading">最终命令</p>
        <pre className="command-preview-code">{preview.command || "(未生成)"}</pre>
      </div>
      <div className="command-preview-section">
        <p className="session-picker-heading">执行目录</p>
        <p className="session-meta">{preview.cwd || "(未设置)"}</p>
      </div>
      <div className="command-preview-section">
        <p className="session-picker-heading">权限</p>
        <p className="session-meta">{preview.permissionSummary || "(未设置)"}</p>
      </div>
      <div className="command-preview-section">
        <p className="session-picker-heading">注入环境变量</p>
        {preview.env.length === 0 ? (
          <p className="muted">无</p>
        ) : (
          <ul className="command-preview-env-list">
            {preview.env.map((envVar) => (
              <li key={envVar.name} className="session-meta">
                {envVar.name} = {envVar.displayValue}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        className="secondary-button"
        onClick={copyToClipboard}
        disabled={!preview.command}
      >
        复制命令
      </button>
    </GlassCard>
  );
}
