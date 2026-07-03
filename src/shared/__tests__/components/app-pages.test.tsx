import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ProfilesPage } from "../../../components/app/ProfilesPage.jsx";
import { SessionsPage } from "../../../components/app/SessionsPage.jsx";
import { SettingsPage } from "../../../components/app/SettingsPage.jsx";
import { defaultBalanceCheckState } from "../../balance/types.js";
import { defaultProfilePermissions } from "../../profile/permissions.js";
import {
  defaultGlobalSettings,
  defaultRuntimeSettings,
  PROVIDER_CLAUDE,
} from "../../profile/types.js";
import { defaultParameterSettings } from "../../parameter/types.js";

describe("App page containers", () => {
  it("renders the Profiles page layout with editor and launch panels", () => {
    const html = renderToStaticMarkup(
      <ProfilesPage
        providerSwitchProps={{
          activeProvider: PROVIDER_CLAUDE,
          onSwitch: vi.fn(),
        }}
        profileListProps={{
          profiles: [
            {
              provider: PROVIDER_CLAUDE,
              name: "Relay",
              url: "https://relay.example.com/v1",
              key: "sk-relay",
            },
          ],
          activeProvider: PROVIDER_CLAUDE,
          selectedKey: "claude::Relay",
          orderedKeys: ["claude::Relay"],
          balanceEntries: {},
          onSelect: vi.fn(),
          onReorder: vi.fn(),
          onCreate: vi.fn(),
          onClone: vi.fn(),
          onDelete: vi.fn(),
        }}
        siteBalanceSessionProps={{
          siteBalanceSessions: [],
          balanceSessionSelection: "auto",
          balanceSessionDraft: { label: "", access_token: "", user_id: "" },
          onBalanceSessionSelectionChange: vi.fn(),
          onBalanceSessionDraftChange: vi.fn(),
          onDeleteSiteBalanceSession: vi.fn(),
        }}
        balanceTestProps={{
          state: defaultBalanceCheckState(),
          onTest: vi.fn(),
        }}
        profileEditProps={{
          draft: {
            name: "Relay",
            url: "https://relay.example.com/v1",
            key: "sk-relay",
            selectedModelId: "claude-sonnet-4-5",
            advancedModelMapping: { enabled: false },
            permissions: null,
          },
          globalPermissions: defaultProfilePermissions(PROVIDER_CLAUDE),
          runtime: {
            cwd: "",
            command_base: defaultRuntimeSettings(PROVIDER_CLAUDE).command_base,
            settings_file: "",
            extra_args: "",
            launch_mode: "new",
            exclude_user_settings: true,
          },
          provider: PROVIDER_CLAUDE,
          modelOptions: [],
          onChange: vi.fn(),
          onAdvancedModelMappingChange: vi.fn(),
          onRuntimeChange: vi.fn(),
          onFetchModels: vi.fn(),
          onPickCwd: vi.fn(),
          onSave: vi.fn(),
          onCancel: vi.fn(),
        }}
        launchPanelProps={{
          provider: PROVIDER_CLAUDE,
          preview: {
            command: "claude",
            cwd: "C:/repo",
            env: [],
            valid: true,
          },
          sessions: [],
          onSelectSession: vi.fn(),
          onRefreshSessions: vi.fn(),
          onDirectLaunch: vi.fn(),
          onContinueLaunch: vi.fn(),
          onResumeLaunch: vi.fn(),
        }}
      />,
    );

    expect(html).toContain("Profiles");
    expect(html).toContain("站点后台会话");
    expect(html).toContain("检测余额");
    expect(html).not.toContain("测试连接");
    expect(html).toContain("Profile 信息");
    expect(html).toContain("恢复会话");
    expect(html).toContain("命令预览");
    expect(html.indexOf("检测余额")).toBeLessThan(html.indexOf("站点后台会话"));
  });

  it("renders the Sessions page layout", () => {
    const html = renderToStaticMarkup(
      <SessionsPage
        sessionViewSwitchProps={{
          activeView: PROVIDER_CLAUDE,
          onSwitch: vi.fn(),
        }}
        sessionListProps={{
          provider: PROVIDER_CLAUDE,
          sessions: [],
          restoreProfiles: [],
          restoreDisabled: true,
          preview: { command: "", cwd: "", env: [], valid: false },
          onSelect: vi.fn(),
          onRefresh: vi.fn(),
          onSelectRestoreProfile: vi.fn(),
          onRestore: vi.fn(),
        }}
      />,
    );

    expect(html).toContain("历史会话");
    expect(html).toContain("当前 Provider：claude");
    expect(html).not.toContain("当前项目");
    expect(html).not.toContain("本机最近");
  });

  it("renders the Settings page selected sub-tab", () => {
    const html = renderToStaticMarkup(
      <SettingsPage
        settingsSubTab="parameters"
        onSelectGlobal={vi.fn()}
        onSelectParameters={vi.fn()}
        globalSettingsProps={{
          settings: defaultGlobalSettings(),
          onChange: vi.fn(),
        }}
        parameterSettingsProps={{
          settings: defaultParameterSettings(),
          onChange: vi.fn(),
        }}
      />,
    );

    expect(html).toContain("全局设置");
    expect(html).toContain("参数设置");
    expect(html).toContain("超时设置");
    expect(html).toContain("余额检测超时");
    expect(html).not.toContain("连接测试超时");
  });
});
