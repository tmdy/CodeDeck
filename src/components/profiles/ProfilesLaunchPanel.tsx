import { memo } from "react";
import { LaunchControls } from "../launcher/LaunchControls.jsx";
import { SessionPicker } from "../launcher/SessionPicker.jsx";
import type { SessionCatalogState, SessionSummary } from "../../shared/services/session-service.js";

interface ProfilesLaunchPanelProps {
  provider: "claude" | "codex";
  monitorModeEnabled?: boolean;
  onMonitorModeChange?: (enabled: boolean) => void;
  disabled?: boolean;
  resumeDisabled?: boolean;
  sessions: SessionSummary[];
  sessionsLoading?: boolean;
  sessionsRefreshing?: boolean;
  sessionsUninitialized?: boolean;
  sessionsCatalogState?: SessionCatalogState;
  selectedSessionId?: string;
  favoriteSessionKeys?: ReadonlySet<string>;
  getSessionFavoriteKey?: (session: SessionSummary) => string;
  onSelectSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onToggleFavorite?: (session: SessionSummary) => void;
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
  disabled,
  resumeDisabled,
  sessions,
  sessionsLoading,
  sessionsRefreshing,
  sessionsUninitialized,
  sessionsCatalogState,
  selectedSessionId,
  favoriteSessionKeys,
  getSessionFavoriteKey,
  onSelectSession,
  onRefreshSessions,
  onToggleFavorite,
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
      />
      <SessionPicker
        sessions={sessions}
        isLoading={sessionsLoading}
        isRefreshing={sessionsRefreshing}
        isUninitialized={sessionsUninitialized}
        catalogState={sessionsCatalogState}
        selectedId={selectedSessionId}
        favoriteSessionKeys={favoriteSessionKeys}
        getFavoriteKey={getSessionFavoriteKey}
        onSelect={onSelectSession}
        onRefresh={onRefreshSessions}
        onToggleFavorite={onToggleFavorite}
        disabled={disabled}
      />
    </div>
  );
});
