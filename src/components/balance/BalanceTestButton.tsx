import { memo, useMemo } from "react";
import type { BalanceCheckState } from "../../shared/balance/types.js";
import {
  localDateKey,
  type CheckinAccountState,
} from "../../shared/checkin/types.js";
import {
  buildCheckinTitle,
  checkinStateVariant,
  formatCheckinDateTime,
  formatCheckinDiagnosticId,
  formatCheckinReward,
  isFailedCheckinState,
  summarizeCheckinState,
} from "../../shared/checkin/presentation.js";
import {
  balanceStateVariant,
  summarizeBalanceState,
} from "../../shared/balance/presentation.js";
import { StatusBadge } from "../common/StatusBadge.jsx";

interface BalanceTestButtonProps {
  state: BalanceCheckState | null;
  onTest: () => void;
  onClear?: () => void;
  sessionHint?: string;
  disabled?: boolean;
  checkinState?: CheckinAccountState | null;
  checkinAvailable?: boolean;
  autoCheckinEnabled?: boolean;
  enabledAccountCount?: number;
  actionBusy?: boolean;
  batchRunning?: boolean;
  onCheckin?: () => void;
  onRunEnabledCheckins?: () => void;
  onToggleAutoCheckin?: (enabled: boolean) => void;
  onOpenManualCheckin?: () => void;
  onBrowserLogin?: () => void;
}

export const BalanceTestButton = memo(function BalanceTestButton({
  state,
  onTest,
  onClear,
  disabled,
  checkinState,
  checkinAvailable = false,
  autoCheckinEnabled = false,
  enabledAccountCount = 0,
  actionBusy = false,
  batchRunning = false,
  onCheckin,
  onRunEnabledCheckins,
  onToggleAutoCheckin,
  onOpenManualCheckin,
  onBrowserLogin,
}: BalanceTestButtonProps) {
  const summary = useMemo(() => summarizeBalanceState(state), [state]);
  const canClearFailure = !!(
    state
    && !state.running
    && !state.success
    && state.supported
    && onClear
    && (state.message || state.finished_at_display)
  );
  const checkinRunning = checkinState?.status === "running";
  const verificationRunning = checkinState?.status === "verifying";
  const checkinBusy = checkinRunning || verificationRunning;
  const checkedInToday = checkinState?.satisfied_local_date === localDateKey();
  const checkinSummary = summarizeCheckinState(checkinState);
  const checkinBadgeLabel = buildCheckinBadgeLabel(checkinState, checkinSummary);
  const checkinTitle = buildCheckinTitle(checkinState);
  const showCheckinFailure = checkinState && isFailedCheckinState(checkinState);

  return (
    <div className="balance-test">
      <div className="balance-test-toolbar">
        <button type="button" onClick={onTest} disabled={disabled || state?.running}>
          {state?.running ? "检测中..." : "检测余额"}
        </button>
        {onCheckin && (
          <button
            type="button"
            onClick={onCheckin}
            disabled={
              disabled
              || !checkinAvailable
              || checkinBusy
              || checkedInToday
              || actionBusy
              || batchRunning
              || checkinState?.status === "login_required"
            }
          >
            {verificationRunning
              ? "验证中…"
              : checkinRunning
                ? "签到中..."
                : checkedInToday
                  ? "今日已签到"
                  : checkinState?.status === "failed" ? "重新签到" : "立即签到"}
          </button>
        )}
        {onRunEnabledCheckins && (
          <button
            type="button"
            onClick={onRunEnabledCheckins}
            title={enabledAccountCount === 0 ? "请先勾选至少一个账号的自动签到" : undefined}
            disabled={
              disabled
              || enabledAccountCount === 0
              || batchRunning
              || checkinBusy
              || actionBusy
            }
          >
            {batchRunning ? "批量签到中..." : `签到已启用账号 (${enabledAccountCount})`}
          </button>
        )}
        {summary && (
          <StatusBadge
            label={summary}
            variant={balanceStateVariant(state)}
          />
        )}
        {canClearFailure && (
          <button type="button" onClick={onClear} disabled={disabled}>
            清除结果
          </button>
        )}
        {checkinSummary && (
          <span className="checkin-status-badge" title={checkinTitle}>
            <StatusBadge
              label={checkinBadgeLabel}
              variant={checkinStateVariant(checkinState)}
            />
          </span>
        )}
      </div>
      {showCheckinFailure && (
        <div className={`checkin-result ${checkinStateVariant(checkinState)}`} role="status" aria-live="polite">
          <strong><span aria-hidden="true">⚠ </span>{checkinState.trigger === "automatic" ? "自动签到 · " : ""}{checkinSummary}</strong>
          <span>{checkinState.message}</span>
          {checkinState.last_attempt_at && (
            <span className="checkin-result-meta">最近尝试：<time dateTime={checkinState.last_attempt_at}>{formatCheckinDateTime(checkinState.last_attempt_at)}</time></span>
          )}
          {checkinState.diagnostic_run_id && (
            <span>诊断编号：{formatCheckinDiagnosticId(checkinState.diagnostic_run_id)}</span>
          )}
          {checkinState.status === "manual_required" && onOpenManualCheckin && (
            <button type="button" className="secondary-button small" onClick={onOpenManualCheckin} disabled={disabled || actionBusy || batchRunning}>
              重新打开验证窗口
            </button>
          )}
          {checkinState.status === "login_required" && onBrowserLogin && (
            <button type="button" className="secondary-button small" onClick={onBrowserLogin} disabled={disabled || actionBusy || batchRunning}>
              重新登录
            </button>
          )}
          {checkinState.status === "unsupported" && autoCheckinEnabled && onToggleAutoCheckin && (
            <button type="button" className="secondary-button small" onClick={() => onToggleAutoCheckin(false)} disabled={disabled || actionBusy || batchRunning}>
              关闭自动签到
            </button>
          )}
        </div>
      )}
      <div className="checkin-controls">
        <label className="checkbox-label checkin-auto-toggle">
          <input
            type="checkbox"
            checked={autoCheckinEnabled}
            onChange={(event) => onToggleAutoCheckin?.(event.target.checked)}
            disabled={
              disabled
              || !checkinAvailable
              || !onToggleAutoCheckin
              || checkinBusy
              || actionBusy
              || batchRunning
            }
          />
          自动签到
        </label>
        {!checkinAvailable && (
          <span className="checkin-help">请选择并保存包含 Access Token / Session 与 User ID 的后台账号</span>
        )}
      </div>
    </div>
  );
});

function buildCheckinBadgeLabel(
  state: CheckinAccountState | null | undefined,
  summary: string,
): string {
  if (!state || (state.status !== "success" && state.status !== "already_checked")) {
    return summary;
  }
  return [
    summary,
    state.reward ? formatCheckinReward(state.reward) : "",
  ].filter(Boolean).join(" · ");
}
