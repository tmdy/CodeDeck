import { memo, useMemo } from "react";
import type { BalanceCheckState } from "../../shared/balance/types.js";
import {
  localDateKey,
  type CheckinAccountState,
} from "../../shared/checkin/types.js";
import { formatCheckinReward } from "../../shared/checkin/presentation.js";
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
            }
          >
            {verificationRunning
              ? "验证中…"
              : checkinRunning
                ? "签到中..."
                : checkedInToday
                  ? "今日已签到"
                  : "立即签到"}
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
          <StatusBadge
            label={checkinSummary}
            variant={checkinStateVariant(checkinState)}
          />
        )}
      </div>
      {checkinState && checkinState.status !== "running" && (
        <div className="checkin-result">
          <span>{checkinState.message}</span>
          {checkinState.reward && <span>奖励：{formatCheckinReward(checkinState.reward)}</span>}
          {isFailedCheckinState(checkinState) && checkinState.diagnostic_run_id && (
            <span>诊断编号：{formatCheckinDiagnosticId(checkinState.diagnostic_run_id)}</span>
          )}
          {checkinState.last_attempt_at && (
            <span>最近签到：{formatDateTime(checkinState.last_attempt_at)}</span>
          )}
          {checkinState.status === "manual_required" && onOpenManualCheckin && (
            <button type="button" className="secondary-button small" onClick={onOpenManualCheckin}>
              重新打开验证窗口
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

function summarizeCheckinState(state: CheckinAccountState | null | undefined): string {
  if (!state) return "";
  if (state.status === "running") return "签到中";
  if (state.status === "verifying") return "等待人工验证";
  if (state.status === "scheduled") return "已安排";
  if (state.status === "success") return "签到成功";
  if (state.status === "already_checked") return "今日已签到";
  if (state.status === "manual_required") return "需要人工验证";
  if (state.status === "unsupported") return "不支持签到";
  return "签到失败";
}

function checkinStateVariant(
  state: CheckinAccountState | null | undefined,
): "success" | "danger" | "warning" | "info" | "muted" {
  if (!state) return "muted";
  if (state.status === "success" || state.status === "already_checked") return "success";
  if (state.status === "manual_required") return "warning";
  if (state.status === "running" || state.status === "verifying" || state.status === "scheduled") {
    return "info";
  }
  if (state.status === "unsupported") return "muted";
  return "danger";
}

function isFailedCheckinState(state: CheckinAccountState): boolean {
  return state.status === "failed"
    || state.status === "unsupported"
    || state.status === "manual_required";
}

function formatCheckinDiagnosticId(value: string): string {
  return value.length <= 12 ? value : value.slice(0, 8);
}

function formatDateTime(value: string): string {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString() : value;
}
