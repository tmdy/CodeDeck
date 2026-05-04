// ConnectivityTestButton 连接测试按钮

import { StatusBadge } from "../common/StatusBadge.jsx";

interface ConnectivityTestButtonProps {
  isRunning: boolean;
  success: boolean;
  message: string;
  onTest: () => void;
  disabled?: boolean;
}

export function ConnectivityTestButton({
  isRunning,
  success,
  message,
  onTest,
  disabled,
}: ConnectivityTestButtonProps) {
  return (
    <div className="connectivity-test">
      <button type="button" onClick={onTest} disabled={disabled || isRunning}>
        {isRunning ? "测试中..." : "测试连接"}
      </button>
      {message && (
        <StatusBadge
          label={message}
          variant={isRunning ? "info" : success ? "success" : "danger"}
        />
      )}
    </div>
  );
}