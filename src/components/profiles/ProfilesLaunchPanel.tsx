import { memo } from "react";
import { LaunchControls } from "../launcher/LaunchControls.jsx";
import { SessionPicker } from "../launcher/SessionPicker.jsx";
import type { SessionSummary } from "../../shared/services/session-service.js";
import type { CommandPreview } from "../../shared/launcher/types.js";

interface ProfilesLaunchPanelProps {
  provider: "claude" | "codex";
  monitorModeEnabled?: boolean;
  onMonitorModeChange?: (enabled: boolean) => void;
  preview: CommandPreview;
  disabled?: boolean;
  resumeDisabled?: boolean;
  sessions: SessionSummary[];
  sessionsLoading?: boolean;
  sessionsUninitialized?: boolean;
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onDirectLaunch: () => void;
  onContinueLaunch: () => void;
  onResumeLaunch: () => void;
  onTemporaryReadonlyLaunch?: () => void;
  onTemporaryFullAccessLaunch?: () => void;
}

export const ProfilesLaunchPanel = memo(function ProfilesLaunchPanel({
  provider,
  monitorModeEnabled,
  onMonitorModeChange,
  preview,
  disabled,
  resumeDisabled,
  sessions,
  sessionsLoading,
  sessionsUninitialized,
  selectedSessionId,
  onSelectSession,
  onRefreshSessions,
  onDirectLaunch,
  onContinueLaunch,
  onResumeLaunch,
  onTemporaryReadonlyLaunch,
  onTemporaryFullAccessLaunch,
}: ProfilesLaunchPanelProps) {
  return (
    <div className="profiles-launch-panel">
      <LaunchControls
        provider={provider}
        monitorModeEnabled={monitorModeEnabled}
        onMonitorModeChange={onMonitorModeChange}
        onDirectLaunch={onDirectLaunch}
        onContinueLaunch={onContinueLaunch}
        onResumeLaunch={onResumeLaunch}
        onTemporaryReadonlyLaunch={onTemporaryReadonlyLaunch}
        onTemporaryFullAccessLaunch={onTemporaryFullAccessLaunch}
        disabled={disabled}
        resumeDisabled={resumeDisabled}
        permissionSummary={preview.permissionSummary}
      />
      <SessionPicker
        sessions={sessions}
        isLoading={sessionsLoading}
        isUninitialized={sessionsUninitialized}
        selectedId={selectedSessionId}
        onSelect={onSelectSession}
        onRefresh={onRefreshSessions}
        disabled={disabled}
      />
    </div>
  );
});
