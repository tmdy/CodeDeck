import { memo, type ComponentProps } from "react";
import { GlobalSettingsPanel } from "../settings/GlobalSettingsPanel.jsx";
import { ParameterSettingsPanel } from "../settings/ParameterSettingsPanel.jsx";

type SettingsSubTab = "global" | "parameters";

interface SettingsPageProps {
  settingsSubTab: SettingsSubTab;
  onSelectGlobal: () => void;
  onSelectParameters: () => void;
  globalSettingsProps: ComponentProps<typeof GlobalSettingsPanel>;
  parameterSettingsProps: ComponentProps<typeof ParameterSettingsPanel>;
}

export const SettingsPage = memo(function SettingsPage({
  settingsSubTab,
  onSelectGlobal,
  onSelectParameters,
  globalSettingsProps,
  parameterSettingsProps,
}: SettingsPageProps) {
  return (
    <div className="settings-layout">
      <nav className="settings-sub-tabs">
        <button
          type="button"
          className={`tab-btn ${settingsSubTab === "global" ? "active" : ""}`}
          onClick={onSelectGlobal}
        >
          全局设置
        </button>
        <button
          type="button"
          className={`tab-btn ${settingsSubTab === "parameters" ? "active" : ""}`}
          onClick={onSelectParameters}
        >
          参数设置
        </button>
      </nav>

      {settingsSubTab === "global" && <GlobalSettingsPanel {...globalSettingsProps} />}
      {settingsSubTab === "parameters" && <ParameterSettingsPanel {...parameterSettingsProps} />}
    </div>
  );
});
