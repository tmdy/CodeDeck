// LaunchControls 启动控制面板

import { memo } from "react";

interface LaunchControlsProps {
  onDirectLaunch: () => void;
  onContinueLaunch: () => void;
  onResumeLaunch: () => void;
  onTemporaryReadonlyLaunch?: () => void;
  onTemporaryFullAccessLaunch?: () => void;
  disabled?: boolean;
  resumeDisabled?: boolean;
  permissionSummary?: string;
}

export const LaunchControls = memo(function LaunchControls({
  onDirectLaunch,
  onContinueLaunch,
  onResumeLaunch,
  onTemporaryReadonlyLaunch,
  onTemporaryFullAccessLaunch,
  disabled,
  resumeDisabled,
  permissionSummary,
}: LaunchControlsProps) {
  return (
    <div className="launch-controls">
      {permissionSummary && <p className="session-meta">将以以下权限启动：{permissionSummary}</p>}
      <button type="button" className="launch-btn primary" onClick={onDirectLaunch} disabled={disabled}>
        直接启动
      </button>
      <button type="button" className="launch-btn" onClick={onContinueLaunch} disabled={disabled}>
        继续上次
      </button>
      <button
        type="button"
        className="launch-btn"
        onClick={onResumeLaunch}
        disabled={disabled || resumeDisabled}
      >
        恢复选中
      </button>
      <button type="button" className="launch-btn" onClick={onTemporaryReadonlyLaunch} disabled={disabled || !onTemporaryReadonlyLaunch}>
        临时只读
      </button>
      <button type="button" className="launch-btn danger" onClick={onTemporaryFullAccessLaunch} disabled={disabled || !onTemporaryFullAccessLaunch}>
        临时全权限
      </button>
    </div>
  );
});
