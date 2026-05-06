import { memo, useMemo } from "react";
import { GlassCard } from "../common/GlassCard.jsx";
import type { SessionSummary } from "../../shared/services/session-service.js";

interface SessionPickerProps {
  sessions: SessionSummary[];
  selectedId?: string;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
}

function formatSessionLabel(session: SessionSummary): string {
  const preview = session.preview || "(无预览)";
  return `${preview} · ${session.cwd} · ${new Date(session.updated_at).toLocaleString()}`;
}

export const SessionPicker = memo(function SessionPicker({
  sessions,
  selectedId,
  onSelect,
  onRefresh,
  disabled,
}: SessionPickerProps) {
  const selectedSession = useMemo(
    () => sessions.find((session) => session.session_id === selectedId),
    [selectedId, sessions],
  );
  const selectDisabled = disabled || sessions.length === 0;

  return (
    <GlassCard title="恢复会话" className="session-picker">
      <div className="session-picker-toolbar">
        <select
          value={selectedId ?? ""}
          onChange={(event) => onSelect(event.target.value)}
          disabled={selectDisabled}
        >
          <option value="">请选择最近会话</option>
          {sessions.map((session) => (
            <option key={session.session_id} value={session.session_id}>
              {formatSessionLabel(session)}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-button small"
          onClick={onRefresh}
          disabled={disabled}
        >
          刷新
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="session-picker-summary">
          <p className="empty-state">当前工作目录未找到会话。</p>
          <p className="muted">未选择会话</p>
        </div>
      ) : selectedSession ? (
        <div className="session-picker-summary">
          <p className="session-picker-heading">当前选中</p>
          <p className="session-preview">{selectedSession.preview || "(无预览)"}</p>
          <p className="session-meta">{selectedSession.session_id}</p>
          <p className="session-meta">
            {new Date(selectedSession.updated_at).toLocaleString()} · {selectedSession.cwd}
          </p>
        </div>
      ) : (
        <p className="muted">未选择会话</p>
      )}
    </GlassCard>
  );
});
