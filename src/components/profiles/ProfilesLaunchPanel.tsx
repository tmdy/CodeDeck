import { memo } from "react";
import { LaunchControls } from "../launcher/LaunchControls.jsx";
import { SessionPicker } from "../launcher/SessionPicker.jsx";
import type { SessionCatalogState, SessionSummary } from "../../shared/services/session-service.js";
import type { ProfileChannel } from "../../shared/profile/types.js";

interface ProfilesLaunchPanelProps {
  provider: "claude" | "codex";
  channels?: ProfileChannel[];
  activeChannelId?: string;
  onChannelChange?: (channelId: string) => void;
  channelSwitchDisabled?: boolean;
  monitorModeEnabled?: boolean;
  onMonitorModeChange?: (enabled: boolean) => void;
  disabled?: boolean;
  resumeDisabled?: boolean;
  sessions: SessionSummary[];
  sessionsLoading?: boolean;
  sessionsRefreshing?: boolean;
  sessionsUninitialized?: boolean;
  sessionsBlockedMessage?: string | null;
  sessionsCatalogState?: SessionCatalogState;
  selectedSessionId?: string;
  favoriteSessionKeys?: ReadonlySet<string>;
  getSessionFavoriteKey?: (session: SessionSummary) => string;
  onSelectSession: (sessionId: string) => void;
  onRefreshSessions: () => void;
  onToggleFavorite?: (session: SessionSummary) => void;
  onDirectLaunch: () => void;
  desktopHandoffEnabled?: boolean;
  onDesktopHandoffChange?: (enabled: boolean) => void;
  onContinueLaunch: () => void;
  onResumeLaunch: () => void;
  onTemporaryReadonlyLaunch?: () => void;
  onTemporaryFullAccessLaunch?: () => void;
}

export const ProfilesLaunchPanel = memo(function ProfilesLaunchPanel({
  provider,
  channels = [],
  activeChannelId = "",
  onChannelChange,
  channelSwitchDisabled,
  monitorModeEnabled,
  onMonitorModeChange,
  disabled,
  resumeDisabled,
  sessions,
  sessionsLoading,
  sessionsRefreshing,
  sessionsUninitialized,
  sessionsBlockedMessage,
  sessionsCatalogState,
  selectedSessionId,
  favoriteSessionKeys,
  getSessionFavoriteKey,
  onSelectSession,
  onRefreshSessions,
  onToggleFavorite,
  onDirectLaunch,
  desktopHandoffEnabled,
  onDesktopHandoffChange,
  onContinueLaunch,
  onResumeLaunch,
  onTemporaryReadonlyLaunch,
  onTemporaryFullAccessLaunch,
}: ProfilesLaunchPanelProps) {
  return (
    <div className="profiles-launch-panel">
      {channels.length > 0 && (
        <label className="profile-quick-channel">
          启动渠道
          <select
            value={activeChannelId}
            onChange={(event) => onChannelChange?.(event.target.value)}
            disabled={disabled || channelSwitchDisabled || !onChannelChange}
          >
            {channels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                {channel.name || "未命名渠道"}
              </option>
            ))}
          </select>
        </label>
      )}
      <LaunchControls
        provider={provider}
        monitorModeEnabled={monitorModeEnabled}
        onMonitorModeChange={onMonitorModeChange}
        onDirectLaunch={onDirectLaunch}
        desktopHandoffEnabled={desktopHandoffEnabled}
        onDesktopHandoffChange={onDesktopHandoffChange}
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
        blockedMessage={sessionsBlockedMessage}
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
