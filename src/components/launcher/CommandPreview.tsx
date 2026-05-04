// CommandPreview 命令预览组件

import { GlassCard } from "../common/GlassCard.jsx";

interface CommandPreviewProps {
  command: string;
  valid: boolean;
}

export function CmdPreview({ command, valid }: CommandPreviewProps) {
  async function copyToClipboard() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      // fallback
    }
  }

  if (!command) {
    return (
      <GlassCard title="命令预览">
        <p className="muted">选择 Profile 以预览命令</p>
      </GlassCard>
    );
  }

  return (
    <GlassCard title="命令预览" subtitle={valid ? "就绪" : "无效"}>
      <pre className="command-preview-code">{command}</pre>
      <button type="button" className="secondary-button" onClick={copyToClipboard}>
        复制命令
      </button>
    </GlassCard>
  );
}