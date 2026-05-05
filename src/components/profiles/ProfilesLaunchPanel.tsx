import { LaunchControls } from "../launcher/LaunchControls.jsx";
import { SessionPicker } from "../launcher/SessionPicker.jsx";
import { CmdPreview } from "../launcher/CommandPreview.jsx";
import type { SessionSummary } from "../../shared/services/session-service.js";
import type { CommandPreview } from "../../shared/launcher/types.js";

interface ProfilesLaunchPanelProps {
  preview: CommandPreview;
  disabled?: boolean;
  resumeDisabled?: boolean;
  sessions: SessionSummary[];
  selectedSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onDirectLaunch: () => void;
  onContinueLaunch: () => void;
  onResumeLaunch: () => void;
}

export function ProfilesLaunchPanel({
  preview,
  disabled,
  resumeDisabled,
  sessions,
  selectedSessionId,
  onSelectSession,
  onRefreshSessions,
  onDirectLaunch,
  onContinueLaunch,
  onResumeLaunch,
}: ProfilesLaunchPanelProps) {
  return (
    <div className="profiles-launch-panel">
      <LaunchControls
        onDirectLaunch={onDirectLaunch}
        onContinueLaunch={onContinueLaunch}
        onResumeLaunch={onResumeLaunch}
        disabled={disabled}
        resumeDisabled={resumeDisabled}
      />
      <SessionPicker
        sessions={sessions}
        selectedId={selectedSessionId}
        onSelect={onSelectSession}
        onRefresh={onRefreshSessions}
        disabled={disabled}
      />
      <CmdPreview preview={preview} />
    </div>
  );
}
