// SessionList 会话列表组件

import type { SessionSummary } from "../../shared/services/session-service.js";

interface SessionListProps {
  sessions: SessionSummary[];
  selectedId?: string;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  disabled?: boolean;
}

export function SessionList({
  sessions,
  selectedId,
  onSelect,
  onRefresh,
  disabled,
}: SessionListProps) {
  return (
    <div className="session-list glass-card">
      <div className="session-list-header">
        <h3>历史会话</h3>
        <button
          type="button"
          className="secondary-button small"
          onClick={onRefresh}
          disabled={disabled}
        >
          刷新
        </button>
      </div>
      <div className="session-list-body">
        {sessions.length === 0 ? (
          <p className="empty-state">暂无会话记录</p>
        ) : (
          sessions.map((s) => (
            <button
              key={s.session_id}
              type="button"
              className={`session-item ${s.session_id === selectedId ? "selected" : ""}`}
              onClick={() => onSelect(s.session_id)}
              disabled={disabled}
            >
              <span className="session-preview">{s.preview || "(无预览)"}</span>
              <span className="session-meta">
                {new Date(s.updated_at).toLocaleString()} · {s.cwd}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}