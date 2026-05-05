// LaunchControls 启动控制面板

interface LaunchControlsProps {
  onDirectLaunch: () => void;
  onContinueLaunch: () => void;
  onResumeLaunch: () => void;
  disabled?: boolean;
  resumeDisabled?: boolean;
}

export function LaunchControls({
  onDirectLaunch,
  onContinueLaunch,
  onResumeLaunch,
  disabled,
  resumeDisabled,
}: LaunchControlsProps) {
  return (
    <div className="launch-controls">
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
    </div>
  );
}
