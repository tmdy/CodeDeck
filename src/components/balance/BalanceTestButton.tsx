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
  sessionHint?: string;
  disabled?: boolean;
}

export function BalanceTestButton({
  state,
  onTest,
  sessionHint,
  disabled,
}: BalanceTestButtonProps) {
  const summary = summarizeBalanceState(state);

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
}
