import { memo, type ComponentProps } from "react";
import { BalanceTestButton } from "../balance/BalanceTestButton.jsx";
import { ProfileEditForm } from "../profiles/ProfileEditForm.jsx";
import { ProfileListPanel } from "../profiles/ProfileListPanel.jsx";
import { ProfilesLaunchPanel } from "../profiles/ProfilesLaunchPanel.jsx";
import { ProviderSwitch } from "../profiles/ProviderSwitch.jsx";

interface ProfilesPageProps {
  providerSwitchProps: ComponentProps<typeof ProviderSwitch>;
  profileListProps: ComponentProps<typeof ProfileListPanel>;
  balanceTestProps: ComponentProps<typeof BalanceTestButton>;
  profileEditProps: ComponentProps<typeof ProfileEditForm>;
  launchPanelProps: ComponentProps<typeof ProfilesLaunchPanel>;
}

export const ProfilesPage = memo(function ProfilesPage({
  providerSwitchProps,
  profileListProps,
  balanceTestProps,
  profileEditProps,
  launchPanelProps,
}: ProfilesPageProps) {
  return (
    <div className="profiles-layout">
      <div className="profiles-left">
        <ProviderSwitch {...providerSwitchProps} />
        <ProfileListPanel {...profileListProps} />
        <BalanceTestButton {...balanceTestProps} />
      </div>

      <div className="profiles-center">
        <ProfileEditForm {...profileEditProps} />
      </div>

      <div className="profiles-right">
        <ProfilesLaunchPanel {...launchPanelProps} />
      </div>
    </div>
  );
});
