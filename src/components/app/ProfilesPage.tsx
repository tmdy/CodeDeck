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
  const balanceState = balanceTestProps.state;
  const showBalanceMeta = !balanceState?.running && Boolean(
    balanceState?.endpoint
    || balanceTestProps.sessionHint
    || balanceState?.finished_at_display,
  );
  const balanceMeta = showBalanceMeta ? (
    <>
      {balanceState?.endpoint && (
        <p className="balance-test-meta">来源: {balanceState.endpoint}</p>
      )}
      {balanceTestProps.sessionHint && (
        <p className="balance-test-meta">{balanceTestProps.sessionHint}</p>
      )}
      {balanceState?.finished_at_display && (
        <p className="balance-test-meta">最近检测: {balanceState.finished_at_display}</p>
      )}
    </>
  ) : undefined;

  return (
    <div className="profiles-layout">
      <div className="profiles-left">
        <ProviderSwitch {...providerSwitchProps} />
        <ProfileListPanel {...profileListProps} />
        <BalanceTestButton {...balanceTestProps} />
        <SiteBalanceSessionPanel {...siteBalanceSessionProps} balanceMeta={balanceMeta} />
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
