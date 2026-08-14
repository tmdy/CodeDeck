import { memo, useMemo, type ReactNode } from "react";
import type {
  BrowserIdentitySlot,
  SiteBalanceAuthKind,
  SiteBalanceSession,
} from "../../shared/balance/site-balance-sessions.js";
import { allocateBrowserSlot } from "../../shared/balance/site-balance-sessions.js";
import { GlassCard } from "../common/GlassCard.jsx";

export interface SiteBalanceSessionPanelProps {
  siteBalanceSessions: SiteBalanceSession[];
  balanceSessionSelection: string;
  balanceSessionDraft: {
    label: string;
    access_token: string;
    auth_kind?: SiteBalanceAuthKind;
    refresh_token?: string;
    token_expires_at?: number;
    user_id: string;
  };
  onBalanceSessionSelectionChange: (value: string) => void;
  onBalanceSessionDraftChange: (
    field: "label" | "access_token" | "auth_kind" | "refresh_token" | "user_id",
    value: string,
  ) => void;
  onSaveBalanceSession?: () => void;
  onBrowserLogin?: () => void;
  onBrowserLogout?: () => void;
  browserIdentitySlots?: BrowserIdentitySlot[];
  browserSlotSelection?: string;
  onBrowserSlotSelectionChange?: (value: string) => void;
  browserAuthStatus?: "unknown" | "checking" | "ready" | "login_required" | "authenticating";
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
  onBrowserLogin,
  onBrowserLogout,
  browserIdentitySlots = [],
  browserSlotSelection = "new",
  onBrowserSlotSelectionChange,
  browserAuthStatus,
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
  const authKind = balanceSessionDraft.auth_kind
    ?? (balanceSessionSelection === "new" ? "browser_session" : "access_token");

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
              {authKind !== "access_token" && (
                <div className="browser-session-login-card">
                  <strong>浏览器登录</strong>
                  <p>
                    {authKind === "session_cookie"
                      ? "该账号使用旧版手工 Cookie，请重新登录以安全迁移。"
                      : "登录状态由本机浏览器安全保存，不会复制 Cookie、Bearer 或 Session。"}
                  </p>
                  {editingExistingBalanceSession && (
                    <p className={`browser-auth-status status-${browserAuthStatus ?? "unknown"}`}>
                      {browserAuthStatus === "login_required"
                        ? "状态：需要重新登录"
                        : browserAuthStatus === "checking"
                          ? "状态：正在检查"
                          : browserAuthStatus === "authenticating"
                            ? "状态：正在登录"
                            : browserAuthStatus === "ready"
                              ? "状态：已登录"
                              : "状态：尚未检查"}
                    </p>
                  )}
                  {balanceSessionSelection === "new" && (
                    <label>
                      浏览器身份
                      <select
                        value={browserSlotSelection}
                        onChange={(event) => onBrowserSlotSelectionChange?.(event.target.value)}
                        disabled={disabled || !onBrowserSlotSelectionChange}
                      >
                        <option value="new">
                          新身份（账号{allocateBrowserSlot(browserIdentitySlots)}）
                        </option>
                        {browserIdentitySlots.map((slot) => (
                          <option key={slot.slot} value={`slot:${slot.slot}`}>
                            复用账号{slot.slot}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    className="primary-button small"
                    onClick={onBrowserLogin}
                    disabled={disabled || !onBrowserLogin}
                  >
                    {editingExistingBalanceSession ? "重新登录" : "浏览器登录"}
                  </button>
                </div>
              )}
              <details className="site-balance-session-advanced" open={authKind === "access_token"}>
                <summary>高级兼容：PAT / Access Token</summary>
                <div className="site-balance-session-fields">
                  {authKind !== "access_token" && (
                    <button
                      type="button"
                      className="secondary-button small"
                      onClick={() => onBalanceSessionDraftChange("auth_kind", "access_token")}
                      disabled={disabled}
                    >
                      改用 PAT 兼容模式
                    </button>
                  )}
                  <label>
                    Access Token / PAT
                    <input
                      type="password"
                      value={balanceSessionDraft.access_token}
                      onChange={(e) => onBalanceSessionDraftChange("access_token", e.target.value)}
                      placeholder="输入后台 Access Token 或 PAT"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                  <label>
                    Refresh Token（Sub2API 可选）
                    <input
                      type="password"
                      value={balanceSessionDraft.refresh_token ?? ""}
                      onChange={(e) => onBalanceSessionDraftChange("refresh_token", e.target.value)}
                      placeholder="输入 Sub2API Refresh Token"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                  <label>
                    User ID（兼容旧站点，可留空）
                    <input
                      value={balanceSessionDraft.user_id}
                      onChange={(e) => onBalanceSessionDraftChange("user_id", e.target.value)}
                      placeholder="输入后台 User ID"
                      disabled={disabled || authKind !== "access_token"}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="secondary-button small"
                  onClick={() => onSaveBalanceSession?.()}
                  disabled={disabled || !onSaveBalanceSession || authKind !== "access_token"}
                >
                  保存 PAT 账号
                </button>
              </details>
              <div className="inline-actions balance-session-actions">
                {editingExistingBalanceSession && authKind === "browser_session" && (
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={onBrowserLogout}
                    disabled={disabled || !onBrowserLogout}
                  >
                    退出登录
                  </button>
                )}
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
