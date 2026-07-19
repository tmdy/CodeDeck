import { memo, useMemo } from "react";
import { GlassCard } from "../common/GlassCard.jsx";
import type { SessionSummary } from "../../shared/services/session-service.js";
import type { SessionCatalogState } from "../../shared/services/session-service.js";

interface SessionPickerProps {
  sessions: SessionSummary[];
  selectedId?: string;
  favoriteSessionKeys?: ReadonlySet<string>;
  getFavoriteKey?: (session: SessionSummary) => string;
  onSelect: (sessionId: string) => void;
  onRefresh: () => void;
  onToggleFavorite?: (session: SessionSummary) => void;
  disabled?: boolean;
  isLoading?: boolean;
  isRefreshing?: boolean;
  isUninitialized?: boolean;
  catalogState?: SessionCatalogState;
}

function formatSessionLabel(session: SessionSummary): string {
  const preview = session.preview || "(无预览)";
  return `${preview} · ${session.cwd} · ${new Date(session.updated_at).toLocaleString()}`;
}

function formatSessionTime(session: SessionSummary): string {
  return new Date(session.updated_at).toLocaleString();
}

function formatSourceKind(session: SessionSummary): string {
  if (session.source_kind === "global_codex") {
    return "全局 .codex";
  }
  if (session.source_kind === "app_runtime") {
    return "App Runtime";
  }
  return "原生历史";
}

export const SessionPicker = memo(function SessionPicker({
  sessions,
  selectedId,
  favoriteSessionKeys,
  getFavoriteKey = (session) => session.session_id,
  onSelect,
  onRefresh,
  onToggleFavorite,
  disabled,
  isLoading,
  isRefreshing,
  isUninitialized,
  catalogState = "ready",
}: SessionPickerProps) {
  const selectedSession = useMemo(
    () => sessions.find((session) => session.session_id === selectedId),
    [selectedId, sessions],
  );
  const selectedExcerpts = selectedSession?.conversation_excerpts?.length
    ? selectedSession.conversation_excerpts.slice(0, 6)
    : (selectedSession?.user_prompts?.slice(0, 4).map((text) => ({ role: "user" as const, text })) ?? []);
  const selectedFavoriteKey = selectedSession ? getFavoriteKey(selectedSession) : "";
  const isSelectedFavorite = selectedFavoriteKey
    ? favoriteSessionKeys?.has(selectedFavoriteKey) ?? false
    : false;
  const listboxId = "profile-session-picker-listbox";

  return (
    <GlassCard title="恢复会话" className={`session-picker${selectedSession ? " has-selection" : ""}`}>
      <div className="session-picker-toolbar">
        <div className="session-picker-title">
          <span className="session-picker-heading">请选择最近会话</span>
          <span className="session-picker-count">{sessions.length} 个可用</span>
          {catalogState !== "ready" && (
            <span className="session-picker-count">
              {catalogState === "building" ? "正在整理旧历史..." : "正在增量更新..."}
            </span>
          )}
        </div>
        <button
          type="button"
          className="secondary-button small session-refresh-button"
          onClick={onRefresh}
          disabled={disabled || isRefreshing}
          aria-busy={isRefreshing}
          aria-label={isRefreshing
            ? isUninitialized ? "正在加载会话" : "正在刷新会话"
            : undefined}
        >
          {isRefreshing
            ? <span className="session-refresh-spinner" aria-hidden="true" />
            : isUninitialized ? "加载会话" : "刷新"}
        </button>
      </div>

      {sessions.length === 0 ? (
        <div className="session-picker-summary">
          <p className="empty-state">
            {isLoading
              ? "正在加载会话..."
              : isUninitialized
                ? "尚未加载当前工作目录的会话。"
                : "当前工作目录未找到会话。"}
          </p>
          {isUninitialized && <p className="muted">点击“加载会话”后再选择恢复目标。</p>}
          <p className="muted">未选择会话</p>
        </div>
      ) : (
        <>
          <div
            id={listboxId}
            className="session-picker-list"
            role="listbox"
            aria-label="最近会话列表"
            aria-activedescendant={selectedId ? `profile-session-option-${selectedId}` : undefined}
          >
            {sessions.map((session) => (
              <button
                key={session.session_id}
                id={`profile-session-option-${session.session_id}`}
                type="button"
                className="session-picker-option"
                role="option"
                aria-selected={session.session_id === selectedId}
                title={formatSessionLabel(session)}
                disabled={disabled}
                onClick={() => onSelect(session.session_id)}
              >
                <span className="session-picker-option-preview">
                  {session.preview || "(无预览)"}
                </span>
                <span className="session-picker-option-meta">
                  {formatSourceKind(session)} · {session.cwd} · {formatSessionTime(session)}
                </span>
              </button>
            ))}
          </div>
          {selectedSession ? (
            <div className="session-picker-summary session-picker-selected-summary">
              <div className="session-picker-selected-heading-row">
                <p className="session-picker-heading">当前选中</p>
                {onToggleFavorite && (
                  <button
                    type="button"
                    className={`session-favorite-btn compact ${isSelectedFavorite ? "active" : ""}`}
                    aria-label={`${isSelectedFavorite ? "取消收藏" : "收藏"}会话：${selectedSession.preview || selectedSession.session_id}`}
                    aria-pressed={isSelectedFavorite}
                    title={isSelectedFavorite ? "取消收藏" : "收藏"}
                    onClick={() => onToggleFavorite(selectedSession)}
                    disabled={disabled}
                  >
                    {isSelectedFavorite ? "★" : "☆"}
                  </button>
                )}
              </div>
              <p className="session-preview">{selectedSession.preview || "(无预览)"}</p>
              {selectedExcerpts.length > 0 && (
                <div className="session-picker-excerpts">
                  <p className="session-picker-heading">开头问答</p>
                  <ul className="session-picker-excerpt-list">
                    {selectedExcerpts.map((excerpt, index) => (
                      <li key={`${selectedSession.session_id}-excerpt-${index}`}>
                        <span className={`session-picker-role ${excerpt.role}`}>
                          {excerpt.role === "assistant" ? "答" : "问"}
                        </span>
                        <span className="session-picker-excerpt-text">{excerpt.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="session-meta">{selectedSession.session_id}</p>
              <p className="session-meta">
                {formatSourceKind(selectedSession)} · {new Date(selectedSession.updated_at).toLocaleString()} · {selectedSession.cwd}
              </p>
            </div>
          ) : (
            <p className="muted">未选择会话</p>
          )}
        </>
      )}
    </GlassCard>
  );
});
