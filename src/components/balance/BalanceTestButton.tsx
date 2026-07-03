import { memo, useMemo } from "react";
import type { BalanceCheckState } from "../../shared/balance/types.js";
import {
  balanceStateVariant,
  formatBalanceItemLine,
  summarizeBalanceState,
} from "../../shared/balance/presentation.js";
import { StatusBadge } from "../common/StatusBadge.jsx";

interface BalanceTestButtonProps {
  state: BalanceCheckState | null;
  onTest: () => void;
  onClear?: () => void;
  sessionHint?: string;
  disabled?: boolean;
}

export const BalanceTestButton = memo(function BalanceTestButton({
  state,
  onTest,
  onClear,
  sessionHint,
  disabled,
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

  return (
    <div className="balance-test">
      <div className="balance-test-toolbar">
        <button type="button" onClick={onTest} disabled={disabled || state?.running}>
          {state?.running ? "检测中..." : "检测余额"}
        </button>
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
      </div>
      {state?.success && state.items.length > 0 && (
        <div className="balance-test-items">
          {state.items.map((item, index) => (
            <div key={`${item.label}-${item.unit}-${index}`} className="balance-test-item">
              {formatBalanceItemLine(item)}
            </div>
          ))}
        </div>
      )}
      {!state?.running && state?.endpoint && (
        <p className="balance-test-meta">来源: {state.endpoint}</p>
      )}
      {!state?.running && sessionHint && (
        <p className="balance-test-meta">{sessionHint}</p>
      )}
      {!state?.running && state?.finished_at_display && (
        <p className="balance-test-meta">最近检测: {state.finished_at_display}</p>
      )}
    </div>
  );
});
