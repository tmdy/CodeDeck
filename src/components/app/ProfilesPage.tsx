import { memo, type ComponentProps } from "react";
import { BalanceTestButton } from "../balance/BalanceTestButton.jsx";
import { CmdPreview } from "../launcher/CommandPreview.jsx";
import { ProfileEditForm } from "../profiles/ProfileEditForm.jsx";
import { ProfileListPanel } from "../profiles/ProfileListPanel.jsx";
import { ProfilesLaunchPanel } from "../profiles/ProfilesLaunchPanel.jsx";
import { ProviderSwitch } from "../profiles/ProviderSwitch.jsx";
import { SiteBalanceSessionPanel } from "../profiles/SiteBalanceSessionPanel.jsx";
import type { CommandPreview } from "../../shared/launcher/types.js";

interface ProfilesPageProps {
  providerSwitchProps: ComponentProps<typeof ProviderSwitch>;
  profileListProps: ComponentProps<typeof ProfileListPanel>;
  siteBalanceSessionProps: ComponentProps<typeof SiteBalanceSessionPanel>;
  balanceTestProps: ComponentProps<typeof BalanceTestButton>;
  profileEditProps: ComponentProps<typeof ProfileEditForm>;
  launchPanelProps: ComponentProps<typeof ProfilesLaunchPanel> & { preview: CommandPreview };
}

export const ProfilesPage = memo(function ProfilesPage({
  providerSwitchProps,
  profileListProps,
  siteBalanceSessionProps,
  balanceTestProps,
  profileEditProps,
  launchPanelProps,
}: ProfilesPageProps) {
  const { preview, ...profilesLaunchPanelProps } = launchPanelProps;
  const isNativeProfile = profileEditProps.runtime.startup_mode === "native";

  return (
    <div className="profiles-layout">
      <div className="profiles-left">
        <ProviderSwitch {...providerSwitchProps} />
        <ProfileListPanel {...profileListProps} />
        {!isNativeProfile && <BalanceTestButton {...balanceTestProps} />}
        {!isNativeProfile && <SiteBalanceSessionPanel {...siteBalanceSessionProps} />}
      </div>

      <div className="profiles-center">
        <ProfileEditForm
          {...profileEditProps}
          commandPreview={<CmdPreview preview={preview} />}
        />
      </div>

      <div className="profiles-right">
        <ProfilesLaunchPanel {...profilesLaunchPanelProps} />
      </div>
    </div>
  );
});
