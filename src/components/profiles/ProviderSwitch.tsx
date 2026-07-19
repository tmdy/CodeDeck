// ProviderSwitch 组件 — Claude/Codex 切换按钮

import { PROVIDER_CLAUDE, PROVIDER_CODEX } from "../../shared/profile/types.js";

interface ProviderSwitchProps {
  activeProvider: string;
  onSwitch: (provider: string) => void;
  disabled?: boolean;
}

export function ProviderSwitch({ activeProvider, onSwitch, disabled }: ProviderSwitchProps) {
  return (
    <div className="provider-switch">
      <button
        type="button"
        className={`provider-btn ${activeProvider === PROVIDER_CLAUDE ? "active" : ""}`}
        onClick={() => onSwitch(PROVIDER_CLAUDE)}
        disabled={disabled}
      >
        Claude
      </button>
      <button
        type="button"
        className={`provider-btn ${activeProvider === PROVIDER_CODEX ? "active" : ""}`}
        onClick={() => onSwitch(PROVIDER_CODEX)}
        disabled={disabled}
      >
        Codex
      </button>
    </div>
  );
}