import { memo, type ComponentProps } from "react";
import { SessionList } from "../launcher/SessionList.jsx";
import { PROVIDER_CLAUDE, PROVIDER_CODEX } from "../../shared/profile/types.js";

export type SessionsViewId = "claude" | "codex" | "favorites";

interface SessionViewSwitchProps {
  activeView: SessionsViewId;
  onSwitch: (view: SessionsViewId) => void;
  disabled?: boolean;
}

interface SessionsPageProps {
  sessionViewSwitchProps: SessionViewSwitchProps;
  sessionListProps: ComponentProps<typeof SessionList>;
}

function SessionViewSwitch({ activeView, onSwitch, disabled }: SessionViewSwitchProps) {
  return (
    <div className="provider-switch session-view-switch">
      <button
        type="button"
        className={`provider-btn ${activeView === PROVIDER_CLAUDE ? "active" : ""}`}
        onClick={() => onSwitch(PROVIDER_CLAUDE)}
        disabled={disabled}
      >
        Claude
      </button>
      <button
        type="button"
        className={`provider-btn ${activeView === PROVIDER_CODEX ? "active" : ""}`}
        onClick={() => onSwitch(PROVIDER_CODEX)}
        disabled={disabled}
      >
        Codex
      </button>
      <button
        type="button"
        className={`provider-btn ${activeView === "favorites" ? "active" : ""}`}
        onClick={() => onSwitch("favorites")}
        disabled={disabled}
      >
        收藏
      </button>
    </div>
  );
}

export const SessionsPage = memo(function SessionsPage({
  sessionViewSwitchProps,
  sessionListProps,
}: SessionsPageProps) {
  return (
    <div className="sessions-layout">
      <SessionViewSwitch {...sessionViewSwitchProps} />
      <SessionList {...sessionListProps} />
    </div>
  );
});
