// SessionList 会话列表组件

import { useEffect, useMemo, useState } from "react";
import { CmdPreview } from "./CommandPreview.jsx";
import type { CommandPreview } from "../../shared/launcher/types.js";
import type { ProfileKey } from "../../shared/profile/types.js";
import type { SessionSummary } from "../../shared/services/session-service.js";

const INITIAL_VISIBLE_SESSIONS = 20;
const VISIBLE_SESSION_INCREMENT = 20;

function formatSourceKind(sourceKind: SessionSummary["source_kind"]): string {
  if (sourceKind === "global_codex") {
    return "全局 .codex";
  }
  if (sourceKind === "app_runtime") {
    return "App Runtime";
  }
  return "原生历史";
}

interface RestoreProfileOption {
  key: ProfileKey;
  label: string;
  cwd: string;
}

interface SessionListProps {
  provider: string;
  sessions: SessionSummary[];
  selectedId?: string;
  getSessionKey?: (session: SessionSummary) => string;
  favoriteSessionKeys?: ReadonlySet<string>;
  restoreProfiles: RestoreProfileOption[];
  selectedRestoreProfileKey?: ProfileKey;
  restoreHint?: string;
  restoreDisabled?: boolean;
  preview?: CommandPreview;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  onSelectRestoreProfile: (profileKey: ProfileKey) => void;
  onRestore: () => void;
  onToggleFavorite?: (session: SessionSummary) => void;
  onLoadMore?: () => void;
  showRefresh?: boolean;
  disabled?: boolean;
  isLoading?: boolean;
  hasMoreSessions?: boolean;
  emptyMessage?: string;
}

export function SessionList({
  provider,
  sessions,
  selectedId,
  getSessionKey = (session) => session.session_id,
  favoriteSessionKeys,
  restoreProfiles,
  selectedRestoreProfileKey,
  restoreHint,
  restoreDisabled,
  preview,
  onSelect,
  onRefresh,
  onSelectRestoreProfile,
  onRestore,
  onToggleFavorite,
  onLoadMore,
  showRefresh = true,
  disabled,
  isLoading,
  hasMoreSessions: hasMoreSessionsProp,
  emptyMessage = "暂无会话记录",
}: SessionListProps) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_SESSIONS);

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_SESSIONS);
  }, [provider, sessions]);

  const selectedSession = sessions.find((session) => getSessionKey(session) === selectedId);
  const usesExternalPagination = !!onLoadMore;
  const visibleSessions = useMemo(() => {
    const base = usesExternalPagination ? sessions : sessions.slice(0, visibleCount);
    if (!selectedSession) {
      return base;
    }
    const selectedKey = getSessionKey(selectedSession);
    if (base.some((session) => getSessionKey(session) === selectedKey)) {
      return base;
    }
    return [...base, selectedSession];
  }, [getSessionKey, selectedSession, sessions, usesExternalPagination, visibleCount]);
  const displayedCount = usesExternalPagination ? sessions.length : Math.min(visibleCount, sessions.length);
  const hasMoreSessions = hasMoreSessionsProp ?? displayedCount < sessions.length;

  return (
    <div className="session-list glass-card">
      <div className="session-toolbar">
        <div className="session-list-header">
          <div>
            <h3>历史会话</h3>
            <p className="muted">当前 Provider：{provider}</p>
          </div>
          {showRefresh && (
            <button
              type="button"
              className="secondary-button small"
              onClick={onRefresh}
              disabled={disabled}
            >
              刷新
            </button>
          )}
        </div>
      </div>
      <div className="sessions-detail-layout">
        <div className="session-list-body">
          {isLoading && sessions.length === 0 ? (
            <p className="empty-state">正在加载会话...</p>
          ) : sessions.length === 0 ? (
            <p className="empty-state">{emptyMessage}</p>
          ) : (
            <>
              {visibleSessions.map((s) => {
                const sessionKey = getSessionKey(s);
                const isFavorite = favoriteSessionKeys?.has(sessionKey) ?? false;
                return (
                  <div
                    key={sessionKey}
                    className={`session-item-row ${sessionKey === selectedId ? "selected" : ""}`}
                  >
                    <button
                      type="button"
                      className={`session-item ${sessionKey === selectedId ? "selected" : ""}`}
                      onClick={() => onSelect(sessionKey)}
                      disabled={disabled}
                    >
                      <span className="session-preview">{s.preview || "(无预览)"}</span>
                      <span className="session-meta">
                        {new Date(s.updated_at).toLocaleString()} · {s.cwd}
                      </span>
                    </button>
                    {onToggleFavorite && (
                      <button
                        type="button"
                        className={`session-favorite-btn ${isFavorite ? "active" : ""}`}
                        aria-label={`${isFavorite ? "取消收藏" : "收藏"}会话：${s.preview || s.session_id}`}
                        aria-pressed={isFavorite}
                        title={isFavorite ? "取消收藏" : "收藏"}
                        onClick={(event) => {
                          event.stopPropagation();
                          onToggleFavorite(s);
                        }}
                        disabled={disabled}
                      >
                        {isFavorite ? "★" : "☆"}
                      </button>
                    )}
                  </div>
                );
              })}
              <div className="session-list-footer">
                <span className="session-list-count">
                  已显示 {displayedCount}{hasMoreSessions ? "+" : ` / ${sessions.length}`}
                </span>
                {hasMoreSessions && (
                  <button
                    type="button"
                    className="secondary-button small session-load-more"
                    onClick={onLoadMore ?? (() => setVisibleCount((current) => current + VISIBLE_SESSION_INCREMENT))}
                    disabled={disabled || isLoading}
                  >
                    {isLoading ? "正在加载..." : `加载更多 ${VISIBLE_SESSION_INCREMENT} 条`}
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
                <div className="session-detail-heading-row">
                  <p className="session-picker-heading">会话详情</p>
                  {onToggleFavorite && (
                    <button
                      type="button"
                      className={`session-favorite-btn compact ${favoriteSessionKeys?.has(getSessionKey(selectedSession)) ? "active" : ""}`}
                      aria-label={`${favoriteSessionKeys?.has(getSessionKey(selectedSession)) ? "取消收藏" : "收藏"}会话：${selectedSession.preview || selectedSession.session_id}`}
                      aria-pressed={favoriteSessionKeys?.has(getSessionKey(selectedSession)) ?? false}
                      title={favoriteSessionKeys?.has(getSessionKey(selectedSession)) ? "取消收藏" : "收藏"}
                      onClick={() => onToggleFavorite(selectedSession)}
                      disabled={disabled}
                    >
                      {favoriteSessionKeys?.has(getSessionKey(selectedSession)) ? "★" : "☆"}
                    </button>
                  )}
                </div>
                <p className="session-meta">Session ID</p>
                <code>{selectedSession.session_id}</code>
                <p className="session-meta">Provider</p>
                <code>{selectedSession.provider}</code>
                <p className="session-meta">来源</p>
                <code>{formatSourceKind(selectedSession.source_kind)}</code>
                {selectedSession.source_home && <code>{selectedSession.source_home}</code>}
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
