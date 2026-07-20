import { memo, useMemo, type ReactNode } from "react";
import type { SiteBalanceSession } from "../../shared/balance/site-balance-sessions.js";
import { GlassCard } from "../common/GlassCard.jsx";

export interface SiteBalanceSessionPanelProps {
  siteBalanceSessions: SiteBalanceSession[];
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    refresh_token?: string;
    token_expires_at?: number;
    user_id: string;
  };
  onBalanceSessionSelectionChange: (value: string) => void;
  onBalanceSessionDraftChange: (
    field: "label" | "access_token" | "refresh_token" | "user_id",
    value: string,
  ) => void;
  onSaveBalanceSession?: () => void;
  onDeleteSiteBalanceSession: () => void;
  balanceMeta?: ReactNode;
  disabled?: boolean;
}

export const SiteBalanceSessionPanel = memo(function SiteBalanceSessionPanel({
  siteBalanceSessions,
  balanceSessionSelection,
  balanceSessionDraft,
  onBalanceSessionSelectionChange,
  onBalanceSessionDraftChange,
  onSaveBalanceSession,
  onDeleteSiteBalanceSession,
  balanceMeta,
  disabled,
}: SiteBalanceSessionPanelProps) {
  const editingExistingBalanceSession = useMemo(
    () => Boolean(
      balanceSessionSelection
      && balanceSessionSelection !== "auto"
      && balanceSessionSelection !== "new",
    ),
    [balanceSessionSelection],
  );
  const editingBalanceSession = editingExistingBalanceSession || balanceSessionSelection === "new";

  return (
    <>
      <GlassCard title="站点后台会话" className="site-balance-session-card">
        <div className="site-balance-session-panel">
          <label>
            后台会话
            <select
              value={balanceSessionSelection}
              onChange={(e) => onBalanceSessionSelectionChange(e.target.value)}
              disabled={disabled}
            >
              <option value="auto">API Key 自动</option>
              {siteBalanceSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.label}
                </option>
              ))}
              <option value="new">新建会话</option>
            </select>
          </label>
          {editingBalanceSession && (
            <>
              <div className="site-balance-session-fields">
                <label>
                  Access Token / Session
                  <input
                    type="password"
                    value={balanceSessionDraft.access_token}
                    onChange={(e) => onBalanceSessionDraftChange("access_token", e.target.value)}
                    placeholder="输入后台 Access Token 或 Session"
                    disabled={disabled}
                  />
                </label>
                <label>
                  Refresh Token（Sub2API 可选）
                  <input
                    type="password"
                    value={balanceSessionDraft.refresh_token ?? ""}
                    onChange={(e) => onBalanceSessionDraftChange("refresh_token", e.target.value)}
                    placeholder="输入 Sub2API Refresh Token"
                    disabled={disabled}
                  />
                </label>
                <label>
                  User ID（没有可留空）
                  <input
                    value={balanceSessionDraft.user_id}
                    onChange={(e) => onBalanceSessionDraftChange("user_id", e.target.value)}
                    placeholder="输入后台 User ID"
                    disabled={disabled}
                  />
                </label>
              </div>
              <div className="inline-actions balance-session-actions">
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => onSaveBalanceSession?.()}
                  disabled={disabled || !onSaveBalanceSession}
                >
                  保存会话
                </button>
                {editingExistingBalanceSession && (
                  <button
                    type="button"
                    className="secondary-button small danger"
                    onClick={onDeleteSiteBalanceSession}
                    disabled={disabled}
                  >
                    删除当前会话
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </GlassCard>
      {balanceMeta && (
        <div className="site-balance-session-meta">
          {balanceMeta}
        </div>
      )}
    </>
  );
});
