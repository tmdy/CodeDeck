import { memo, useEffect, useState, type ComponentProps } from "react";
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
  const [globalDraft, setGlobalDraft] = useState(globalSettingsProps.settings);
  const [parameterDraft, setParameterDraft] = useState(parameterSettingsProps.settings);
  const [globalDirty, setGlobalDirty] = useState(false);
  const [parameterDirty, setParameterDirty] = useState(false);

  useEffect(() => {
    if (!globalDirty) {
      setGlobalDraft(globalSettingsProps.settings);
    }
  }, [globalDirty, globalSettingsProps.settings]);

  useEffect(() => {
    if (!parameterDirty) {
      setParameterDraft(parameterSettingsProps.settings);
    }
  }, [parameterDirty, parameterSettingsProps.settings]);

  const handleGlobalDraftChange: typeof globalSettingsProps.onChange = (patch) => {
    setGlobalDraft((current) => ({
      ...current,
      ...patch,
    }));
    setGlobalDirty(true);
  };

  const handleParameterDraftChange: typeof parameterSettingsProps.onChange = (patch) => {
    setParameterDraft((current) => ({
      ...current,
      ...patch,
    }));
    setParameterDirty(true);
  };

  const saveGlobalDraft = () => {
    globalSettingsProps.onChange(globalDraft);
    setGlobalDirty(false);
  };

  const saveParameterDraft = () => {
    parameterSettingsProps.onChange(parameterDraft);
    setParameterDirty(false);
  };

  const cancelGlobalDraft = () => {
    setGlobalDraft(globalSettingsProps.settings);
    setGlobalDirty(false);
  };

  const cancelParameterDraft = () => {
    setParameterDraft(parameterSettingsProps.settings);
    setParameterDirty(false);
  };

  const isGlobalTab = settingsSubTab === "global";
  const isDirty = isGlobalTab ? globalDirty : parameterDirty;
  const saveDraft = isGlobalTab ? saveGlobalDraft : saveParameterDraft;
  const cancelDraft = isGlobalTab ? cancelGlobalDraft : cancelParameterDraft;
  const actionDisabled = isGlobalTab
    ? globalSettingsProps.disabled
    : parameterSettingsProps.disabled;

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

      {settingsSubTab === "global" && (
        <GlobalSettingsPanel
          {...globalSettingsProps}
          settings={globalDraft}
          onChange={handleGlobalDraftChange}
        />
      )}
      {settingsSubTab === "parameters" && (
        <ParameterSettingsPanel
          {...parameterSettingsProps}
          settings={parameterDraft}
          onChange={handleParameterDraftChange}
        />
      )}

      <div className="form-actions settings-save-actions">
        <button
          type="button"
          onClick={saveDraft}
          disabled={actionDisabled || !isDirty}
        >
          保存设置
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={cancelDraft}
          disabled={actionDisabled || !isDirty}
        >
          取消修改
        </button>
      </div>
    </div>
  );
});
