// SessionList 会话列表组件

import { useEffect, useMemo, useState } from "react";
import { CmdPreview } from "./CommandPreview.jsx";
import type { CommandPreview } from "../../shared/launcher/types.js";
import type { ProfileKey } from "../../shared/profile/types.js";
import type { SessionSummary } from "../../shared/services/session-service.js";

const INITIAL_VISIBLE_SESSIONS = 20;
const VISIBLE_SESSION_INCREMENT = 20;

interface RestoreProfileOption {
  key: ProfileKey;
  label: string;
  cwd: string;
}

interface SessionListProps {
  provider: string;
  sessions: SessionSummary[];
  selectedId?: string;
  restoreProfiles: RestoreProfileOption[];
  selectedRestoreProfileKey?: ProfileKey;
  restoreHint?: string;
  restoreDisabled?: boolean;
  preview?: CommandPreview;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  onSelectRestoreProfile: (profileKey: ProfileKey) => void;
  onRestore: () => void;
  disabled?: boolean;
}

export function SessionList({
  provider,
  sessions,
  selectedId,
  restoreProfiles,
  selectedRestoreProfileKey,
  restoreHint,
  restoreDisabled,
  preview,
  onSelect,
  onRefresh,
  onSelectRestoreProfile,
  onRestore,
  disabled,
}: SessionListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_SESSIONS);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_SESSIONS);
  }, [provider, sessions]);

  const selectedSession = sessions.find((session) => session.session_id === selectedId);
  const visibleSessions = useMemo(() => {
    const base = sessions.slice(0, visibleCount);
    if (!selectedSession) {
      return base;
    }
    if (base.some((session) => session.session_id === selectedSession.session_id)) {
      return base;
    }
    return [...base, selectedSession];
  }, [selectedSession, sessions, visibleCount]);
  const displayedCount = Math.min(visibleCount, sessions.length);
  const hasMoreSessions = displayedCount < sessions.length;

  return (
    <div className="session-list glass-card">
      <div className="session-toolbar">
        <div className="session-list-header">
          <div>
            <h3>历史会话</h3>
            <p className="muted">当前 Provider：{provider}</p>
          </div>
          <button
            type="button"
            className="secondary-button small"
            onClick={onRefresh}
            disabled={disabled}
          >
            刷新
          </button>
        </div>
      </div>
      <div className="sessions-detail-layout">
        <div className="session-list-body">
          {sessions.length === 0 ? (
            <p className="empty-state">暂无会话记录</p>
          ) : (
            <>
              {visibleSessions.map((s) => (
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
              ))}
              <div className="session-list-footer">
                <span className="session-list-count">
                  已显示 {displayedCount} / {sessions.length}
                </span>
                {hasMoreSessions && (
                  <button
                    type="button"
                    className="secondary-button small session-load-more"
                    onClick={() => setVisibleCount((current) => current + VISIBLE_SESSION_INCREMENT)}
                    disabled={disabled}
                  >
                    加载更多 {VISIBLE_SESSION_INCREMENT} 条
                  </button>
                )}
              </div>
            </>
          )}
        </div>
        <div className="session-detail-panel">
          {selectedSession ? (
            <>
              <div className="session-detail-card">
                <p className="session-picker-heading">会话详情</p>
                <p className="session-meta">Session ID</p>
                <code>{selectedSession.session_id}</code>
                <p className="session-meta">Provider</p>
                <code>{selectedSession.provider}</code>
                <p className="session-meta">原始工作目录</p>
                <code>{selectedSession.cwd || "(未记录)"}</code>
                <p className="session-meta">更新时间</p>
                <code>{new Date(selectedSession.updated_at).toLocaleString()}</code>
                <p className="session-meta">预览</p>
                <p>{selectedSession.preview || "(无预览)"}</p>
              </div>
              <div className="session-detail-card">
                <label className="field-block">
                  <span className="session-picker-heading">用于恢复的 Profile</span>
                  <select
                    value={selectedRestoreProfileKey ?? ""}
                    onChange={(event) => onSelectRestoreProfile(event.target.value)}
                    disabled={disabled || restoreProfiles.length === 0}
                  >
                    <option value="">请选择</option>
                    {restoreProfiles.map((profile) => (
                      <option key={profile.key} value={profile.key}>
                        {profile.label}
                      </option>
                    ))}
                  </select>
                </label>
                {selectedRestoreProfileKey && (
                  <p className="session-meta">
                    当前恢复目录：
                    {" "}
                    {restoreProfiles.find((profile) => profile.key === selectedRestoreProfileKey)?.cwd || "(未设置)"}
                  </p>
                )}
                {restoreHint && <p className="muted">{restoreHint}</p>}
                <button
                  type="button"
                  className="launch-btn primary"
                  onClick={onRestore}
                  disabled={disabled || restoreDisabled}
                >
                  恢复选中会话
                </button>
              </div>
              {preview ? <CmdPreview preview={preview} /> : null}
            </>
          ) : (
            <p className="empty-state">请选择左侧会话以查看详情并恢复。</p>
          )}
        </div>
      </div>
    </div>
  );
}
